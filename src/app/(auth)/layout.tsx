import Link from "next/link";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/toast";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="p-6">
          <Link
            href="/"
            className="focus-visible:outline-ring inline-flex items-center gap-2 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2"
          >
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg font-bold">
              F
            </span>
            Flua
          </Link>
        </header>

        <main id="main-content" className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
