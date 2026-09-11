import type { AICapability, ProviderId } from "@/lib/ai/types";

/**
 * Central model registry.
 *
 * This is the ONLY place in the application where concrete model identifiers
 * appear. Business logic asks for a *task*; the router resolves the task to a
 * (provider, model) pair using the entries below.
 *
 * Keeping cost tiers explicit matters because Flua is designed around free
 * tiers: a vocabulary drill should not burn the same quota as a long tutoring
 * explanation.
 */

/** Coarse cost/latency classes used for routing, not billing. */
export type CostTier = "light" | "standard" | "premium";

export interface ModelDefinition {
  provider: ProviderId;
  /** Identifier passed verbatim to the provider SDK. */
  modelId: string;
  /** Human-friendly label for the admin screen. */
  label: string;
  capabilities: readonly AICapability[];
  costTier: CostTier;
  /** Context window in tokens, when the provider documents one. */
  contextTokens?: number;
  /** Lower numbers are preferred within the same provider and task. */
  priority: number;
  /**
   * Reasoning-token budget for models that "think" before answering.
   *
   * This matters more than it looks: a thinking model spends its output budget
   * on reasoning first, so a small `maxOutputTokens` can be entirely consumed
   * before any visible text is produced — the reply then arrives truncated or
   * empty. Flua's tutoring calls want short, fast, conversational replies, not
   * extended reasoning, so thinking is disabled where the model supports it.
   *
   * Leave undefined for models that don't accept the setting (some reject an
   * explicit 0 outright) or that don't think by default.
   */
  thinkingBudget?: number;
  notes?: string;
}

/**
 * Task types the application can ask for. Each maps to a capability plus a
 * preferred cost tier.
 */
export type AITask =
  | "conversation"
  | "teacher"
  | "grammar_analysis"
  | "grammar_exercise"
  | "vocabulary"
  | "writing_analysis"
  | "speaking_analysis"
  | "level_assessment"
  | "memory_extraction"
  | "summarization"
  | "session_feedback"
  | "transcription";

export interface TaskRequirements {
  capability: AICapability;
  /** Preferred cost tier; the router falls back to any tier if unavailable. */
  preferredTier: CostTier;
  /** When true, the task additionally needs streaming support. */
  requiresStreaming?: boolean;
}

export const TASK_REQUIREMENTS: Record<AITask, TaskRequirements> = {
  // Natural conversation is streamed so the learner sees replies progressively.
  conversation: { capability: "TEXT", preferredTier: "standard", requiresStreaming: true },
  teacher: { capability: "TEXT", preferredTier: "standard", requiresStreaming: true },

  // Anything that feeds a Zod schema needs structured output.
  grammar_analysis: { capability: "STRUCTURED_OUTPUT", preferredTier: "standard" },
  grammar_exercise: { capability: "STRUCTURED_OUTPUT", preferredTier: "light" },
  vocabulary: { capability: "STRUCTURED_OUTPUT", preferredTier: "light" },
  writing_analysis: { capability: "STRUCTURED_OUTPUT", preferredTier: "standard" },
  speaking_analysis: { capability: "STRUCTURED_OUTPUT", preferredTier: "standard" },
  level_assessment: { capability: "STRUCTURED_OUTPUT", preferredTier: "standard" },
  session_feedback: { capability: "STRUCTURED_OUTPUT", preferredTier: "standard" },

  // Background housekeeping — cheapest model that can do the job.
  memory_extraction: { capability: "STRUCTURED_OUTPUT", preferredTier: "light" },
  summarization: { capability: "TEXT", preferredTier: "light" },

  transcription: { capability: "SPEECH_TO_TEXT", preferredTier: "light" },
};

const TEXT_ALL: readonly AICapability[] = ["TEXT", "STREAMING", "STRUCTURED_OUTPUT"];

/**
 * Registered models.
 *
 * Free-tier notes reflect the providers' published free offerings at the time
 * of writing. Free tiers change without notice — treat these as hints, not
 * guarantees, and check the provider dashboards for current limits.
 */
