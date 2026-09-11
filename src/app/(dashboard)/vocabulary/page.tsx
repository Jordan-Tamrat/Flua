import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { VocabularyView } from "@/features/vocabulary/vocabulary-view";
import { getSession } from "@/lib/auth/session";
import { listVocabulary, getVocabularyStats } from "@/server/services/vocabulary-service";
import type { VocabularyStatus } from "@/generated/prisma";

export const metadata: Metadata = {
  title: "Vocabulary",
};

const VALID_STATUSES: readonly string[] = ["NEW", "LEARNING", "FAMILIAR", "MASTERED"];

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; due?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const status =
    params.status && VALID_STATUSES.includes(params.status)
      ? (params.status as VocabularyStatus)
      : undefined;

  const [list, stats] = await Promise.all([
    listVocabulary(session.userId, {
      status,
      dueOnly: false,
      limit: 100,
      offset: 0,
    }),
    getVocabularyStats(session.userId),
  ]);

  return (
    <Suspense fallback={null}>
      <VocabularyView
        total={stats.total}
        dueCount={stats.due}
        // `?due=1` from the dashboard drops the learner straight into review.
        startInReview={params.due === "1"}
        initialItems={list.items.map((item) => ({
          id: item.id,
          word: item.word,
          definition: item.definition,
          partOfSpeech: item.partOfSpeech,
          exampleSentence: item.exampleSentence,
          synonyms: item.synonyms,
          difficulty: item.difficulty,
          status: item.status,
          dueAt: item.dueAt.toISOString(),
          reviewCount: item.reviewCount,
          successCount: item.successCount,
        }))}
      />
    </Suspense>
  );
}
