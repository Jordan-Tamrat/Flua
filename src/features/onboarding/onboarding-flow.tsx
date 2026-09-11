"use client";

import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ApiError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Onboarding.
 *
 * Six short steps rather than one long form: each screen asks one thing, which
 * keeps the commitment low at the point where a new learner is most likely to
 * abandon. Answers set the starting point only — the system re-estimates the
 * level from real evidence afterwards.
 */

const LEVELS = [
  { value: "A1", label: "A1 — Beginner", hint: "A few words and set phrases." },
  { value: "A2", label: "A2 — Elementary", hint: "Simple everyday exchanges." },
  { value: "B1", label: "B1 — Intermediate", hint: "I can hold a conversation, with effort." },
  {
    value: "B2",
    label: "B2 — Upper intermediate",
    hint: "I'm fairly comfortable most of the time.",
  },
  { value: "C1", label: "C1 — Advanced", hint: "I'm fluent, but want more precision." },
  { value: "C2", label: "C2 — Proficient", hint: "Near-native; polishing nuance." },
] as const;

const LEARNING_STYLES = [
  { value: "CONVERSATIONAL", label: "By talking", hint: "Learn through conversation, mostly." },
  { value: "STRUCTURED", label: "With structure", hint: "Rules and explanations first." },
  { value: "PRACTICE_HEAVY", label: "By doing", hint: "Lots of exercises and repetition." },
  { value: "VISUAL", label: "With examples", hint: "Show me, don't tell me." },
] as const;

const GOALS = [
  "Speak more confidently",
  "Prepare for work or interviews",
  "Study or take an exam",
  "Travel more easily",
  "Write better emails and messages",
  "Understand films and shows",
];

const TOPICS = [
  "Technology",
  "Travel",
  "Food",
  "Sport",
  "Music",
  "Films",
  "Books",
  "Business",
  "Science",
  "Health",
  "Art",
  "News",
];

const DURATIONS = [10, 20, 30, 45, 60];

const TOTAL_STEPS = 6;

export function OnboardingFlow({ initialName }: { initialName: string }) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [selfAssessedLevel, setSelfAssessedLevel] = useState<string>("A2");
  const [targetLevel, setTargetLevel] = useState<string>("B2");
  const [goals, setGoals] = useState<string[]>([]);
  const [learningStyle, setLearningStyle] = useState<string>("CONVERSATIONAL");
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(20);
  const [speakingConfidence, setSpeakingConfidence] = useState(3);
  const [topics, setTopics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  const canContinue = (() => {
    switch (step) {
      case 0:
        return name.trim().length > 0;
      case 1:
        return Boolean(selfAssessedLevel);
      case 2:
        return goals.length > 0;
      case 3:
        return Boolean(learningStyle);
      case 4:
        return dailyGoalMinutes > 0;
      case 5:
        return true; // topics are optional
      default:
        return false;
    }
  })();

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);

    try {
      await apiPost("/api/profile/onboarding", {
        name: name.trim(),
        selfAssessedLevel,
        targetLevel,
        learningStyle,
        dailyGoalMinutes,
        speakingConfidence,
        interests: topics,
        preferredTopics: topics,
        goals,
      });

      router.push("/learn");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div className="space-y-2">
        <Progress
          value={((step + 1) / TOTAL_STEPS) * 100}
          aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}
        />
        <p className="text-muted-foreground text-xs">
          Step {step + 1} of {TOTAL_STEPS}
        </p>
      </div>

      <Card>
        {step === 0 ? (
          <>
            <CardHeader>
              <CardTitle>What should we call you?</CardTitle>
              <CardDescription>Flua will use this when you talk.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </div>
            </CardContent>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <CardHeader>
              <CardTitle>Where are you now?</CardTitle>
              <CardDescription>
                A rough guess is fine — Flua works out your real level as you practise.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Right now</legend>
                {LEVELS.map((level) => (
                  <OptionButton
                    key={level.value}
                    selected={selfAssessedLevel === level.value}
                    onClick={() => setSelfAssessedLevel(level.value)}
                    label={level.label}
                    hint={level.hint}
                  />
                ))}
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  Where you&apos;d like to get to
                </legend>
                <div className="flex flex-wrap gap-2">
                  {LEVELS.map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      onClick={() => setTargetLevel(level.value)}
                      aria-pressed={targetLevel === level.value}
                      className={cn(
                        "focus-visible:outline-ring rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2",
                        targetLevel === level.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {level.value}
                    </button>
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <CardHeader>
              <CardTitle>What are you learning for?</CardTitle>
              <CardDescription>Pick everything that applies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {GOALS.map((goal) => (
                <OptionButton
                  key={goal}
                  selected={goals.includes(goal)}
                  onClick={() => toggle(goals, goal, setGoals)}
                  label={goal}
                />
              ))}
            </CardContent>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <CardHeader>
              <CardTitle>How do you like to learn?</CardTitle>
              <CardDescription>This shapes how Flua explains things.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {LEARNING_STYLES.map((style) => (
                <OptionButton
                  key={style.value}
                  selected={learningStyle === style.value}
                  onClick={() => setLearningStyle(style.value)}
                  label={style.label}
                  hint={style.hint}
                />
              ))}
            </CardContent>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <CardHeader>
              <CardTitle>How much time per day?</CardTitle>
              <CardDescription>
                Consistency beats length. Pick something you can actually keep up.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setDailyGoalMinutes(minutes)}
                    aria-pressed={dailyGoalMinutes === minutes}
                    className={cn(
                      "focus-visible:outline-ring rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2",
                      dailyGoalMinutes === minutes
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>

              <fieldset>
                <legend className="mb-3 text-sm font-medium">
                  How do you feel about speaking English out loud?
                </legend>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSpeakingConfidence(value)}
                      aria-pressed={speakingConfidence === value}
                      aria-label={`${value} out of 5`}
                      className={cn(
                        "focus-visible:outline-ring size-10 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-2",
                        speakingConfidence === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  1 = it makes me nervous · 5 = I&apos;m comfortable
                </p>
              </fieldset>
            </CardContent>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <CardHeader>
              <CardTitle>What do you like talking about?</CardTitle>
              <CardDescription>
                Flua will use these for conversation topics and examples. Optional.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => toggle(topics, topic, setTopics)}
                    aria-pressed={topics.includes(topic)}
                    className={cn(
                      "focus-visible:outline-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                      topics.includes(topic)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </CardContent>
          </>
        ) : null}

        <CardContent className="pt-0">
          {error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setStep((current) => current - 1)}
              disabled={step === 0 || isSubmitting}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>

            {step < TOTAL_STEPS - 1 ? (
              <Button onClick={() => setStep((current) => current + 1)} disabled={!canContinue}>
                Continue
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Setting up…
                  </>
                ) : (
                  <>
                    <Check className="size-4" aria-hidden />
                    Finish
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OptionButton({
  selected,
  onClick,
  label,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "focus-visible:outline-ring w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-2",
        selected ? "border-primary bg-primary/8" : "border-border hover:bg-muted",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {selected ? <Check className="text-primary size-4 shrink-0" aria-hidden /> : null}
      </span>
      {hint ? <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span> : null}
    </button>
  );
}
