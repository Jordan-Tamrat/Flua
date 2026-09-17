import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ErrorDrill } from "@/features/practice/error-drill";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Practice",
};

/**
 * Retrieval practice on the learner's own mistakes.
 *
 * The queue is fetched client-side rather than here, because working through it
 * is a sequence of attempts and answers — rendering it server-side would mean a
 * round trip and a full page render per question.
 */
export default async function PracticePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fix what you said</h1>
        <p className="text-muted-foreground text-sm">
          Sentences from your own conversations, back a day or two later while they&apos;re still
          worth revisiting. Getting one right three times retires it.
        </p>
      </header>

      <ErrorDrill />
    </div>
  );
}
