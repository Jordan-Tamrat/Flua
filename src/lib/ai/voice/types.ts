/**
 * Provider-agnostic contract for real-time voice conversation.
 *
 * Live voice is a genuinely different shape from the request/response AI the
 * rest of `lib/ai` models: it is a long-lived bidirectional session, not a call
 * that returns. It therefore gets its own contract rather than being forced
 * through `AIProvider`, but follows the same rule — nothing outside
 * `lib/ai/voice/providers/` names a vendor.
 *
 * The session itself runs in the browser (audio capture and playback are
 * client-side), so the server's job is narrow: authorize the learner, build the
 * tutor's instructions, and mint a short-lived credential.
 */

/** Capabilities a live-voice provider may offer. */
export const VOICE_CAPABILITIES = [
  "SPEECH_IN",
  "SPEECH_OUT",
  "INPUT_TRANSCRIPTION",
  "OUTPUT_TRANSCRIPTION",
  /** Learner can talk over the AI and it stops — essential for natural turn-taking. */
  "INTERRUPTION",
  /** Can look things up, so answers aren't limited to the model's training data. */
  "WEB_GROUNDING",
] as const;

export type VoiceCapability = (typeof VOICE_CAPABILITIES)[number];

/**
 * Everything the browser needs to open a session, with no long-lived secret.
 *
 * `token` is short-lived and single-use; `wsUrl` is deliberately absent because
 * the client SDK derives it. Nothing here identifies the provider's billing
 * account.
 */
export interface VoiceSessionGrant {
  /** Short-lived credential the browser presents instead of an API key. */
  token: string;
  /** Model the session is pinned to. */
  model: string;
  /** API version the token is valid against. */
  apiVersion: string;
  /** Wall-clock expiry, so the client can refuse a stale grant. */
  expiresAt: string;
  /** Which adapter issued this, for telemetry and the admin screen. */
  provider: string;
  /** Named voice the AI speaks with. */
  voice: string;
}

/** Instructions and constraints baked into the session at mint time. */
export interface VoiceSessionConfig {
  /** The tutor's system prompt — assembled server-side, never client-supplied. */
  systemInstruction: string;
  /** Preferred voice name; adapters fall back if unavailable. */
  voice?: string;
  /** Playback rate hint, 0.5-2.0. */
  speakingRate?: number;
}

export interface VoiceProvider {
  getProviderName(): string;
  getCapabilities(): ReadonlySet<VoiceCapability>;
  isConfigured(): boolean;
  /**
   * Mints a credential the browser can use to open exactly one session.
   * The provider's real API key must never appear in the result.
   */
  createSessionGrant(config: VoiceSessionConfig): Promise<VoiceSessionGrant>;
}

/* -------------------------------------------------------------------------- */
/*                            Client-side session                             */
/* -------------------------------------------------------------------------- */

/** A turn in the live conversation, as the UI sees it. */
export interface VoiceTurn {
  id: string;
  role: "USER" | "ASSISTANT";
  text: string;
  /** True while the turn is still being spoken or transcribed. */
  isPartial: boolean;
  at: number;
}

/** Connection lifecycle, surfaced so the UI can explain what's happening. */
export type VoiceStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "listening"
  | "speaking"
  | "reconnecting"
  | "ended"
  | "error";
