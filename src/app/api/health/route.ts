import { NextResponse } from "next/server";

import { getProviderManager } from "@/lib/ai/provider-manager";
import { isEnvValid } from "@/lib/config/env";
import { prisma } from "@/lib/db/client";

/**
 * Health check for deployment probes.
 *
 * Reports degraded rather than failing when AI providers are missing: the app
 * genuinely still runs without them, and a probe that fails on a missing
 * optional key would block deploys for no reason.
 */
export async function GET() {
  const checks = {
    config: isEnvValid,
    database: false,
    aiProviderConfigured: false,
  };

  if (isEnvValid) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      checks.aiProviderConfigured = getProviderManager().hasAnyConfiguredProvider();
    } catch {
      checks.aiProviderConfigured = false;
    }
  }

  const healthy = checks.config && checks.database;

  return NextResponse.json(
    {
      status: healthy ? (checks.aiProviderConfigured ? "ok" : "degraded") : "unhealthy",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
