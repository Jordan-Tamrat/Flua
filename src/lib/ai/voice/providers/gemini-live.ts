import "server-only";

import { GoogleGenAI, Modality } from "@google/genai";

import type {
  VoiceCapability,
  VoiceProvider,
  VoiceSessionConfig,
  VoiceSessionGrant,
} from "@/lib/ai/voice/types";
import { AIProviderError } from "@/lib/errors";

/**
 * Gemini Live adapter.
 *
 * Everything vendor-specific about live voice lives here: the `v1alpha` API
 * version ephemeral tokens require, the `liveConnectConstraints` shape, and the
 * native-audio model id.
 *
 * The security model is the point of this file. The server mints a token that
 * is single-use, short-lived, and *constrained* to a specific model and config,
 * then hands only that to the browser. A leaked token buys one session with the
 * tutor prompt already baked in — it cannot be repurposed to run arbitrary
 * generation against the account.
 */

const PROVIDER_NAME = "gemini-live";

/** Ephemeral auth tokens are only supported on v1alpha. */
const API_VERSION = "v1alpha";

/** Native-audio model: speech in, speech out, with interruption support. */
const LIVE_MODEL = "gemini-2.5-flash-native-audio-latest";

/** Warm, clear default. Gemini exposes several named prebuilt voices. */
const DEFAULT_VOICE = "Aoede";

/** How long the minted token stays valid overall. */
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;

/**
 * Window in which the browser must *start* the session. Deliberately short:
 * it bounds the damage from a token intercepted in transit, while leaving
 * enough time for a slow page load and a microphone permission prompt.
 */
const SESSION_START_WINDOW_MS = 2 * 60 * 1000;

const CAPABILITIES: ReadonlySet<VoiceCapability> = new Set<VoiceCapability>([
  "SPEECH_IN",
  "SPEECH_OUT",
  "INPUT_TRANSCRIPTION",
  "OUTPUT_TRANSCRIPTION",
  "INTERRUPTION",
]);

export class GeminiLiveProvider implements VoiceProvider {
  private readonly apiKey: string | undefined;
  private client: GoogleGenAI | null = null;

  constructor(options: { apiKey: string | undefined }) {
    this.apiKey = options.apiKey;
  }

  getProviderName(): string {
    return PROVIDER_NAME;
  }

  getCapabilities(): ReadonlySet<VoiceCapability> {
    return CAPABILITIES;
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
    this.client ??= new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { apiVersion: API_VERSION },
    });
    return this.client;
  }

  async createSessionGrant(config: VoiceSessionConfig): Promise<VoiceSessionGrant> {
    const now = Date.now();
    const expiresAt = new Date(now + TOKEN_LIFETIME_MS);
    const voice = config.voice ?? DEFAULT_VOICE;

    try {
      const token = await this.getClient().authTokens.create({
        config: {
          // One session per token. A replayed token is simply rejected.
          uses: 1,
          expireTime: expiresAt.toISOString(),
          newSessionExpireTime: new Date(now + SESSION_START_WINDOW_MS).toISOString(),
          /*
           * Locking the model and config into the token is what makes it safe
           * to hand to a browser: the client cannot swap the model, change the
           * response modality, or replace the tutor's system instruction.
           */
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              // Both transcriptions are requested so the UI can show a live
              // written record of the spoken conversation.
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: config.systemInstruction,
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            },
          },
          httpOptions: { apiVersion: API_VERSION },
        },
      });

      if (!token.name) {
        throw new AIProviderError({
          kind: "server_error",
          provider: PROVIDER_NAME,
          model: LIVE_MODEL,
          internalMessage: "Token response contained no name.",
        });
      }

      return {
        token: token.name,
        model: LIVE_MODEL,
        apiVersion: API_VERSION,
        expiresAt: expiresAt.toISOString(),
        provider: PROVIDER_NAME,
        voice,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;

      // Reuses the same failure taxonomy as the text providers so voice errors
      // surface through the existing safe-message machinery.
      const message = error instanceof Error ? error.message : String(error);
      const lowered = message.toLowerCase();
      const kind =
        lowered.includes("api key") || lowered.includes("unauthenticated")
          ? "auth"
          : lowered.includes("quota")
            ? "quota_exceeded"
            : lowered.includes("rate")
              ? "rate_limit"
              : "server_error";

      throw new AIProviderError({
        kind,
        provider: PROVIDER_NAME,
        model: LIVE_MODEL,
        internalMessage: message,
        cause: error,
      });
    }
  }
}
