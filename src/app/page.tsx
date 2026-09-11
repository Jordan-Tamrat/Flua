import { ArrowRight, BookOpen, MessageCircle, Mic, PenLine } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";

/** Marketing landing page. Signed-in visitors go straight to their dashboard. */
export default async function HomePage() {
  const session = await getSession();
  if (session) {
    redirect("/learn");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between p-6">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg font-bold">
            F
          </span>
          Flua
        </span>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Get started</Link>
          </Button>
        </div>
      </header>

      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center px-6 py-16"
      >
        <div className="w-full max-w-3xl space-y-8 text-center">
          <div className="space-y-4">
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              An English tutor that remembers what you find hard
            </h1>
            <p className="text-muted-foreground mx-auto max-w-xl text-lg text-pretty">
              Practise through real conversation. Flua notices the mistakes you keep making,
              explains them properly, and builds tomorrow&apos;s practice around them.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">
                Start learning
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">I have an account</Link>
            </Button>
          </div>

          <ul className="grid gap-4 pt-8 text-left sm:grid-cols-2">
            <Feature
              icon={<MessageCircle className="text-primary size-5" aria-hidden />}
              title="Real conversation"
              description="Talk naturally. Corrections come afterwards, not mid-sentence."
            />
            <Feature
              icon={<BookOpen className="text-primary size-5" aria-hidden />}
              title="Grammar that targets you"
              description="Practice is built from the mistakes you actually make."
            />
            <Feature
              icon={<PenLine className="text-primary size-5" aria-hidden />}
              title="Writing feedback"
              description="Every change explained, so you learn the reason — not just the fix."
            />
            <Feature
              icon={<Mic className="text-primary size-5" aria-hidden />}
              title="Speaking practice"
              description="Speak out loud and get feedback on what you said."
            />
          </ul>
        </div>
      </main>

      <footer className="text-muted-foreground p-6 text-center text-xs">
        Flua gives an informal estimate of your level to pitch lessons. It isn&apos;t an official
        CEFR assessment.
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="bg-card border-border flex gap-3 rounded-xl border p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{description}</span>
      </span>
    </li>
  );
}
