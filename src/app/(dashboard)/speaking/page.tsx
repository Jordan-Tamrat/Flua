import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VoiceConversation } from "@/features/voice/voice-conversation";
import { VOICE_SCENARIOS } from "@/lib/ai/prompts/voice";
import { isVoiceAvailable } from "@/lib/ai/voice/voice-service";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Speaking",
};

export default async function SpeakingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user, voiceAvailable] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    }),
    Promise.resolve(isVoiceAvailable()),
  ]);

  return (
    <VoiceConversation
      scenarios={VOICE_SCENARIOS}
      voiceAvailable={voiceAvailable}
      learnerName={user?.name ?? "You"}
    />
  );
}
