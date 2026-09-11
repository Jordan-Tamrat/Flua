"use client";

import { ArrowLeft, Check, Loader2, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { GrammarExerciseQuestion, Lesson } from "@/lib/ai/schemas";
import { ApiError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Lesson + drill for one grammar topic.
 *
 * Content is generated on demand rather than up front, so opening the library
 * costs nothing and only a topic the learner actually chooses spends a request.
 */

interface GrammarPracticeProps {
  categorySlug: string;
  categoryLabel: string;
  categorySummary: string;
  commonMistake: string;
  accuracy: number | null;
}

type Phase = "intro" | "lesson" | "drill" | "results";

export function GrammarPractice({
  categorySlug,
  categoryLabel,
  categorySummary,
  commonMistake,
  accuracy,
}: GrammarPracticeProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [questions, setQuestions] = useState<GrammarExerciseQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLesson() {
    setIsLoading(true);
    setError(null);

    try {
      const result = await apiPost<Lesson>("/api/ai/lesson", { category: categorySlug });
      setLesson(result);
      setPhase("lesson");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't load the lesson.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDrill() {
    setIsLoading(true);
    setError(null);

    try {
      // A lesson already carries practice questions, so reuse them rather than
      // spending a second request on the same thing.
      if (lesson && lesson.exercise.length > 0) {
        setQuestions(lesson.exercise);
      } else {
        const result = await apiPost<{ questions: GrammarExerciseQuestion[] }>("/api/ai/grammar", {
          category: categorySlug,
        });
        setQuestions(result.questions);
      }

      setCurrentIndex(0);
      setSelected(null);
      setAnswers([]);
      setPhase("drill");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't load the practice.");
    } finally {
      setIsLoading(false);
    }
  }

  function submitAnswer() {
    if (selected === null) return;
    const question = questions[currentIndex];
    if (!question) return;

    setAnswers((current) => [...current, selected === question.correctIndex]);
  }

  async function nextQuestion() {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((current) => current + 1);
      setSelected(null);
      return;
    }

    setPhase("results");

    const correct = answers.filter(Boolean).length;

    // Results feed the same statistics as live corrections. A failure here
    // shouldn't hide the learner's score from them.
    try {
      await apiPost("/api/grammar/results", {
        category: categorySlug,
        correct,
        total: answers.length,
      });
    } catch {
      // Score is still shown below; only the recording was lost.
    }
  }

  const question = questions[currentIndex];
  const hasAnswered = answers.length > currentIndex;
  const correctCount = answers.filter(Boolean).length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-8">
      <Link
        href="/grammar"
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring inline-flex items-center gap-1.5 rounded text-sm focus-visible:outline-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All topics
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{categoryLabel}</h1>
        <p className="text-muted-foreground text-sm">{categorySummary}</p>
        {accuracy !== null ? (
          <Badge variant={accuracy < 70 ? "warning" : "success"}>{accuracy}% accurate so far</Badge>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {phase === "intro" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A common mistake here</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">{commonMistake}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={loadLesson} disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Teach me this
              </Button>
              <Button variant="outline" onClick={loadDrill} disabled={isLoading}>
                Skip to practice
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {phase === "lesson" && lesson ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{lesson.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <section>
                <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  In plain language
                </h2>
                <p className="text-sm leading-relaxed">{lesson.simpleExplanation}</p>
              </section>

              <section>
                <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  The rule
                </h2>
                <p className="text-sm leading-relaxed">{lesson.rule}</p>
              </section>

              <section>
                <h2 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                  Examples
                </h2>
                <ul className="space-y-1.5">
                  {lesson.examples.map((example, index) => (
                    <li key={index} className="border-primary/40 border-l-2 pl-3 text-sm">
                      {example}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="bg-muted/50 space-y-1.5 rounded-lg p-3">
                <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Watch out for
                </h2>
                <p className="text-destructive text-sm line-through">
                  {lesson.commonMistake.wrong}
                </p>
                <p className="text-sm font-medium">{lesson.commonMistake.right}</p>
                <p className="text-muted-foreground text-xs">{lesson.commonMistake.why}</p>
              </section>
            </CardContent>
          </Card>

          <Button onClick={loadDrill} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Practise it
          </Button>
        </div>
      ) : null}

      {phase === "drill" && question ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Progress
              value={((currentIndex + (hasAnswered ? 1 : 0)) / questions.length) * 100}
              aria-label={`Question ${currentIndex + 1} of ${questions.length}`}
            />
            <p className="text-muted-foreground text-xs">
              Question {currentIndex + 1} of {questions.length}
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base leading-relaxed">{question.prompt}</CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <fieldset className="space-y-2" disabled={hasAnswered}>
                <legend className="sr-only">Choose the correct answer</legend>
                {question.options.map((option, index) => {
                  const isCorrect = index === question.correctIndex;
                  const isChosen = selected === index;

                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelected(index)}
                      aria-pressed={isChosen}
                      className={cn(
                        "focus-visible:outline-ring flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-2",
                        !hasAnswered && isChosen && "border-primary bg-primary/8",
                        !hasAnswered && !isChosen && "border-border hover:bg-muted",
                        hasAnswered && isCorrect && "border-success bg-success/10",
                        hasAnswered &&
                          isChosen &&
                          !isCorrect &&
                          "border-destructive bg-destructive/10",
                        hasAnswered && !isChosen && !isCorrect && "border-border opacity-60",
                      )}
                    >
                      {option}
                      {hasAnswered && isCorrect ? (
                        <Check className="text-success size-4 shrink-0" aria-hidden />
                      ) : null}
                      {hasAnswered && isChosen && !isCorrect ? (
                        <X className="text-destructive size-4 shrink-0" aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
              </fieldset>

              {hasAnswered ? (
                <Alert variant={answers[currentIndex] ? "success" : "info"}>
                  <AlertDescription>{question.explanation}</AlertDescription>
                </Alert>
              ) : null}

              {hasAnswered ? (
                <Button onClick={nextQuestion} className="w-full">
                  {currentIndex + 1 < questions.length ? "Next question" : "See results"}
                </Button>
              ) : (
                <Button onClick={submitAnswer} disabled={selected === null} className="w-full">
                  Check answer
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {phase === "results" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {correctCount} of {answers.length} correct
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={(correctCount / Math.max(1, answers.length)) * 100}
              aria-label={`${correctCount} out of ${answers.length} correct`}
            />

            <p className="text-muted-foreground text-sm">
              {correctCount === answers.length
                ? "All correct. This one looks solid — it'll come back for review later."
                : correctCount >= answers.length * 0.7
                  ? "Mostly there. The ones you missed will show up in your practice again."
                  : "This one needs more work. It'll feature in your daily plan."}
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={loadDrill} disabled={isLoading} variant="outline">
                {isLoading ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-4" aria-hidden />
                )}
                More practice
              </Button>
              <Button asChild>
                <Link href="/grammar">Back to topics</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
