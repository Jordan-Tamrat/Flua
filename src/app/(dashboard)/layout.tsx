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
      {/*
        Fixed to the viewport rather than growing with the page.
        `min-h-dvh` let the row grow to the tallest child, so a long page
        stretched the sidebar with it and scrolled the navigation off screen.
        Pinning the shell to the viewport height and letting only `main` scroll
        keeps the sidebar in one place whatever the content does.
      */}
      <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
        <Sidebar
          userName={user.name}
          currentStreak={user.profile.currentStreak}
          estimatedLevel={user.profile.estimatedLevel}
          isAdmin={isAdmin}
        />

        {/*
          Scrolling moves from the page to `main` on desktop only. On mobile the
          sidebar is a sticky header inside this same column, and an inner
          scroller there would fight the browser's own address-bar behaviour.
        */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main id="main-content" className="min-h-0 flex-1 pb-20 md:overflow-y-auto md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </ToastProvider>
  );
}
