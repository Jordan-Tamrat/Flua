import "server-only";

import type { AIProviderEventKind, AIRequestType } from "@/generated/prisma";
import { prisma } from "@/lib/db/client";
import type { AIErrorKind } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Persists AI telemetry.
 *
 * Telemetry must never break a learner's request: every write here is
 * fire-and-forget and swallows its own failures. Losing a usage row is
 * acceptable; failing a lesson because the metrics table is unhappy is not.
 */

export interface UsageRecord {
  userId?: string;
  provider: string;
  model: string;
  requestType: AIRequestType;
  capability: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  success: boolean;
  fallbackTriggered: boolean;
  attemptedProviders: string[];
  errorKind?: string;
}

export function recordUsage(record: UsageRecord): void {
  void prisma.aIUsage
    .create({
      data: {
        userId: record.userId ?? null,
        provider: record.provider,
        model: record.model,
        requestType: record.requestType,
        capability: record.capability,
        inputTokens: record.inputTokens ?? null,
        outputTokens: record.outputTokens ?? null,
        latencyMs: record.latencyMs,
        success: record.success,
        fallbackTriggered: record.fallbackTriggered,
        attemptedProviders: record.attemptedProviders,
        errorKind: record.errorKind ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.warn("Failed to record AI usage", { error: String(error) });
    });
}

const ERROR_KIND_TO_EVENT: Record<AIErrorKind, AIProviderEventKind> = {
  auth: "AUTH_ERROR",
  invalid_request: "SERVER_ERROR",
  model_unsupported: "SERVER_ERROR",
  rate_limit: "RATE_LIMIT",
  quota_exceeded: "QUOTA_EXCEEDED",
  timeout: "TIMEOUT",
  network: "NETWORK_ERROR",
  server_error: "SERVER_ERROR",
  content_filtered: "SERVER_ERROR",
  parse_error: "PARSE_ERROR",
  unknown: "SERVER_ERROR",
};

export function providerEventKindFor(kind: AIErrorKind): AIProviderEventKind {
  return ERROR_KIND_TO_EVENT[kind];
}

export interface ProviderEventRecord {
  provider: string;
  model?: string;
  kind: AIProviderEventKind;
  /** Must already be sanitized — no keys, no learner content. */
  message: string;
  requestType?: string;
  latencyMs?: number;
}

export function recordProviderEvent(record: ProviderEventRecord): void {
  void prisma.aIProviderEvent
    .create({
      data: {
        provider: record.provider,
        model: record.model ?? null,
        kind: record.kind,
        message: record.message.slice(0, 500),
        requestType: record.requestType ?? null,
        latencyMs: record.latencyMs ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.warn("Failed to record provider event", { error: String(error) });
    });
}
