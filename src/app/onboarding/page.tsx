import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Set up your learning",
};

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true, profile: { select: { onboardingCompletedAt: true } } },
  });

  if (!user) redirect("/login");

  // Onboarding is a one-time gate; going back to it later would overwrite the
  // learner's settings with defaults.
  if (user.profile?.onboardingCompletedAt) {
    redirect("/learn");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="p-6">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg font-bold">
            F
          </span>
          Flua
        </span>
      </header>

      <main id="main-content" className="flex flex-1 items-start justify-center px-4 pb-16">
        <OnboardingFlow initialName={user.name} />
      </main>
    </div>
  );
}
