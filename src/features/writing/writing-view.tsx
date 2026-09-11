"use client";

import { Loader2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WritingFeedback } from "@/features/writing/writing-feedback";
import type { WritingAnalysis } from "@/lib/ai/schemas";
import { ApiError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * The writing composer.
 *
 * Feedback replaces the editor rather than sitting beside it, so the learner
 * reads the explanations instead of skimming past them to a rewritten version.
 */

const KINDS = [
  { value: "JOURNAL", label: "Journal" },
  { value: "EMAIL", label: "Email" },
  { value: "ESSAY", label: "Essay" },
  { value: "STORY", label: "Story" },
  { value: "OPINION", label: "Opinion" },
  { value: "MESSAGE", label: "Message" },
  { value: "PROFESSIONAL", label: "Work" },
] as const;

interface PastSubmission {
  id: string;
  kind: string;
  title: string | null;
  wordCount: number;
  overallScore: number | null;
  createdAt: string;
}

export function WritingView({ recent }: { recent: PastSubmission[] }) {
  const router = useRouter();

  const [kind, setKind] = useState<string>("JOURNAL");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [analysis, setAnalysis] = useState<WritingAnalysis | null>(null);
  const [submittedText, setSubmittedText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  async function handleSuggestPrompt() {
    setIsPrompting(true);
    setError(null);

    try {
      const result = await apiPost<{ prompt: string }>("/api/writing/prompt", { kind });
      setPrompt(result.prompt);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't suggest a prompt.");
    } finally {
      setIsPrompting(false);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await apiPost<{ analysis: WritingAnalysis }>("/api/ai/writing", {
        kind,
        title: title.trim() || undefined,
        prompt: prompt.trim() || undefined,
        content: content.trim(),
      });

      setSubmittedText(content.trim());
      setAnalysis(result.analysis);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't analyse that.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setAnalysis(null);
    setContent("");
    setTitle("");
    setPrompt("");
    setSubmittedText("");
  }

  if (analysis) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
        <WritingFeedback analysis={analysis} original={submittedText} />
        <Button onClick={handleReset} className="w-full sm:w-auto">
          Write something else
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Writing</h1>
        <p className="text-muted-foreground text-sm">
          Write something and get feedback on every change — with the reason, not just the fix.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">What are you writing?</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKind(option.value)}
                  aria-pressed={kind === option.value}
                  className={cn(
                    "focus-visible:outline-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                    kind === option.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt">Prompt (optional)</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSuggestPrompt}
                disabled={isPrompting}
              >
                {isPrompting ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Wand2 className="size-3.5" aria-hidden />
                )}
                Suggest one
              </Button>
            </div>
            <Input
              id="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What are you responding to?"
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="content">Your writing</Label>
              <span className="text-muted-foreground text-xs">
                {wordCount} word{wordCount === 1 ? "" : "s"}
              </span>
            </div>
            <Textarea
              id="content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Start writing…"
              className="min-h-64"
              maxLength={10_000}
            />
            {content.trim().length > 0 && content.trim().length < 20 ? (
              <p className="text-muted-foreground text-xs">
                Write a couple more sentences so there&apos;s something to give feedback on.
              </p>
            ) : null}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || content.trim().length < 20}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Reading it…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden />
                Get feedback
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {recent.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Earlier writing</h2>
          <ul className="space-y-2">
            {recent.map((submission) => (
              <li key={submission.id}>
                <Link
                  href={`/writing/${submission.id}`}
                  className="focus-visible:outline-ring block rounded-xl focus-visible:outline-2"
                >
                  <Card className="hover:border-primary/40 transition-colors">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {submission.title ?? `Untitled ${submission.kind.toLowerCase()}`}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {submission.wordCount} words
                        </p>
                      </div>
                      {submission.overallScore !== null ? (
                        <Badge variant={submission.overallScore >= 75 ? "success" : "secondary"}>
                          {Math.round(submission.overallScore)}
                        </Badge>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export { type PastSubmission };
