import type { z } from "zod";

/**
 * Provider-agnostic AI contract.
 *
 * Nothing in this file may reference Gemini, Groq, OpenRouter or any other
 * vendor. Adapters translate between these shapes and their SDKs; the rest of
 * the application only ever sees what is declared here.
 */

/* -------------------------------------------------------------------------- */
/*                                Capabilities                                */
/* -------------------------------------------------------------------------- */

export const AI_CAPABILITIES = [
  "TEXT",
  "STREAMING",
  "STRUCTURED_OUTPUT",
  "SPEECH_TO_TEXT",
  "TEXT_TO_SPEECH",
  "VISION",
] as const;

export type AICapability = (typeof AI_CAPABILITIES)[number];

/* -------------------------------------------------------------------------- */
/*                                  Messages                                  */
/* -------------------------------------------------------------------------- */

export type AIMessageRole = "system" | "user" | "assistant";

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

/* -------------------------------------------------------------------------- */
/*                                  Requests                                  */
/* -------------------------------------------------------------------------- */

export interface GenerateTextRequest {
  /** System instruction. Kept separate from user turns so adapters can map it
   *  onto whichever mechanism their API provides. */
  system?: string;
  messages: AIMessage[];
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Reasoning-token budget for "thinking" models, from the model registry.
   * Adapters whose provider has no such concept ignore it.
   */
  thinkingBudget?: number;
  /** Sequences that stop generation, where the provider supports them. */
  stopSequences?: string[];
  signal?: AbortSignal;
}

export interface GenerateStructuredRequest<TSchema extends z.ZodType> {
  system?: string;
  messages: AIMessage[];
  model: string;
  /** Zod schema the response must satisfy. Adapters may also send a JSON Schema
   *  derived from it to enable native structured-output modes. */
  schema: TSchema;
  /** Short name for the expected object, used in prompts and provider hints. */
  schemaName: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** See {@link GenerateTextRequest.thinkingBudget}. */
  thinkingBudget?: number;
  signal?: AbortSignal;
}

export interface ClassifyRequest {
  /** The untrusted content being classified. */
  input: string;
  /** Allowed labels. The adapter must return exactly one of these. */
  labels: string[];
  /** Optional guidance on how to pick a label. */
  instruction?: string;
  model: string;
  signal?: AbortSignal;
}

export interface TranscribeAudioRequest {
  audio: ArrayBuffer;
  /** MIME type of the payload, e.g. `audio/webm`. */
  mimeType: string;
  fileName: string;
  model: string;
  /** ISO-639-1 hint. Flua always passes `en`. */
  language?: string;
  /** Optional prompt to bias the transcription vocabulary. */
  prompt?: string;
  signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/*                                  Responses                                 */
/* -------------------------------------------------------------------------- */

export interface AIUsageStats {
  inputTokens?: number;
  outputTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  provider: string;
  usage?: AIUsageStats;
  finishReason?: string;
}

export interface GenerateStructuredResult<TData> {
  data: TData;
  raw: string;
  model: string;
  provider: string;
  usage?: AIUsageStats;
}

export interface ClassifyResult {
  label: string;
  model: string;
  provider: string;
  usage?: AIUsageStats;
}

export interface TranscribeAudioResult {
  text: string;
  model: string;
  provider: string;
  durationSec?: number;
  language?: string;
}

/** A single chunk of a streamed generation. */
export type AIStreamChunk =
  { type: "text"; text: string } | { type: "done"; usage?: AIUsageStats; finishReason?: string };

/* -------------------------------------------------------------------------- */
/*                              Provider interface                            */
/* -------------------------------------------------------------------------- */

export interface ProviderCapabilities {
  supports: ReadonlySet<AICapability>;
}

/**
 * The contract every adapter implements.
 *
 * Optional methods correspond to optional capabilities: a provider that does
 * not declare `SPEECH_TO_TEXT` need not implement `transcribeAudio`, and the
 * ProviderManager will never route such a request to it.
 */
export interface AIProvider {
  getProviderName(): string;
  getCapabilities(): ProviderCapabilities;
  /** True when the adapter has the credentials it needs to make a call. */
  isConfigured(): boolean;

  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;

  generateStructured<TSchema extends z.ZodType>(
    request: GenerateStructuredRequest<TSchema>,
  ): Promise<GenerateStructuredResult<z.infer<TSchema>>>;

  streamText(request: GenerateTextRequest): AsyncIterable<AIStreamChunk>;

  classify(request: ClassifyRequest): Promise<ClassifyResult>;

  transcribeAudio?(request: TranscribeAudioRequest): Promise<TranscribeAudioResult>;
}

/** Canonical provider identifiers. Adding a provider starts here. */
export const PROVIDER_IDS = ["gemini", "groq", "openrouter"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
