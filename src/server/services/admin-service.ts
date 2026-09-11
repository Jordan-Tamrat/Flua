import "server-only";

import { getProviderManager } from "@/lib/ai/provider-manager";
import { MODEL_REGISTRY } from "@/lib/ai/registry";
import { prisma } from "@/lib/db/client";
import { envIssues, isEnvValid } from "@/lib/config/env";

/**
 * Data for the admin/debug screen.
 *
 * Exists because Flua is designed around free tiers: seeing which provider is
 * actually serving requests, how often failover fires, and how much quota is
 * being spent is operationally necessary rather than a nice-to-have.
 */

export interface AdminOverview {
  config: {
    valid: boolean;
    issues: Array<{ variable: string; message: string }>;
  };
  providers: Array<{
    id: string;
    name: string;
    configured: boolean;
    capabilities: string[];
    order: number;
    models: Array<{ modelId: string; label: string; costTier: string; capabilities: string[] }>;
  }>;
  usage: {
    last24h: {
      total: number;
      successful: number;
      failed: number;
      fallbacks: number;
      avgLatencyMs: number;
      inputTokens: number;
      outputTokens: number;
    };
    byProvider: Array<{
      provider: string;
      requests: number;
      failures: number;
      avgLatencyMs: number;
    }>;
    byRequestType: Array<{ requestType: string; requests: number }>;
  };
  recentEvents: Array<{
    id: string;
    provider: string;
    model: string | null;
    kind: string;
    message: string;
    createdAt: Date;
  }>;
  database: {
    reachable: boolean;
    users: number;
    conversations: number;
    vocabularyItems: number;
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const manager = getProviderManager();
  const statuses = manager.getProviderStatuses();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [usageRows, byProvider, byType, events, counts] = await Promise.all([
    prisma.aIUsage.aggregate({
      where: { createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aIUsage.groupBy({
      by: ["provider"],
      where: { createdAt: { gte: since } },
      _count: true,
      _avg: { latencyMs: true },
    }),
    prisma.aIUsage.groupBy({
      by: ["requestType"],
      where: { createdAt: { gte: since } },
      _count: true,
    }),
    prisma.aIProviderEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        provider: true,
        model: true,
        kind: true,
        message: true,
        createdAt: true,
      },
    }),
    Promise.all([
      prisma.user.count(),
      prisma.conversation.count({ where: { deletedAt: null } }),
      prisma.vocabularyItem.count({ where: { deletedAt: null } }),
      prisma.aIUsage.count({ where: { createdAt: { gte: since }, success: false } }),
      prisma.aIUsage.count({ where: { createdAt: { gte: since }, fallbackTriggered: true } }),
    ]),
  ]);

  const [userCount, conversationCount, vocabCount, failedCount, fallbackCount] = counts;

  const failuresByProvider = await prisma.aIUsage.groupBy({
    by: ["provider"],
    where: { createdAt: { gte: since }, success: false },
    _count: true,
  });

  const failureMap = new Map(failuresByProvider.map((row) => [row.provider, row._count] as const));

  return {
    config: { valid: isEnvValid, issues: envIssues },
    providers: statuses.map((status) => ({
      id: status.id,
      name: status.name,
      configured: status.configured,
      capabilities: status.capabilities,
      order: status.order,
      models: MODEL_REGISTRY.filter((model) => model.provider === status.id).map((model) => ({
        modelId: model.modelId,
        label: model.label,
        costTier: model.costTier,
        capabilities: [...model.capabilities],
      })),
    })),
    usage: {
      last24h: {
        total: usageRows._count,
        successful: usageRows._count - failedCount,
        failed: failedCount,
        fallbacks: fallbackCount,
        avgLatencyMs: Math.round(usageRows._avg.latencyMs ?? 0),
        inputTokens: usageRows._sum.inputTokens ?? 0,
        outputTokens: usageRows._sum.outputTokens ?? 0,
      },
      byProvider: byProvider.map((row) => ({
        provider: row.provider,
        requests: row._count,
        failures: failureMap.get(row.provider) ?? 0,
        avgLatencyMs: Math.round(row._avg.latencyMs ?? 0),
      })),
      byRequestType: byType.map((row) => ({
        requestType: row.requestType,
        requests: row._count,
      })),
    },
    recentEvents: events,
    database: {
      reachable: true,
      users: userCount,
      conversations: conversationCount,
      vocabularyItems: vocabCount,
    },
  };
}
