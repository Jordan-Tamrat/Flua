"use client";

import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { LevelAssessment } from "@/lib/ai/schemas";
import { ApiError, apiPost } from "@/lib/api/client";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";
import { cn } from "@/lib/utils";

/**
 * Placement assessment.
 *
 * The multiple-choice questions are served without their answers, so the
 * correct option can't be read out of the network response. Only the writing
 * sample is judged by a model.
 */

interface Question {
  id: string;
  section: string;
  prompt: string;
  options: string[];
}

interface PlacementTestProps {
  questions: Question[];
  writingPrompt: string;
}

export function PlacementTest({ questions, writingPrompt }: PlacementTestProps) {
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [writing, setWriting] = useState("");
  const [isWritingStage, setIsWritingStage] = useState(false);
  const [result, setResult] = useState<LevelAssessment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = questions[index];
  const totalSteps = questions.length + 1;
  const currentStep = isWritingStage ? questions.length : index;
  const writingWords = writing.trim().split(/\s+/).filter(Boolean).length;

  function selectAnswer(optionIndex: number) {
    if (!question) return;
    setAnswers((current) => ({ ...current, [question.id]: optionIndex }));
  }

  function goNext() {
    if (index + 1 < questions.length) {
      setIndex((current) => current + 1);
    } else {
      setIsWritingStage(true);
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      const assessment = await apiPost<LevelAssessment>("/api/ai/level-assessment", {
        answers,
        writingSample: writing.trim(),
      });
      setResult(assessment);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't finish the assessment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-6 p-4 md:p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your estimated level</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-semibold tracking-tight">{result.estimatedLevel}</span>
              <Badge variant={result.confidence >= 0.6 ? "success" : "secondary"}>
                {Math.round(result.confidence * 100)}% confident
              </Badge>
            </div>

            <p className="text-sm leading-relaxed">{result.reasoning}</p>

            {result.strengths.length > 0 ? (
              <section>
                <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  What you can do
                </h2>
                <ul className="space-y-1">
                  {result.strengths.map((strength, position) => (
                    <li key={position} className="text-sm">
                      {strength}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {result.weaknesses.length > 0 ? (
              <section>
                <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  Where to focus
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {result.weaknesses.map((slug, index) => (
                    <Badge key={`${slug}-${index}`} variant="outline">
                      {getGrammarLabel(slug)}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            <Alert variant="info">
              <AlertDescription>
                This is Flua&apos;s own estimate from a short test — useful for pitching lessons,
                but not an official CEFR assessment. It will adjust as you practise.
              </AlertDescription>
            </Alert>

            <Button onClick={() => router.push("/learn")} className="w-full">
              Start learning
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Where are you starting from?</h1>
        <p className="text-muted-foreground text-sm">
          A short test so Flua can pitch things at the right level. Guessing is fine.
        </p>
      </header>

      <div className="space-y-2">
        <Progress
          value={((currentStep + 1) / totalSteps) * 100}
          aria-label={`Step ${currentStep + 1} of ${totalSteps}`}
        />
        <p className="text-muted-foreground text-xs">
          {isWritingStage ? "Last part" : `Question ${index + 1} of ${questions.length}`}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!isWritingStage && question ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base leading-relaxed">{question.prompt}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">Choose an answer</legend>
              {question.options.map((option, optionIndex) => (
                <button
                  key={optionIndex}
                  type="button"
                  onClick={() => selectAnswer(optionIndex)}
                  aria-pressed={answers[question.id] === optionIndex}
                  className={cn(
                    "focus-visible:outline-ring w-full rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2",
                    answers[question.id] === optionIndex
                      ? "border-primary bg-primary/8"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {option}
                </button>
              ))}
            </fieldset>

            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => setIndex((current) => current - 1)}
                disabled={index === 0}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>

              <Button onClick={goNext} disabled={answers[question.id] === undefined}>
                {index + 1 < questions.length ? "Next" : "Continue"}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isWritingStage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Write a little</CardTitle>
            <CardDescription>{writingPrompt}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="writing-sample" className="sr-only">
                Your writing
              </label>
              <Textarea
                id="writing-sample"
                value={writing}
                onChange={(event) => setWriting(event.target.value)}
                placeholder="Write four to six sentences…"
                className="min-h-40"
                maxLength={3000}
              />
              <p className="text-muted-foreground text-xs">
                {writingWords} word{writingWords === 1 ? "" : "s"}
                {writing.trim().length < 40 ? " — write a bit more so we can judge fairly" : ""}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setIsWritingStage(false)}>
                <ArrowLeft className="size-4" aria-hidden />
                Back
              </Button>

              <Button onClick={handleSubmit} disabled={isSubmitting || writing.trim().length < 40}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Working it out…
                  </>
                ) : (
                  "Get my level"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
