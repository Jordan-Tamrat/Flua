import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { MobileNav } from "@/components/layout/mobile-nav";
import { Sidebar } from "@/components/layout/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { getSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/client";

/**
 * The signed-in shell.
 *
 * Middleware redirects requests with no session cookie, but the cookie is only
 * checked for presence there. This layout does the real verification, so a
 * forged cookie gets no further than here.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      name: true,
      email: true,
      profile: {
        select: {
          currentStreak: true,
          estimatedLevel: true,
          onboardingCompletedAt: true,
        },
      },
    },
  });

  // The session cookie outlived its account (deleted user, or a database reset
  // in development). Treat it as signed out rather than rendering an empty app.
  if (!user) {
    redirect("/login");
  }

  if (!user.profile?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  const isAdmin = getEnv().ADMIN_EMAILS.includes(user.email.toLowerCase());

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col md:flex-row">
        <Sidebar
          userName={user.name}
          currentStreak={user.profile.currentStreak}
          estimatedLevel={user.profile.estimatedLevel}
          isAdmin={isAdmin}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main-content" className="flex-1 pb-20 md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </ToastProvider>
  );
}
