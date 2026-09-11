import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsView } from "@/features/settings/settings-view";
import { getSession } from "@/lib/auth/session";
import { getProfile } from "@/server/services/profile-service";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await getProfile(session.userId);
  const profile = user.profile!;

  return (
    <SettingsView
      initial={{
        name: user.name,
        email: user.email,
        targetLevel: profile.targetLevel,
        estimatedLevel: profile.estimatedLevel,
        levelConfidence: profile.levelConfidence,
        dailyGoalMinutes: profile.dailyGoalMinutes,
        correctionStyle: profile.correctionStyle,
        conversationDifficulty: profile.conversationDifficulty,
        voiceSpeed: profile.voiceSpeed,
        responseStyle: profile.responseStyle,
      }}
    />
  );
}
