"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary.
 *
 * Deliberately vague to the user — the real detail is in the server logs, keyed
 * by the digest shown here. Showing a stack trace would leak internals.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side errors never reach the server logger, so this is the only
    // record of them.
    console.error("Unhandled application error", error.digest ?? error.message);
  }, [error]);

  // A missing/invalid .env is the overwhelmingly likely cause during setup, and
  // it deserves a useful message rather than a generic apology.
  const looksLikeConfiguration = error.message.includes("Flua is not configured correctly");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-lg space-y-4">
        {looksLikeConfiguration ? (
          <Alert variant="warning">
            <AlertCircle aria-hidden />
            <AlertTitle>Flua isn&apos;t configured yet</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Some required environment variables are missing or invalid. Copy{" "}
                <code className="text-xs">.env.example</code> to{" "}
                <code className="text-xs">.env</code> and fill in{" "}
                <code className="text-xs">DATABASE_URL</code> and{" "}
                <code className="text-xs">AUTH_SECRET</code>.
              </p>
              <p className="text-xs">
                The server console lists exactly which values need attention.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>
              <p>We hit an unexpected problem. Trying again often works.</p>
              {error.digest ? (
                <p className="mt-2 text-xs">
                  Reference: <code>{error.digest}</code>
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={reset} className="w-full">
          <RotateCcw className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    </div>
  );
}
