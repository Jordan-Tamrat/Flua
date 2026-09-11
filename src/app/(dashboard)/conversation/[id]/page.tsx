import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ConversationView } from "@/features/conversation/conversation-view";
import { loadConversationPageData } from "@/features/conversation/load-conversation";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Conversation",
};

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  // Loading is kept out of the JSX return so the not-found branch resolves
  // before any component is constructed.
  const data = await loadConversationPageData(id, session.userId);
  if (!data) notFound();

  return (
    <ConversationView
      conversationId={data.conversationId}
      mode={data.mode}
      isEnded={data.isEnded}
      initialFeedback={data.feedback}
      voiceSpeed={data.voiceSpeed}
      initialMessages={data.messages}
    />
  );
}
