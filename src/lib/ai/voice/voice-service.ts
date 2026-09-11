import "server-only";

import { buildVoiceSystemPrompt, getVoiceScenario } from "@/lib/ai/prompts/voice";
import type { LearnerContext } from "@/lib/ai/prompts/shared";
import { GeminiLiveProvider } from "@/lib/ai/voice/providers/gemini-live";
import type { VoiceProvider, VoiceSessionGrant } from "@/lib/ai/voice/types";
import { getEnv } from "@/lib/config/env";
import { AINotConfiguredError } from "@/lib/errors";

/**
 * The application's entry point to live voice.
 *
 * Mirrors `AIService`'s role for text: feature code asks for a session, never
 * for a provider. Only one live-voice provider exists today, so there is no
 * failover chain — but the lookup goes through a registry so adding a second
 * adapter doesn't change any calling code.
 */

let providersCache: VoiceProvider[] | null = null;

function getProviders(): VoiceProvider[] {
  if (!providersCache) {
    const env = getEnv();
    providersCache = [new GeminiLiveProvider({ apiKey: env.GEMINI_API_KEY })];
  }
  return providersCache;
}

/** Test/dev hook — drops the cache so new env values take effect. */
export function resetVoiceProviders(): void {
  providersCache = null;
}

/** True when at least one provider can host a live conversation. */
export function isVoiceAvailable(): boolean {
  return getProviders().some((provider) => provider.isConfigured());
}

/** Provider status for the admin screen. */
export function getVoiceProviderStatuses() {
  return getProviders().map((provider) => ({
    id: provider.getProviderName(),
    configured: provider.isConfigured(),
    capabilities: [...provider.getCapabilities()],
  }));
}

export interface CreateVoiceSessionParams {
  context: LearnerContext;
  /** Scenario id from `VOICE_SCENARIOS`, or undefined for free conversation. */
  scenarioId?: string;
  voice?: string;
}

/**
 * Mints a grant the browser can use to open one live session.
 *
 * The tutor's system prompt is assembled here and locked into the token, so the
 * learner's own microphone input can never redefine the tutor's behaviour —
 * the prompt-injection boundary holds in voice exactly as it does in text.
 */
export async function createVoiceSession(
  params: CreateVoiceSessionParams,
): Promise<VoiceSessionGrant> {
  const provider = getProviders().find((candidate) => candidate.isConfigured());

  if (!provider) {
    throw new AINotConfiguredError("live voice conversation");
  }

  const scenario = params.scenarioId ? getVoiceScenario(params.scenarioId) : undefined;

  const systemInstruction = buildVoiceSystemPrompt(params.context, {
    scenario: scenario && scenario.id !== "free-chat" ? scenario.description : undefined,
    scenarioBrief: scenario?.brief,
  });

  return provider.createSessionGrant({
    systemInstruction,
    voice: params.voice,
  });
}
