"use client";

import { Loader2, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiPatch } from "@/lib/api/client";
import { speak } from "@/lib/speech/text-to-speech";
import { cn } from "@/lib/utils";

/**
 * Settings.
 *
 * Correction frequency is the setting that most changes how Flua feels, so it
 * leads and each option explains what it actually does rather than naming a mode.
 */

const CORRECTION_STYLES = [
  {
    value: "IMMEDIATE",
    label: "Straight away",
    hint: "Fix mistakes in the reply itself, briefly.",
  },
  {
    value: "PER_MESSAGE",
    label: "After each message",
    hint: "A short note under the reply when something needs fixing.",
  },
  {
    value: "PERIODIC",
    label: "At the end",
    hint: "Nothing interrupts the conversation. Corrections come with the session feedback.",
  },
  {
    value: "MINIMAL",
    label: "Only when it matters",
    hint: "Say something only if a mistake makes you hard to understand.",
  },
] as const;

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const DURATIONS = [10, 20, 30, 45, 60];
const DIFFICULTIES = [
  { value: 1, label: "Very easy" },
  { value: 2, label: "Easy" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Challenging" },
  { value: 5, label: "Hard" },
];

const RESPONSE_STYLES = [
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
] as const;

export interface SettingsData {
  name: string;
  email: string;
  targetLevel: string;
  estimatedLevel: string;
  levelConfidence: number;
  dailyGoalMinutes: number;
  correctionStyle: string;
  conversationDifficulty: number;
  voiceSpeed: number;
  responseStyle: string;
}

export function SettingsView({ initial }: { initial: SettingsData }) {
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState(initial.name);
  const [targetLevel, setTargetLevel] = useState(initial.targetLevel);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(initial.dailyGoalMinutes);
  const [correctionStyle, setCorrectionStyle] = useState(initial.correctionStyle);
  const [conversationDifficulty, setConversationDifficulty] = useState(
    initial.conversationDifficulty,
  );
  const [voiceSpeed, setVoiceSpeed] = useState(initial.voiceSpeed);
  const [responseStyle, setResponseStyle] = useState(initial.responseStyle);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      await apiPatch("/api/profile", {
        name: name.trim(),
        targetLevel,
        dailyGoalMinutes,
        correctionStyle,
        conversationDifficulty,
        voiceSpeed,
        responseStyle,
      });

      toast({ title: "Settings saved", variant: "success" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't save your settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">How Flua works with you.</p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Corrections</CardTitle>
          <CardDescription>
            When should Flua point out mistakes during a conversation?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {CORRECTION_STYLES.map((style) => (
            <button
              key={style.value}
              type="button"
              onClick={() => setCorrectionStyle(style.value)}
              aria-pressed={correctionStyle === style.value}
              className={cn(
                "focus-visible:outline-ring w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-2",
                correctionStyle === style.value
                  ? "border-primary bg-primary/8"
                  : "border-border hover:bg-muted",
              )}
            >
              <span className="block text-sm font-medium">{style.label}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">{style.hint}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your English</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm">
              Flua estimates you&apos;re at <strong>{initial.estimatedLevel}</strong>.
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {initial.levelConfidence < 0.4
                ? "This is an early guess and will sharpen as you practise. It isn't an official assessment."
                : "Based on your recent work. It's an informal guide, not an official CEFR assessment."}
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Level you&apos;re working toward</legend>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setTargetLevel(level)}
                  aria-pressed={targetLevel === level}
                  className={cn(
                    "focus-visible:outline-ring rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2",
                    targetLevel === level
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Conversation difficulty</legend>
            <div className="flex flex-wrap gap-2">
              {DIFFICULTIES.map((difficulty) => (
                <button
                  key={difficulty.value}
                  type="button"
                  onClick={() => setConversationDifficulty(difficulty.value)}
                  aria-pressed={conversationDifficulty === difficulty.value}
                  className={cn(
                    "focus-visible:outline-ring rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                    conversationDifficulty === difficulty.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {difficulty.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">How Flua explains things</legend>
            <div className="flex flex-wrap gap-2">
              {RESPONSE_STYLES.map((style) => (
                <button
                  key={style.value}
                  type="button"
                  onClick={() => setResponseStyle(style.value)}
                  aria-pressed={responseStyle === style.value}
                  className={cn(
                    "focus-visible:outline-ring rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                    responseStyle === style.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily goal</CardTitle>
          <CardDescription>Consistency matters more than length.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice</CardTitle>
          <CardDescription>
            How fast Flua reads messages aloud. Uses your browser&apos;s built-in voice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="voice-speed">Speed</Label>
              <span className="text-muted-foreground text-sm tabular-nums">
                {voiceSpeed.toFixed(1)}×
              </span>
            </div>
            <Slider
              id="voice-speed"
              min={0.5}
              max={2}
              step={0.1}
              value={[voiceSpeed]}
              onValueChange={([value]) => setVoiceSpeed(value ?? 1)}
              aria-label="Voice speed"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => speak("This is how fast I'll read things to you.", { rate: voiceSpeed })}
          >
            <Volume2 className="size-4" aria-hidden />
            Hear it
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-email">Email</Label>
            <Input id="settings-email" value={initial.email} disabled readOnly />
            <p className="text-muted-foreground text-xs">
              Changing your email isn&apos;t supported yet.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-20 md:bottom-4">
        <Button onClick={handleSave} disabled={isSaving} className="w-full shadow-lg">
          {isSaving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save settings"
          )}
        </Button>
      </div>
    </div>
  );
}
