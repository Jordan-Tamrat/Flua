import "server-only";

import Groq from "groq-sdk";
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
  TranscribeAudioRequest,
  TranscribeAudioResult,
} from "@/lib/ai/types";
import { AIProviderError } from "@/lib/errors";

/**
 * Groq adapter.
 *
 * Groq speaks the OpenAI chat-completions dialect and additionally hosts
 * Whisper, which makes it the default speech-to-text provider for Flua.
 */

const PROVIDER_NAME = "groq";

const CAPABILITIES: ReadonlySet<AICapability> = new Set<AICapability>([
  "TEXT",
  "STREAMING",
  "STRUCTURED_OUTPUT",
  "SPEECH_TO_TEXT",
]);

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class GroqProvider implements AIProvider {
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private client: Groq | null = null;

  constructor(options: { apiKey: string | undefined; timeoutMs: number }) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
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

  private getClient(): Groq {
    if (!this.apiKey) {
      throw new AIProviderError({
        kind: "auth",
        provider: PROVIDER_NAME,
        internalMessage: "GROQ_API_KEY is not set.",
      });
    }
    this.client ??= new Groq({ apiKey: this.apiKey, maxRetries: 0 });
    return this.client;
  }

  /** Flattens the request into the OpenAI-style message array Groq expects. */
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
        finishReason: choice?.finish_reason,
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

        // Groq attaches final token counts to the last chunk under `x_groq`.
        // The SDK types that field loosely (its declared `usage` covers
        // hardware-cache stats), so the token counts are read defensively.
        const usage = (chunk as { x_groq?: { usage?: unknown } }).x_groq?.usage as
          { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (usage) {
          inputTokens = usage.prompt_tokens ?? inputTokens;
          outputTokens = usage.completion_tokens ?? outputTokens;
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

  async transcribeAudio(request: TranscribeAudioRequest): Promise<TranscribeAudioResult> {
    const { signal, cleanup } = withTimeout(this.timeoutMs, request.signal);

    try {
      const file = new File([request.audio], request.fileName, { type: request.mimeType });

      const transcription = await this.getClient().audio.transcriptions.create(
        {
          file,
          model: request.model,
          language: request.language,
          prompt: request.prompt,
          response_format: "verbose_json",
          temperature: 0,
        },
        { signal },
      );

      // `verbose_json` adds duration/language; the SDK types the response
      // loosely, so those extras are read defensively.
      const extras = transcription as { duration?: number; language?: string };

      return {
        text: transcription.text ?? "",
        model: request.model,
        provider: PROVIDER_NAME,
        durationSec: typeof extras.duration === "number" ? extras.duration : undefined,
        language: extras.language,
      };
    } catch (error) {
      throw toProviderError(PROVIDER_NAME, error, request.model);
    } finally {
      cleanup();
    }
  }
}
