import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GrammarLibrary } from "@/features/grammar/grammar-library";
import { getSession } from "@/lib/auth/session";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";
import { getTopicStats } from "@/server/services/grammar-service";

export const metadata: Metadata = {
  title: "Grammar",
};

export default async function GrammarPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const stats = await getTopicStats(session.userId);

  return (
    <GrammarLibrary
      stats={stats.map((stat) => ({
        category: stat.category,
        label: getGrammarLabel(stat.category),
        accuracy: Math.round(stat.accuracy),
        attempts: stat.attempts,
        trend:
          stat.previousAccuracy === null || stat.attempts < 5
            ? "steady"
            : stat.accuracy - stat.previousAccuracy >= 5
              ? "improving"
              : stat.accuracy - stat.previousAccuracy <= -5
                ? "declining"
                : "steady",
        hasEnoughData: stat.attempts >= 3 || stat.mistakeCount >= 2,
      }))}
    />
  );
}
