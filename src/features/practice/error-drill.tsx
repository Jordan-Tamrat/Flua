"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ApiError, apiGet, apiPost } from "@/lib/api/client";
import { createStopwatch, type Stopwatch } from "@/lib/timing";

/**
 * Retrieval practice on the learner's own sentences.
 *
 * They are shown something they actually said, and asked to say it correctly.
 * Typed rather than multiple choice on purpose: picking the right option out of
 * four tests recognition, and recognition is not what fails them mid-
 * conversation. Producing the form is.
 *
 * The answer is graded on the server, so nothing on this page reveals the
 * correction before the attempt.
 */

interface DrillItem {
  mistakeId: string;
  prompt: string;
  category: string;
  categoryLabel: string;
  explanation: string;
  saidAt: string;
  retestCount: number;
}

interface DrillResult {
  wasCorrect: boolean;
  correctedText: string;
  explanation: string;
  retired: boolean;
}

/** "yesterday", "on Tuesday" — how a person would place a remembered remark. */
function whenSaid(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return "a while back";
}

export function ErrorDrill({ onFinish }: { onFinish?: () => void }) {
  const [items, setItems] = useState<DrillItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<DrillResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixed, setFixed] = useState(0);

  // Time-to-answer separates confident recall from a laboured one; a correct
  // but slow answer is scheduled back sooner.
  const stopwatchRef = useRef<Stopwatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    stopwatchRef.current = createStopwatch();

    async function load() {
      try {
        const data = await apiGet<{ items: DrillItem[] }>("/api/practice/errors");
        if (cancelled) return;
        setItems(data.items);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof ApiError ? caught.message : "We couldn't load your practice items.",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = items[index];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !answer.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const outcome = await apiPost<DrillResult>(`/api/practice/errors/${current.mistakeId}`, {
        action: "attempt",
        answer,
        responseMs: stopwatchRef.current?.elapsedMs(),
      });
      setResult(outcome);
      if (outcome.wasCorrect) setFixed((count) => count + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't check that answer.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDismiss() {
    if (!current) return;
    setIsSubmitting(true);
    try {
      await apiPost(`/api/practice/errors/${current.mistakeId}`, { action: "dismiss" });
      advance();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't skip that one.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function advance() {
    setResult(null);
    setAnswer("");
    stopwatchRef.current?.reset();
    setIndex((value) => value + 1);
  }

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Finding things to practise…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <p className="text-sm font-medium">Nothing to fix right now</p>
          <p className="text-muted-foreground text-sm">
            Things you get wrong in conversation show up here a day or two later, while they&apos;re
            still worth revisiting.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!current) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm font-medium">
            Done — {fixed} of {items.length} right
          </p>
          <p className="text-muted-foreground text-sm">
            The ones you missed will come back sooner than the ones you got.
          </p>
          {onFinish ? (
            <Button onClick={onFinish} className="w-full">
              Finish
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Progress
          value={((index + (result ? 1 : 0)) / items.length) * 100}
          className="h-1.5"
          aria-label={`Item ${index + 1} of ${items.length}`}
        />
        <p className="text-muted-foreground text-xs">
          {index + 1} of {items.length}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            You said this {whenSaid(current.saidAt)} — say it correctly
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <blockquote className="border-warning bg-muted/50 rounded-r-lg border-l-2 px-3 py-2 text-sm italic">
            {current.prompt}
          </blockquote>

          {result ? (
            <div className="space-y-3">
              <div
                className={`flex items-start gap-2 text-sm font-medium ${
                  result.wasCorrect ? "text-success" : "text-warning"
                }`}
              >
                {result.wasCorrect ? (
                  <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                {result.wasCorrect ? "That's it" : "Not quite"}
              </div>

              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">The version to aim for</p>
                <p className="text-sm font-medium">{result.correctedText}</p>
              </div>

              <p className="text-muted-foreground text-xs leading-relaxed">{result.explanation}</p>

              {result.retired ? (
                <p className="text-success text-xs">
                  Third time right — this one won&apos;t come back.
                </p>
              ) : null}

              <Button onClick={advance} className="w-full">
                {index + 1 < items.length ? "Next" : "Finish"}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <label htmlFor="drill-answer" className="sr-only">
                Your corrected version
              </label>
              <Input
                id="drill-answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Type it the right way…"
                autoComplete="off"
                disabled={isSubmitting}
                maxLength={1000}
              />

              <div className="flex items-center gap-2">
                <Button type="submit" disabled={isSubmitting || !answer.trim()} className="flex-1">
                  {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  Check
                </Button>
                {/*
                  These sentences come from speech-to-text, so some are garbled
                  beyond repair. Without a way out, one of those makes the whole
                  feature feel broken.
                */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  disabled={isSubmitting}
                  className="text-muted-foreground"
                >
                  Doesn&apos;t make sense
                </Button>
              </div>

              <Badge variant="muted">{current.categoryLabel}</Badge>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
