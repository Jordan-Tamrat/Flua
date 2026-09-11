import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VoiceConversation } from "@/features/voice/voice-conversation";
import { VOICE_SCENARIOS } from "@/lib/ai/prompts/voice";
import { isVoiceAvailable } from "@/lib/ai/voice/voice-service";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { listConversations } from "@/server/services/conversation-service";

export const metadata: Metadata = {
  title: "Speaking",
};

export default async function SpeakingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user, voiceAvailable, pastSessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    }),
    Promise.resolve(isVoiceAvailable()),
    // Spoken sessions are saved as SPEAKING conversations. Listing them here is
    // what makes "your practice has been saved" verifiable.
    listConversations(session.userId, { mode: "SPEAKING", limit: 6 }),
  ]);

  return (
    <VoiceConversation
      scenarios={VOICE_SCENARIOS}
      voiceAvailable={voiceAvailable}
      learnerName={user?.name ?? "You"}
      pastSessions={pastSessions.map((item) => ({
        id: item.id,
        title: item.title,
        topic: item.topic,
        messageCount: item.messageCount,
        endedAt: item.endedAt?.toISOString() ?? null,
        updatedAt: item.updatedAt.toISOString(),
      }))}
    />
  );
}
