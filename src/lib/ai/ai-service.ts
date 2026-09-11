import "server-only";

import type { z } from "zod";

import {
  backoffDelayMs,
  getProviderManager,
  isProviderError,
  sleep,
  type AttemptRecord,
  type RouteCandidate,
} from "@/lib/ai/provider-manager";
import { TASK_REQUIREMENTS, type AITask } from "@/lib/ai/registry";
import type {
  AIMessage,
  AIStreamChunk,
  GenerateStructuredResult,
  GenerateTextResult,
  TranscribeAudioResult,
} from "@/lib/ai/types";
import { providerEventKindFor, recordProviderEvent, recordUsage } from "@/lib/ai/usage-tracker";
import type { AIRequestType } from "@/generated/prisma";
import { getEnv } from "@/lib/config/env";
import {
  AINotConfiguredError,
  AIProviderError,
  AllProvidersFailedError,
  type AIErrorKind,
} from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * The application's single entry point to AI.
 *
 * Feature code calls `generateText`/`generateStructured`/`streamText`/
 * `transcribeAudio` with a *task*, never with a provider or model. This service
 * resolves the route, retries transient failures on the same provider, fails
 * over to the next provider when that is the right thing to do, and records
 * telemetry for every attempt.
 */

/** Maps a task onto the persisted request-type enum used for usage rows. */
const TASK_TO_REQUEST_TYPE: Record<AITask, AIRequestType> = {
  conversation: "CONVERSATION",
  teacher: "TEACHER",
  grammar_analysis: "GRAMMAR_ANALYSIS",
  grammar_exercise: "GRAMMAR_EXERCISE",
  vocabulary: "VOCABULARY",
  writing_analysis: "WRITING_ANALYSIS",
  speaking_analysis: "SPEAKING_ANALYSIS",
  level_assessment: "LEVEL_ASSESSMENT",
  memory_extraction: "MEMORY_EXTRACTION",
  summarization: "SUMMARIZATION",
  session_feedback: "SESSION_FEEDBACK",
  transcription: "TRANSCRIPTION",
};

export interface AIRequestOptions {
  task: AITask;
  /** Owner of the request, for per-user usage attribution. */
  userId?: string;
  signal?: AbortSignal;
}

