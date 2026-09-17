"use client";

import { Flame, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { NAV_ITEMS } from "@/components/layout/nav-items";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface SidebarProps {
  userName: string;
  currentStreak: number;
  estimatedLevel: string;
  isAdmin: boolean;
}

export function Sidebar({ userName, currentStreak, estimatedLevel, isAdmin }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  /*
   * The drawer stores the path it was opened on rather than a boolean. It is
   * open only while that still matches the current path, so navigating anywhere
   * closes it without an effect that mirrors `pathname` into state.
   */
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const isMobileOpen = openedOnPath === pathname;

  const setIsMobileOpen = useCallback(
    (open: boolean) => setOpenedOnPath(open ? pathname : null),
    [pathname],
  );

  // An open drawer is a modal surface; Escape must dismiss it.
  useEffect(() => {
    if (!isMobileOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenedOnPath(null);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobileOpen]);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await apiPost("/api/auth/logout");
      router.push("/login");
      router.refresh();
    } catch {
      setIsSigningOut(false);
    }
  }

  const navigation = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-visible:outline-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}

      {isAdmin ? (
        <Link
          href="/admin"
          aria-current={pathname.startsWith("/admin") ? "page" : undefined}
          className={cn(
            "focus-visible:outline-ring mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2",
            pathname.startsWith("/admin")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <span className="size-4 shrink-0 text-center text-xs" aria-hidden>
            ⚙
          </span>
          Admin
        </Link>
      ) : null}
    </nav>
  );

  const footer = (
    <div className="border-sidebar-border space-y-3 border-t p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="text-muted-foreground text-xs">Level {estimatedLevel}</p>
        </div>
        <ThemeToggle />
      </div>

      {currentStreak > 0 ? (
        <div className="bg-accent/60 text-accent-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium">
          <Flame className="size-3.5" aria-hidden />
          {currentStreak} day{currentStreak === 1 ? "" : "s"} in a row
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground w-full justify-start"
        onClick={handleSignOut}
        disabled={isSigningOut}
      >
        <LogOut className="size-4" aria-hidden />
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );

  return (
    <>
      {/* Mobile header */}
      <header className="bg-background/95 border-border sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur md:hidden">
        <Link href="/learn" className="flex items-center gap-2 font-semibold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg text-sm font-bold">
            F
          </span>
          Flua
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={isMobileOpen}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </header>

      {/* Mobile drawer */}
      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close navigation menu"
          />
          <div className="bg-sidebar absolute inset-y-0 left-0 flex w-72 animate-[slide-up_0.2s_ease-out] flex-col shadow-xl">
            <div className="border-sidebar-border flex items-center justify-between border-b px-4 py-3">
              <span className="font-semibold">Flua</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsMobileOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {navigation}
            {footer}
          </div>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      {/*
        `h-full` against the viewport-locked shell, so the sidebar is always
        exactly one screen tall. Its `nav` already scrolls internally, which
        matters once the nav list is longer than a short window.
      */}
      <aside className="bg-sidebar border-sidebar-border hidden h-full w-64 shrink-0 flex-col border-r md:flex">
        <div className="border-sidebar-border border-b px-4 py-4">
          <Link
            href="/learn"
            className="focus-visible:outline-ring flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2"
          >
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg font-bold">
              F
            </span>
            Flua
          </Link>
        </div>
        {navigation}
        {footer}
      </aside>
    </>
  );
}
