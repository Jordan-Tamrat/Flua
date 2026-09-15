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
const TOKEN_LIFETIME_MS = 90 * 60 * 1000;

/**
 * Without compression, an audio session is cut off at a fixed duration (about
 * ten minutes) once the context window fills with audio tokens — the learner is
 * hung up on mid-sentence. Turning on a sliding window lifts that cap: when the
 * context reaches the trigger, the oldest turns are dropped and the session
 * simply continues.
 *
 * The trade-off is memory, not time. Past the window the model no longer recalls
 * the start of the conversation, which for tutoring is a fair exchange — the
 * full transcript is kept client-side and is what end-of-session feedback reads.
 */
const COMPRESSION_TRIGGER_TOKENS = "16000";
const COMPRESSION_TARGET_TOKENS = "8000";

/**
 * Language the learner's microphone is transcribed as.
 *
 * Left unset, the API auto-detects per utterance, and a strong accent or an
 * unfamiliar proper noun is regularly guessed as a different language
 * altogether — the transcript comes back as nonsense, or as script the learner
 * never spoke. Because that transcript is what end-of-session feedback reads,
 * a bad guess doesn't just look wrong, it silently corrupts the feedback.
 *
 * Pinning the input removes the guess. Flua's own speech is deliberately left on
 * auto-detect, so if she is asked to teach a word in another language it still
 * transcribes correctly — feedback only ever analyses the learner's turns.
 */
const INPUT_LANGUAGE_CODES = ["en-US"];

/**
 * Terms the general speech model reliably mangles, biasing recognition toward
 * what learners of this app actually say. Kept short: every phrase here is a
 * small nudge, and a long list dilutes all of them.
 */
const TRANSCRIPTION_VOCABULARY = [
  "Flua",
  "TypeScript",
  "JavaScript",
  "Next.js",
  "React",
  "Node.js",
  "Python",
  "Django",
  "Lighthouse",
  "CEFR",
];

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
  "WEB_GROUNDING",
]);

/**
 * Lets the tutor look things up while talking.
 *
 * A conversation partner who is confidently wrong about this week's news is
 * worse than one who says it doesn't know: the learner has no way to tell the
 * difference, and trusting a wrong answer is how they end up repeating it.
 * Grounding is what makes "what did United sign this season?" answerable rather
 * than answered from a year-old snapshot.
 *
 * Declared in the token's constraints, so the browser cannot add tools of its
 * own or take this one away.
 */
const GROUNDING_TOOLS = [{ googleSearch: {} }];

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
              /*
               * Both transcriptions are requested so the UI can show a live
               * written record of the spoken conversation.
               *
               * The asymmetry is deliberate: the learner's microphone is pinned
               * to one language because a mis-detection there corrupts their
               * feedback, while Flua's own speech stays auto-detected so she can
               * say a word in another language when asked without the transcript
               * turning to noise.
               */
              inputAudioTranscription: {
                languageCodes: INPUT_LANGUAGE_CODES,
                customVocabulary: TRANSCRIPTION_VOCABULARY,
              },
              outputAudioTranscription: {},
              systemInstruction: config.systemInstruction,
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
              // Lifts the fixed session-duration cap. See the constants above.
              contextWindowCompression: {
                triggerTokens: COMPRESSION_TRIGGER_TOKENS,
                slidingWindow: { targetTokens: COMPRESSION_TARGET_TOKENS },
              },
              tools: GROUNDING_TOOLS,
              /*
               * Deliberately NOT enabling `sessionResumption`.
               *
               * Resuming a dropped call would be the obvious way to survive one,
               * and the provider does hand out resumption handles. Tested
               * directly, though, a handle only restores the conversation when
               * both sockets authenticate with the same long-lived API key.
               * This browser holds a single-use ephemeral token by design, so a
               * handle issued under one token resumes into an empty session
               * under the next — the call continues with the tutor having
               * forgotten everything, which is worse than ending cleanly.
               */
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
