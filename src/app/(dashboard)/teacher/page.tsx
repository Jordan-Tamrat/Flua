import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConversationStarter } from "@/features/conversation/conversation-starter";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";
import { listConversations } from "@/server/services/conversation-service";

export const metadata: Metadata = {
  title: "Teacher",
};

const FALLBACK_QUESTIONS = [
  "Explain the present perfect",
  "The difference between since and for",
  "When do I use 'the'?",
  "How do conditionals work?",
];

export default async function TeacherPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [conversations, weakest] = await Promise.all([
    listConversations(session.userId, { mode: "TEACHER", limit: 8 }),
    prisma.grammarTopicStat.findMany({
      where: {
        userId: session.userId,
        OR: [{ attempts: { gte: 3 } }, { mistakeCount: { gte: 2 } }],
      },
      orderBy: { accuracy: "asc" },
      take: 3,
      select: { category: true },
    }),
  ]);

  // Suggesting the learner's own weak areas turns a blank page into a targeted
  // starting point.
  const suggestions =
    weakest.length > 0
      ? weakest.map((stat) => `Explain ${getGrammarLabel(stat.category).toLowerCase()}`)
      : FALLBACK_QUESTIONS;

  return (
    <ConversationStarter
      mode="TEACHER"
      recent={conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        topic: conversation.topic,
        messageCount: conversation.messageCount,
        updatedAt: conversation.updatedAt.toISOString(),
        endedAt: conversation.endedAt?.toISOString() ?? null,
      }))}
      suggestedTopics={suggestions}
    />
  );
}
