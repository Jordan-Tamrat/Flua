import "server-only";

import OpenAI from "openai";
import type { z } from "zod";

import {
  buildJsonInstruction,
  parseStructured,
  toJsonSchema,
  toProviderError,
  withTimeout,
} from "@/lib/ai/providers/shared";
import type {
  AICapability,
  AIMessage,
  AIProvider,
  AIStreamChunk,
  ClassifyRequest,
  ClassifyResult,
  GenerateStructuredRequest,
  GenerateStructuredResult,
  GenerateTextRequest,
  GenerateTextResult,
  ProviderCapabilities,
} from "@/lib/ai/types";
import { AIProviderError } from "@/lib/errors";

/**
 * OpenRouter adapter.
 *
 * OpenRouter exposes an OpenAI-compatible API in front of many model vendors,
 * which makes it a useful last-resort fallback. Its free (`:free`) routes are
 * capacity-shared, so 429s are common and expected — the ProviderManager treats
 * them as ordinary retryable failures.
 */

const PROVIDER_NAME = "openrouter";
const BASE_URL = "https://openrouter.ai/api/v1";

const CAPABILITIES: ReadonlySet<AICapability> = new Set<AICapability>([
  "TEXT",
  "STREAMING",
  "STRUCTURED_OUTPUT",
]);

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class OpenRouterProvider implements AIProvider {
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly appUrl: string;
  private client: OpenAI | null = null;

  constructor(options: { apiKey: string | undefined; timeoutMs: number; appUrl: string }) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.appUrl = options.appUrl;
  }

  getProviderName(): string {
    return PROVIDER_NAME;
  }

  getCapabilities(): ProviderCapabilities {
    return { supports: CAPABILITIES };
  }

  isConfigured(): boolean {
    return typeof this.apiKey === "string" && this.apiKey.length > 0;
  }

  private getClient(): OpenAI {
    if (!this.apiKey) {
      throw new AIProviderError({
        kind: "auth",
        provider: PROVIDER_NAME,
        internalMessage: "OPENROUTER_API_KEY is not set.",
      });
    }
    this.client ??= new OpenAI({
      apiKey: this.apiKey,
      baseURL: BASE_URL,
      maxRetries: 0,
      defaultHeaders: {
        // OpenRouter uses these for attribution on its public leaderboard.
        "HTTP-Referer": this.appUrl,
        "X-Title": "Flua — Personal AI English Tutor",
      },
    });
    return this.client;
  }

  private toChatMessages(system: string | undefined, messages: AIMessage[]): ChatMessage[] {
    const output: ChatMessage[] = [];
    if (system && system.length > 0) {
      output.push({ role: "system", content: system });
    }
    for (const message of messages) {
      output.push({ role: message.role, content: message.content });
    }
    return output;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const { signal, cleanup } = withTimeout(this.timeoutMs, request.signal);

    try {
      const completion = await this.getClient().chat.completions.create(
        {
          model: request.model,
          messages: this.toChatMessages(request.system, request.messages),
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          stop: request.stopSequences,
          stream: false,
        },
        { signal },
      );

      const choice = completion.choices[0];
      const text = choice?.message?.content ?? "";

      if (text.trim().length === 0) {
        throw new AIProviderError({
          kind: "content_filtered",
          provider: PROVIDER_NAME,
          model: request.model,
          internalMessage: `Empty completion. Finish reason: ${choice?.finish_reason ?? "unknown"}`,
        });
      }

      return {
        text,
        model: request.model,
        provider: PROVIDER_NAME,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
        finishReason: choice?.finish_reason ?? undefined,
      };
    } catch (error) {
      throw toProviderError(PROVIDER_NAME, error, request.model);
    } finally {
      cleanup();
    }
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: GenerateStructuredRequest<TSchema>,
  ): Promise<GenerateStructuredResult<z.infer<TSchema>>> {
    const { signal, cleanup } = withTimeout(this.timeoutMs, request.signal);
    const jsonSchema = toJsonSchema(request.schema);

    try {
      const system = [request.system, buildJsonInstruction(request.schemaName, jsonSchema)]
        .filter(Boolean)
        .join("\n\n");

      const completion = await this.getClient().chat.completions.create(
        {
          model: request.model,
          messages: this.toChatMessages(system, request.messages),
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens,
          // Not every OpenRouter route honours json_object, so the prompt-level
          // instruction above is the real guarantee; this is a best-effort hint.
          response_format: { type: "json_object" },
          stream: false,
        },
        { signal },
      );

      const raw = completion.choices[0]?.message?.content ?? "";
      const data = parseStructured(PROVIDER_NAME, request.model, raw, request.schema);

      return {
        data,
        raw,
        model: request.model,
        provider: PROVIDER_NAME,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
      };
    } catch (error) {
      throw toProviderError(PROVIDER_NAME, error, request.model);
    } finally {
      cleanup();
    }
  }

  async *streamText(request: GenerateTextRequest): AsyncIterable<AIStreamChunk> {
    const { signal, cleanup } = withTimeout(this.timeoutMs, request.signal);

    try {
      const stream = await this.getClient().chat.completions.create(
        {
          model: request.model,
          messages: this.toChatMessages(request.system, request.messages),
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          stop: request.stopSequences,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let finishReason: string | undefined;
      let emitted = false;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const text = choice?.delta?.content;
        if (text) {
          emitted = true;
          yield { type: "text", text };
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
      }

      if (!emitted) {
        throw new AIProviderError({
          kind: "content_filtered",
          provider: PROVIDER_NAME,
          model: request.model,
          internalMessage: `Stream produced no text. Finish reason: ${finishReason ?? "unknown"}`,
        });
      }

      yield { type: "done", usage: { inputTokens, outputTokens }, finishReason };
    } catch (error) {
      throw toProviderError(PROVIDER_NAME, error, request.model);
    } finally {
      cleanup();
    }
  }

  async classify(request: ClassifyRequest): Promise<ClassifyResult> {
    const instruction = [
      request.instruction ?? "Classify the content below.",
      `Reply with exactly one of these labels and nothing else: ${request.labels.join(", ")}.`,
    ].join("\n");

    const result = await this.generateText({
      system: instruction,
      messages: [{ role: "user", content: `<content>\n${request.input}\n</content>` }],
      model: request.model,
      temperature: 0,
      maxOutputTokens: 16,
      signal: request.signal,
    });

    const normalized = result.text.trim().toLowerCase();
    const matched =
      request.labels.find((label) => label.toLowerCase() === normalized) ??
      request.labels.find((label) => normalized.includes(label.toLowerCase()));

    return {
      label: matched ?? request.labels[0]!,
      model: request.model,
      provider: PROVIDER_NAME,
      usage: result.usage,
    };
  }
}
