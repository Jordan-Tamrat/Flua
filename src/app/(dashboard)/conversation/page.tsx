import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConversationStarter } from "@/features/conversation/conversation-starter";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { listConversations } from "@/server/services/conversation-service";

export const metadata: Metadata = {
  title: "Conversation",
};

/** Generic openers, used when a learner hasn't picked any topics. */
const FALLBACK_TOPICS = [
  "My week so far",
  "Something I'm looking forward to",
  "A place I'd like to visit",
  "What I do for work or study",
];

export default async function ConversationPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [conversations, profile] = await Promise.all([
    listConversations(session.userId, { mode: "CONVERSATION", limit: 8 }),
    prisma.profile.findUnique({
      where: { userId: session.userId },
      select: { preferredTopics: true, interests: true },
    }),
  ]);

  const learnerTopics = [
    ...new Set([...(profile?.preferredTopics ?? []), ...(profile?.interests ?? [])]),
  ].slice(0, 4);

  return (
    <ConversationStarter
      mode="CONVERSATION"
      recent={conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        topic: conversation.topic,
        messageCount: conversation.messageCount,
        updatedAt: conversation.updatedAt.toISOString(),
        endedAt: conversation.endedAt?.toISOString() ?? null,
      }))}
      suggestedTopics={learnerTopics.length > 0 ? learnerTopics : FALLBACK_TOPICS}
    />
  );
}
