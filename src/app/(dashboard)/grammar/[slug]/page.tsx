import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { GrammarPractice } from "@/features/grammar/grammar-practice";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { getGrammarCategory } from "@/lib/learning/grammar-taxonomy";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = getGrammarCategory(slug);
  return { title: category?.label ?? "Grammar" };
}

export default async function GrammarTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { slug } = await params;
  const category = getGrammarCategory(slug);

  if (!category) notFound();

  const stat = await prisma.grammarTopicStat.findUnique({
    where: { userId_category: { userId: session.userId, category: slug } },
    select: { accuracy: true, attempts: true, mistakeCount: true },
  });

  // Show a score only once there's enough behind it to mean something.
  const hasEnoughData = stat ? stat.attempts >= 3 || stat.mistakeCount >= 2 : false;

  return (
    <GrammarPractice
      categorySlug={category.slug}
      categoryLabel={category.label}
      categorySummary={category.summary}
      commonMistake={category.commonMistake}
      accuracy={hasEnoughData && stat ? Math.round(stat.accuracy) : null}
    />
  );
}