export interface TextRequestOptions extends AIRequestOptions {
  system?: string;
  messages: AIMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface StructuredRequestOptions<TSchema extends z.ZodType> extends AIRequestOptions {
  system?: string;
  messages: AIMessage[];
  schema: TSchema;
  schemaName: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TranscriptionRequestOptions extends AIRequestOptions {
  audio: ArrayBuffer;
  mimeType: string;
  fileName: string;
  language?: string;
  prompt?: string;
}

interface ExecutionOutcome<T> {
  value: T;
  candidate: RouteCandidate;
  attemptedProviders: string[];
  fallbackTriggered: boolean;
}

export class AIService {
  /** Resolves the failover plan, or throws if nothing can serve the task. */
  private resolveRoute(task: AITask): RouteCandidate[] {
    const manager = getProviderManager();
    const capability = TASK_REQUIREMENTS[task].capability;
    const route = manager.buildRoute(task, capability);

    if (route.length === 0) {
      if (!manager.hasAnyConfiguredProvider()) {
        throw new AINotConfiguredError();
      }
      // Some provider is configured, but none can do this particular job —
      // most commonly speech-to-text with only Gemini configured.
      throw new AINotConfiguredError(capability.toLowerCase().replace(/_/g, " "));
    }

    return route;
  }

  /**
   * Runs `operation` against each candidate in turn.
   *
   * Within a single provider, transient failures are retried with exponential
   * backoff up to `AI_MAX_ATTEMPTS_PER_PROVIDER`. Failures that a different
   * provider could plausibly serve trigger failover; failures that are our own
   * fault (a malformed request) stop the whole route immediately, because
   * retrying them elsewhere would just waste quota.
   */
  private async execute<T>(
    task: AITask,
    userId: string | undefined,
    operation: (candidate: RouteCandidate) => Promise<T>,
  ): Promise<ExecutionOutcome<T>> {
    const env = getEnv();
    const route = this.resolveRoute(task);
    const attempts: AttemptRecord[] = [];
    const attemptedProviders: string[] = [];

    for (const [routeIndex, candidate] of route.entries()) {
      attemptedProviders.push(candidate.providerId);
      const startedAt = Date.now();

      for (let attempt = 0; attempt < env.AI_MAX_ATTEMPTS_PER_PROVIDER; attempt += 1) {
        try {
          const value = await operation(candidate);

          if (routeIndex > 0) {
            recordProviderEvent({
              provider: candidate.providerId,
              model: candidate.model.modelId,
              kind: "SUCCESS",
              message: `Recovered after failover from ${attemptedProviders.slice(0, -1).join(", ")}`,
              requestType: task,
              latencyMs: Date.now() - startedAt,
            });
          }

          return {
            value,
            candidate,
            attemptedProviders,
            fallbackTriggered: routeIndex > 0,
          };
        } catch (error) {
          const providerError = isProviderError(error)
            ? error
            : new AIProviderError({
                kind: "unknown",
                provider: candidate.providerId,
                model: candidate.model.modelId,
                internalMessage: error instanceof Error ? error.message : String(error),
                cause: error,
              });

          logger.warn("AI provider attempt failed", {
            provider: candidate.providerId,
            model: candidate.model.modelId,
            endpoint: task,
            kind: providerError.kind,
            attempt: attempt + 1,
            error: providerError.message,
          });

          recordProviderEvent({
            provider: candidate.providerId,
            model: candidate.model.modelId,
            kind: providerEventKindFor(providerError.kind),
            message: providerError.message,
            requestType: task,
            latencyMs: Date.now() - startedAt,
          });

          const isLastAttemptHere = attempt === env.AI_MAX_ATTEMPTS_PER_PROVIDER - 1;

          // Retry the same provider only for genuinely transient conditions.
          if (providerError.isRetryableOnSameProvider && !isLastAttemptHere) {
            await sleep(backoffDelayMs(attempt, providerError.retryAfterSeconds));
            continue;
          }

          attempts.push({
            provider: candidate.providerId,
            kind: providerError.kind,
            message: providerError.message,
          });

          if (!providerError.shouldFailOver) {
            // Our request is the problem (or the content was refused). Another
            // provider would fail the same way.
            throw providerError;
          }

          break; // move on to the next provider
        }
      }
    }

    recordProviderEvent({
      provider: attemptedProviders.join(",") || "none",
      kind: "ALL_FAILED",
      message: attempts.map((entry) => `${entry.provider}:${entry.kind}`).join(" | "),
      requestType: task,
    });

    throw new AllProvidersFailedError(attempts);
  }

  /** Extracts a failure kind for telemetry without leaking internals. */
  private errorKindOf(error: unknown): string | undefined {
    if (error instanceof AIProviderError) return error.kind;
    if (error instanceof AllProvidersFailedError) {
      return error.attempts.at(-1)?.kind ?? "unknown";
    }
    if (error instanceof AINotConfiguredError) return "not_configured";
    return "unknown";
  }

  async generateText(options: TextRequestOptions): Promise<GenerateTextResult> {
    const startedAt = Date.now();

    try {
      const outcome = await this.execute(options.task, options.userId, (candidate) =>
        candidate.provider.generateText({
          system: options.system,
          messages: options.messages,
          model: candidate.model.modelId,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          // Sourced from the registry so thinking models don't spend the
          // reply budget on reasoning before producing any text.
          thinkingBudget: candidate.model.thinkingBudget,
          stopSequences: options.stopSequences,
          signal: options.signal,
        }),
      );

      recordUsage({
        userId: options.userId,
        provider: outcome.candidate.providerId,
        model: outcome.candidate.model.modelId,
        requestType: TASK_TO_REQUEST_TYPE[options.task],
        capability: "TEXT",
        inputTokens: outcome.value.usage?.inputTokens,
        outputTokens: outcome.value.usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
        fallbackTriggered: outcome.fallbackTriggered,
        attemptedProviders: outcome.attemptedProviders,
      });

      return outcome.value;
    } catch (error) {
      recordUsage({
        userId: options.userId,
        provider: "none",
        model: "none",
        requestType: TASK_TO_REQUEST_TYPE[options.task],
        capability: "TEXT",
        latencyMs: Date.now() - startedAt,
        success: false,
        fallbackTriggered: false,
        attemptedProviders: [],
        errorKind: this.errorKindOf(error),
      });
      throw error;
    }
  }

  async generateStructured<TSchema extends z.ZodType>(
    options: StructuredRequestOptions<TSchema>,
  ): Promise<GenerateStructuredResult<z.infer<TSchema>>> {
    const startedAt = Date.now();

    try {
      const outcome = await this.execute(options.task, options.userId, (candidate) =>
        candidate.provider.generateStructured({
          system: options.system,
          messages: options.messages,
          model: candidate.model.modelId,
          schema: options.schema,
          schemaName: options.schemaName,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          // Sourced from the registry so thinking models don't spend the
          // reply budget on reasoning before producing any text.
          thinkingBudget: candidate.model.thinkingBudget,
          signal: options.signal,
        }),
      );

      recordUsage({
        userId: options.userId,
        provider: outcome.candidate.providerId,
        model: outcome.candidate.model.modelId,
        requestType: TASK_TO_REQUEST_TYPE[options.task],
        capability: "STRUCTURED_OUTPUT",
        inputTokens: outcome.value.usage?.inputTokens,
        outputTokens: outcome.value.usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
        success: true,
        fallbackTriggered: outcome.fallbackTriggered,
        attemptedProviders: outcome.attemptedProviders,
      });

      return outcome.value;
    } catch (error) {
      recordUsage({
        userId: options.userId,
        provider: "none",
        model: "none",
        requestType: TASK_TO_REQUEST_TYPE[options.task],
        capability: "STRUCTURED_OUTPUT",
        latencyMs: Date.now() - startedAt,
        success: false,
        fallbackTriggered: false,
        attemptedProviders: [],
        errorKind: this.errorKindOf(error),
      });
      throw error;
    }
  }

  /**
   * Streams a text response.
   *
   * Failover is only possible *before* the first token reaches the client:
   * once bytes are on the wire we cannot rewind the response the learner is
   * already reading. So the first chunk is awaited internally; if the provider
   * fails before producing it, the next provider is tried transparently.
   */
  async *streamText(options: TextRequestOptions): AsyncGenerator<AIStreamChunk> {
    const startedAt = Date.now();
    // Unlike the non-streaming path, there is no same-provider retry loop here:
    // a retry would have to replay tokens the client may already have seen.
    const route = this.resolveRoute(options.task);
    const attempts: AttemptRecord[] = [];
    const attemptedProviders: string[] = [];

    for (const [routeIndex, candidate] of route.entries()) {
      attemptedProviders.push(candidate.providerId);

      let iterator: AsyncIterator<AIStreamChunk> | null = null;
      let firstChunk: IteratorResult<AIStreamChunk> | null = null;

      try {
        const stream = candidate.provider.streamText({
          system: options.system,
          messages: options.messages,
          model: candidate.model.modelId,
          temperature: options.temperature,
          maxOutputTokens: options.maxOutputTokens,
          // Sourced from the registry so thinking models don't spend the
          // reply budget on reasoning before producing any text.
          thinkingBudget: candidate.model.thinkingBudget,
          stopSequences: options.stopSequences,
          signal: options.signal,
        });

        iterator = stream[Symbol.asyncIterator]();
        // Pulling the first chunk here is what makes pre-stream failover safe.
        firstChunk = await iterator.next();
      } catch (error) {
        const providerError = isProviderError(error)
          ? error
          : new AIProviderError({
              kind: "unknown",
              provider: candidate.providerId,
              model: candidate.model.modelId,
              internalMessage: error instanceof Error ? error.message : String(error),
              cause: error,
            });

        logger.warn("AI stream failed before first chunk", {
          provider: candidate.providerId,
          model: candidate.model.modelId,
          endpoint: options.task,
          kind: providerError.kind,
        });

        recordProviderEvent({
          provider: candidate.providerId,
          model: candidate.model.modelId,
          kind: providerEventKindFor(providerError.kind),
          message: providerError.message,
          requestType: options.task,
        });

        attempts.push({
          provider: candidate.providerId,
          kind: providerError.kind,
          message: providerError.message,
        });

        if (!providerError.shouldFailOver) {
          recordUsage({
            userId: options.userId,
            provider: candidate.providerId,
            model: candidate.model.modelId,
            requestType: TASK_TO_REQUEST_TYPE[options.task],
            capability: "STREAMING",
            latencyMs: Date.now() - startedAt,
            success: false,
            fallbackTriggered: routeIndex > 0,
            attemptedProviders,
            errorKind: providerError.kind,
          });
          throw providerError;
        }

        continue;
      }

      // From here the client is committed to this provider.
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let streamFailed = false;
      let failureKind: AIErrorKind | undefined;

      try {
        let current = firstChunk;
        while (current && !current.done) {
          const chunk = current.value;
          if (chunk.type === "done") {
            inputTokens = chunk.usage?.inputTokens;
            outputTokens = chunk.usage?.outputTokens;
          }
          yield chunk;
          current = await iterator.next();
        }
      } catch (error) {
        streamFailed = true;
        failureKind = isProviderError(error) ? error.kind : "unknown";

        logger.error("AI stream failed mid-response", {
          provider: candidate.providerId,
          model: candidate.model.modelId,
          endpoint: options.task,
          kind: failureKind,
        });

        recordProviderEvent({
          provider: candidate.providerId,
          model: candidate.model.modelId,
          kind: providerEventKindFor(failureKind),
          message: error instanceof Error ? error.message : String(error),
          requestType: options.task,
        });

        throw error;
      } finally {
        recordUsage({
          userId: options.userId,
          provider: candidate.providerId,
          model: candidate.model.modelId,
          requestType: TASK_TO_REQUEST_TYPE[options.task],
          capability: "STREAMING",
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startedAt,
          success: !streamFailed,
          fallbackTriggered: routeIndex > 0,
          attemptedProviders,
          errorKind: failureKind,
        });
      }

      return;
    }

    recordProviderEvent({
      provider: attemptedProviders.join(",") || "none",
      kind: "ALL_FAILED",
      message: attempts.map((entry) => `${entry.provider}:${entry.kind}`).join(" | "),
      requestType: options.task,
    });

    recordUsage({
      userId: options.userId,
      provider: "none",
      model: "none",
      requestType: TASK_TO_REQUEST_TYPE[options.task],
      capability: "STREAMING",
      latencyMs: Date.now() - startedAt,
      success: false,
      fallbackTriggered: attemptedProviders.length > 1,
      attemptedProviders,
      errorKind: attempts.at(-1)?.kind,
    });

    throw new AllProvidersFailedError(attempts);
  }

  async transcribeAudio(options: TranscriptionRequestOptions): Promise<TranscribeAudioResult> {
    const startedAt = Date.now();

    try {
      const outcome = await this.execute(options.task, options.userId, (candidate) => {
        // The route builder guarantees SPEECH_TO_TEXT support, so the optional
        // method is present; this check keeps the type system honest.
        if (!candidate.provider.transcribeAudio) {
          throw new AIProviderError({
            kind: "model_unsupported",
            provider: candidate.providerId,
            model: candidate.model.modelId,
            internalMessage: "Provider declares SPEECH_TO_TEXT but has no transcribeAudio method.",
          });
        }

        return candidate.provider.transcribeAudio({
          audio: options.audio,
          mimeType: options.mimeType,
          fileName: options.fileName,
          model: candidate.model.modelId,
          language: options.language,
          prompt: options.prompt,
          signal: options.signal,
        });
      });

      recordUsage({
        userId: options.userId,
        provider: outcome.candidate.providerId,
        model: outcome.candidate.model.modelId,
        requestType: "TRANSCRIPTION",
        capability: "SPEECH_TO_TEXT",
        latencyMs: Date.now() - startedAt,
        success: true,
        fallbackTriggered: outcome.fallbackTriggered,
        attemptedProviders: outcome.attemptedProviders,
      });

      return outcome.value;
    } catch (error) {
      recordUsage({
        userId: options.userId,
        provider: "none",
        model: "none",
        requestType: "TRANSCRIPTION",
        capability: "SPEECH_TO_TEXT",
        latencyMs: Date.now() - startedAt,
        success: false,
        fallbackTriggered: false,
        attemptedProviders: [],
        errorKind: this.errorKindOf(error),
      });
      throw error;
    }
  }
}

let serviceInstance: AIService | null = null;

export function getAIService(): AIService {
  serviceInstance ??= new AIService();
  return serviceInstance;
}
