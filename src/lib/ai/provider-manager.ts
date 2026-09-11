import "server-only";

import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { GroqProvider } from "@/lib/ai/providers/groq";
import { OpenRouterProvider } from "@/lib/ai/providers/openrouter";
import { selectModelForTask, type AITask, type ModelDefinition } from "@/lib/ai/registry";
import type { AICapability, AIProvider, ProviderId } from "@/lib/ai/types";
import { getEnv } from "@/lib/config/env";
import { AIProviderError, type AIErrorKind } from "@/lib/errors";

/**
 * Owns the set of provider adapters and the order in which they are attempted.
 *
 * Adding a provider means: write an adapter, add it to `buildProviders`, add
 * its models to the registry, and add its key to the env schema. Nothing in
 * conversation, grammar, writing or any other feature changes.
 */

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  configured: boolean;
  capabilities: AICapability[];
  /** Position in the failover order; -1 when not part of it. */
  order: number;
}

/** One resolved step in a failover plan. */
export interface RouteCandidate {
  provider: AIProvider;
  providerId: ProviderId;
  model: ModelDefinition;
}

function buildProviders(): Map<ProviderId, AIProvider> {
  const env = getEnv();

  const providers = new Map<ProviderId, AIProvider>();

  providers.set(
    "gemini",
    new GeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    }),
  );

  providers.set(
    "groq",
    new GroqProvider({
      apiKey: env.GROQ_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    }),
  );

  providers.set(
    "openrouter",
    new OpenRouterProvider({
      apiKey: env.OPENROUTER_API_KEY,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    }),
  );

  return providers;
}

export class ProviderManager {
  private readonly providers: Map<ProviderId, AIProvider>;
  private readonly order: ProviderId[];

  constructor() {
    this.providers = buildProviders();

    const env = getEnv();
    // Deduplicate while preserving the configured order, so setting the same
    // provider twice in .env doesn't create a pointless repeat attempt.
    const configured = [
      env.PRIMARY_AI_PROVIDER,
      env.SECONDARY_AI_PROVIDER,
      env.TERTIARY_AI_PROVIDER,
    ];
    this.order = [...new Set(configured)];
  }

  /** Every known provider with its configuration state, for the admin screen. */
  getProviderStatuses(): ProviderStatus[] {
    return [...this.providers.entries()].map(([id, provider]) => ({
      id,
      name: provider.getProviderName(),
      configured: provider.isConfigured(),
      capabilities: [...provider.getCapabilities().supports],
      order: this.order.indexOf(id),
    }));
  }

  /** True when at least one provider has credentials. */
  hasAnyConfiguredProvider(): boolean {
    return [...this.providers.values()].some((provider) => provider.isConfigured());
  }

  getProvider(id: ProviderId): AIProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Builds the ordered list of (provider, model) pairs to try for a task.
   *
   * A provider is included only when it is configured, declares the required
   * capability, and has a registered model for the task — so an incompatible
   * provider is never attempted. This is the "do not blindly fall back to an
   * incompatible provider" rule, enforced structurally.
   */
  buildRoute(task: AITask, requiredCapability: AICapability): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];

    for (const providerId of this.order) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;
      if (!provider.isConfigured()) continue;
      if (!provider.getCapabilities().supports.has(requiredCapability)) continue;

      const model = selectModelForTask(providerId, task);
      if (!model) continue;

      candidates.push({ provider, providerId, model });
    }

    return candidates;
  }
}

/**
 * Process-wide singleton. Adapters are stateless apart from a lazily created
 * SDK client, so sharing one manager avoids rebuilding clients per request.
 */
let managerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  managerInstance ??= new ProviderManager();
  return managerInstance;
}

/** Test/dev hook: drops the cached manager so new env values take effect. */
export function resetProviderManager(): void {
  managerInstance = null;
}

/* -------------------------------------------------------------------------- */
/*                              Retry primitives                              */
/* -------------------------------------------------------------------------- */

export interface AttemptRecord {
  provider: string;
  kind: AIErrorKind;
  message: string;
}

/** Exponential backoff with jitter, bounded so a request never hangs for long. */
export function backoffDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, 8_000);
  }
  const base = Math.min(500 * 2 ** attempt, 4_000);
  // Jitter avoids synchronized retries when several requests fail together.
  return base + Math.floor(Math.random() * 250);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}
