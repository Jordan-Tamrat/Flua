import "server-only";

import { GoogleGenAI, type Content } from "@google/genai";
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
 * Google Gemini adapter.
 *
 * Everything vendor-specific about Gemini — the `contents` array shape, the
 * `systemInstruction` field, `responseMimeType` for JSON mode — is confined to
 * this file. When Google changes its API, this is the only file that changes.
 */

const PROVIDER_NAME = "gemini";

const CAPABILITIES: ReadonlySet<AICapability> = new Set<AICapability>([
  "TEXT",
  "STREAMING",
  "STRUCTURED_OUTPUT",
  "VISION",
]);

export class GeminiProvider implements AIProvider {
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private client: GoogleGenAI | null = null;

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

  private getClient(): GoogleGenAI {
    if (!this.apiKey) {
      throw new AIProviderError({
        kind: "auth",
        provider: PROVIDER_NAME,
        internalMessage: "GEMINI_API_KEY is not set.",
      });
    }
    this.client ??= new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  /**
   * Gemini takes conversation turns as `contents` with roles `user`/`model`,
   * and the system prompt as a separate field. Consecutive same-role turns are
   * merged because the API rejects some alternation patterns.
   */
  private toContents(messages: GenerateTextRequest["messages"]): Content[] {
    const contents: Content[] = [];

    for (const message of messages) {
      if (message.role === "system") continue; // carried in systemInstruction
      const role = message.role === "assistant" ? "model" : "user";
      const previous = contents.at(-1);

      if (previous && previous.role === role) {
        previous.parts?.push({ text: message.content });
      } else {
        contents.push({ role, parts: [{ text: message.content }] });
      }
    }

    return contents;
  }

  /**
   * Maps the registry's thinking budget onto Gemini's `thinkingConfig`.
   *
   * Returns `undefined` when no budget is set, because some models (the Lite
   * tier especially) reject an explicit budget outright — omitting the field
   * is not the same as sending zero.
   */
  private thinkingConfig(budget: number | undefined) {
    return budget === undefined ? undefined : { thinkingBudget: budget };
  }

  /** System instructions from the request, plus any inline system messages. */
  private toSystemInstruction(request: {
    system?: string;
    messages: GenerateTextRequest["messages"];
  }): string | undefined {
    const inline = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    const parts = [request.system, ...inline].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const { signal, cleanup } = withTimeout(this.timeoutMs, request.signal);

    try {
      const response = await this.getClient().models.generateContent({
        model: request.model,
        contents: this.toContents(request.messages),
        config: {
          systemInstruction: this.toSystemInstruction(request),
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: this.thinkingConfig(request.thinkingBudget),
          stopSequences: request.stopSequences,
          abortSignal: signal,
        },
      });

      const text = response.text ?? "";
      if (text.trim().length === 0) {
        // An empty candidate usually means a safety block rather than a
        // transport failure, so it is classified as filtered content.
        throw new AIProviderError({
          kind: "content_filtered",
          provider: PROVIDER_NAME,
          model: request.model,
          internalMessage: `Empty response. Finish reason: ${
            response.candidates?.[0]?.finishReason ?? "unknown"
          }`,
        });
      }

      return {
        text,
        model: request.model,
        provider: PROVIDER_NAME,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
        finishReason: response.candidates?.[0]?.finishReason,
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
      const systemInstruction = [
        this.toSystemInstruction(request),
        buildJsonInstruction(request.schemaName, jsonSchema),
      ]
        .filter(Boolean)
        .join("\n\n");

      const response = await this.getClient().models.generateContent({
        model: request.model,
        contents: this.toContents(request.messages),
        config: {
          systemInstruction,
          temperature: request.temperature ?? 0.2,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: this.thinkingConfig(request.thinkingBudget),
          // Gemini's JSON mode. The schema is also restated in the prompt above
          // because the native mode rejects some constructs Zod can express.
          responseMimeType: "application/json",
          abortSignal: signal,
        },
      });

      const raw = response.text ?? "";
      const data = parseStructured(PROVIDER_NAME, request.model, raw, request.schema);

      return {
        data,
        raw,
        model: request.model,
        provider: PROVIDER_NAME,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
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
      const stream = await this.getClient().models.generateContentStream({
        model: request.model,
        contents: this.toContents(request.messages),
        config: {
          systemInstruction: this.toSystemInstruction(request),
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          thinkingConfig: this.thinkingConfig(request.thinkingBudget),
          stopSequences: request.stopSequences,
          abortSignal: signal,
        },
      });

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let finishReason: string | undefined;
      let emitted = false;

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          emitted = true;
          yield { type: "text", text };
        }
        if (chunk.usageMetadata) {
          inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
        }
        const reason = chunk.candidates?.[0]?.finishReason;
        if (reason) finishReason = reason;
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
      // The content being classified is untrusted; it is delimited so the model
      // treats it as data rather than as further instructions.
      messages: [{ role: "user", content: `<content>\n${request.input}\n</content>` }],
      model: request.model,
      temperature: 0,
      maxOutputTokens: 16,
      signal: request.signal,
    });

    const normalized = result.text.trim().toLowerCase();
    const matched = request.labels.find((label) => label.toLowerCase() === normalized);

    return {
      label:
        matched ??
        request.labels.find((label) => normalized.includes(label.toLowerCase())) ??
        request.labels[0]!,
      model: request.model,
      provider: PROVIDER_NAME,
      usage: result.usage,
    };
  }
}