export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  /* ------------------------------- Gemini -------------------------------- */
  /*
   * Flash Lite is the workhorse for BOTH tiers, which looks odd until you see
   * the free-tier quotas: Flash allows 20 requests/day, Flash Lite allows 500.
   * One conversation plus its feedback and memory extraction is roughly eight
   * requests, so Flash alone would run out after two sessions.
   *
   * Quality is not the tradeoff it appears to be. Flash Lite produces complete,
   * natural replies and accurate structured analysis, while Flash *thinks*
   * before answering — hundreds of reasoning tokens that Flua's short tutoring
   * replies gain nothing from, and that truncate the reply when the budget runs
   * out. Flash is therefore registered but deliberately deprioritised.
   */
  {
    provider: "gemini",
    modelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    capabilities: TEXT_ALL,
    costTier: "standard",
    contextTokens: 1_000_000,
    priority: 10,
    // Deliberately unset: this model doesn't think by default and rejects an
    // explicit budget of 0 as an invalid argument.
    notes: "Primary model. Free tier: 15 RPM / 500 requests per day.",
  },
  {
    provider: "gemini",
    modelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite (light tasks)",
    capabilities: TEXT_ALL,
    costTier: "light",
    contextTokens: 1_000_000,
    priority: 10,
    notes: "Same model for drills, summaries and memory extraction.",
  },
  {
    provider: "gemini",
    modelId: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    capabilities: [...TEXT_ALL, "VISION"],
    costTier: "premium",
    contextTokens: 1_000_000,
    priority: 90,
    // Thinks by default; suppressing it is unreliable, so the budget is capped
    // rather than zeroed and the model is kept out of the routine path.
    thinkingBudget: 0,
    notes:
      "Stronger but heavily rate-limited (20 requests/day) and spends tokens on reasoning. No task routes here by default.",
  },

  /* -------------------------------- Groq --------------------------------- */
  {
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    capabilities: TEXT_ALL,
    costTier: "standard",
    contextTokens: 128_000,
    priority: 10,
    notes: "Very fast inference. Verified for conversation and JSON output.",
  },
  {
    provider: "groq",
    modelId: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Groq)",
    capabilities: TEXT_ALL,
    costTier: "light",
    contextTokens: 128_000,
    priority: 20,
    notes: "Lightweight tasks; smaller and cheaper against the free-tier allowance.",
  },
  {
    provider: "groq",
    modelId: "whisper-large-v3-turbo",
    label: "Whisper Large v3 Turbo (Groq)",
    capabilities: ["SPEECH_TO_TEXT"],
    costTier: "light",
    priority: 10,
    notes: "Speech-to-text for Speaking mode. The only STT provider configured by default.",
  },

  /* ----------------------------- OpenRouter ------------------------------ */
  /*
   * Last-resort tier. OpenRouter's `:free` routes share an upstream pool, so
   * 429s are routine rather than exceptional — which is exactly why this
   * provider sits third. Two models are registered so a rate-limited primary
   * still leaves a route.
   */
  {
    provider: "openrouter",
    modelId: "liquid/lfm-2.5-2.6b:free",
    label: "LFM 2.5 2.6B (OpenRouter free)",
    capabilities: TEXT_ALL,
    costTier: "standard",
    contextTokens: 65_536,
    priority: 10,
    notes: "Verified: follows conversation instructions and returns valid JSON.",
  },
  {
    provider: "openrouter",
    modelId: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B (OpenRouter free)",
    capabilities: TEXT_ALL,
    costTier: "light",
    contextTokens: 262_144,
    priority: 20,
    notes:
      "Larger, but frequently 429s on the shared free pool. OpenRouter rotates its `:free` catalogue — check https://openrouter.ai/models?q=free if this stops resolving.",
  },
];

/** All models a provider offers. */
export function getModelsForProvider(provider: ProviderId): ModelDefinition[] {
  return MODEL_REGISTRY.filter((model) => model.provider === provider);
}

/**
 * Picks the best model a given provider can offer for a task.
 *
 * Preference order: exact cost tier first, then any other tier, and within each
 * group the lowest `priority` wins. Returns `null` when the provider cannot
 * serve the required capability at all — which is how the ProviderManager knows
 * to skip it rather than send a doomed request.
 */
export function selectModelForTask(provider: ProviderId, task: AITask): ModelDefinition | null {
  const requirements = TASK_REQUIREMENTS[task];

  const candidates = MODEL_REGISTRY.filter((model) => {
    if (model.provider !== provider) return false;
    if (!model.capabilities.includes(requirements.capability)) return false;
    if (requirements.requiresStreaming && !model.capabilities.includes("STREAMING")) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    const aTierMatch = a.costTier === requirements.preferredTier ? 0 : 1;
    const bTierMatch = b.costTier === requirements.preferredTier ? 0 : 1;
    if (aTierMatch !== bTierMatch) return aTierMatch - bTierMatch;
    return a.priority - b.priority;
  });

  return sorted[0] ?? null;
}

/** True when the provider has at least one model for the task. */
export function providerSupportsTask(provider: ProviderId, task: AITask): boolean {
  return selectModelForTask(provider, task) !== null;
}
