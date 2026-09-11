"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ApiError, apiGet, apiPost } from "@/lib/api/client";
import { isSpeechSynthesisSupported, speak } from "@/lib/speech/text-to-speech";
import { createStopwatch, type Stopwatch } from "@/lib/timing";

/**
 * Spaced-repetition review.
 *
 * The classic recall loop: see the word, try to remember it, reveal, then rate
 * how hard it was. The rating drives SM-2 on the server — the four buttons map
 * to the algorithm's quality scores.
 */

interface DueItem {
  id: string;
  word: string;
  definition: string;
  partOfSpeech: string | null;
  exampleSentence: string | null;
  synonyms: string[];
  difficulty: string;
}

const OUTCOMES = [
  { value: "AGAIN", label: "Forgot", hint: "Show again tomorrow", variant: "outline" as const },
  { value: "HARD", label: "Hard", hint: "Took effort", variant: "outline" as const },
  { value: "GOOD", label: "Good", hint: "Remembered it", variant: "default" as const },
  { value: "EASY", label: "Easy", hint: "Instantly", variant: "outline" as const },
];

export function ReviewSession({ onFinish }: { onFinish: () => void }) {
  const [items, setItems] = useState<DueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);

  /*
   * How long the learner took to recall a word is a useful retention signal.
   * The stopwatch is created lazily inside an effect rather than during render,
   * since reading the clock is an impure operation.
   */
  const stopwatchRef = useRef<Stopwatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    stopwatchRef.current = createStopwatch();

    async function loadDue() {
      try {
        const result = await apiGet<{ items: DueItem[] }>("/api/vocabulary?due=1&limit=20");
        if (cancelled) return;
        setItems(result.items);
        stopwatchRef.current?.reset();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : "We couldn't load your review.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadDue();

    // Guards against setting state after the learner navigates away mid-fetch.
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRate = useCallback(
    async (outcome: string) => {
      const item = items[index];
      if (!item) return;

      setIsSubmitting(true);

      const elapsedMs = stopwatchRef.current?.elapsedMs();

      try {
        await apiPost(`/api/vocabulary/${item.id}/review`, {
          outcome,
          // Omitted rather than guessed if the stopwatch never started.
          ...(elapsedMs === undefined ? {} : { responseMs: Math.min(600_000, elapsedMs) }),
        });

        setReviewed((current) => current + 1);

        if (index + 1 < items.length) {
          setIndex((current) => current + 1);
          setRevealed(false);
          stopwatchRef.current?.reset();
        } else {
          onFinish();
        }
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "We couldn't save that review.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [index, items, onFinish],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Loader2
          className="text-muted-foreground size-6 animate-spin"
          aria-label="Loading review"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg p-4 md:p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing due right now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Your words are all scheduled for later. Come back when some are due — that timing is
              the point.
            </p>
            <Button onClick={onFinish}>Back to vocabulary</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const item = items[index];
  if (!item) return null;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 md:p-8">
      <div className="space-y-2">
        <Progress
          value={(reviewed / items.length) * 100}
          aria-label={`${reviewed} of ${items.length} reviewed`}
        />
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            {reviewed} of {items.length}
          </span>
          <button
            type="button"
            onClick={onFinish}
            className="hover:text-foreground focus-visible:outline-ring rounded focus-visible:outline-2"
          >
            Finish early
          </button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-2xl font-semibold">{item.word}</span>
              {isSpeechSynthesisSupported() ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => speak(item.word)}
                  aria-label={`Hear "${item.word}" pronounced`}
                >
                  <Volume2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            {item.partOfSpeech ? (
              <p className="text-muted-foreground text-sm italic">{item.partOfSpeech}</p>
            ) : null}
          </div>

          {revealed ? (
            <div className="animate-[fade-in_0.2s_ease-out] space-y-3">
              <p className="text-center text-sm">{item.definition}</p>

              {item.exampleSentence ? (
                <p className="text-muted-foreground border-primary/40 border-l-2 pl-3 text-sm italic">
                  {item.exampleSentence}
                </p>
              ) : null}

              {item.synonyms.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {item.synonyms.map((synonym) => (
                    <Badge key={synonym} variant="secondary">
                      {synonym}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Do you remember what this means?
            </p>
          )}

          {revealed ? (
            <div className="grid grid-cols-2 gap-2">
              {OUTCOMES.map((outcome) => (
                <Button
                  key={outcome.value}
                  variant={outcome.variant}
                  onClick={() => handleRate(outcome.value)}
                  disabled={isSubmitting}
                  className="h-auto flex-col gap-0.5 py-3"
                >
                  <span className="font-medium">{outcome.label}</span>
                  <span className="text-xs opacity-70">{outcome.hint}</span>
                </Button>
              ))}
            </div>
          ) : (
            <Button onClick={() => setRevealed(true)} className="w-full">
              Show definition
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
