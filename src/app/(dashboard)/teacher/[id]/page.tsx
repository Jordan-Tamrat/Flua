import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ConversationView } from "@/features/conversation/conversation-view";
import { loadConversationPageData } from "@/features/conversation/load-conversation";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Teacher",
};

export default async function TeacherSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

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
