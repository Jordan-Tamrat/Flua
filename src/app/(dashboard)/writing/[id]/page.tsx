import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { WritingFeedback } from "@/features/writing/writing-feedback";
import { writingAnalysisSchema } from "@/lib/ai/schemas";
import { getSession } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { getSubmission } from "@/server/services/writing-service";

export const metadata: Metadata = {
  title: "Writing",
};

export default async function WritingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const submission = await getSubmission(session.userId, id).catch((error: unknown) => {
    // A missing submission and someone else's submission both surface as
    // NotFound, so neither can be distinguished from the outside.
    if (error instanceof NotFoundError) return null;
    throw error;
  });

  if (!submission) notFound();

  // Stored analyses are re-validated: one written before a schema change would
  // otherwise crash the page rather than degrade gracefully.
  const parsed = submission.analysis ? writingAnalysisSchema.safeParse(submission.analysis) : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <Link
        href="/writing"
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex items-center gap-1.5 rounded text-sm focus-visible:outline-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All writing
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {submission.title ?? `Untitled ${submission.kind.toLowerCase()}`}
        </h1>
        <p className="text-muted-foreground text-sm">
          {submission.wordCount} words · {submission.createdAt.toLocaleDateString()}
        </p>
      </header>

      {parsed?.success ? (
        <WritingFeedback analysis={parsed.data} original={submission.content} />
      ) : (
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-muted-foreground text-sm">No feedback is stored for this piece.</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{submission.content}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
