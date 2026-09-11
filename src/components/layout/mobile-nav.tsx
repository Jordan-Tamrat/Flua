"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_NAV_ITEMS } from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for phones.
 *
 * Thumb-reachable, and padded for the home-indicator safe area so the last row
 * of buttons isn't sitting under it.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Main"
    >
      <ul className="flex items-stretch justify-around">
        {MOBILE_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-visible:outline-ring flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
