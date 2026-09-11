"use client";

import { AlertCircle, Loader2, Mic, MicOff, PhoneOff, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SessionFeedbackPanel } from "@/features/conversation/session-feedback-panel";
import { useVoiceSession } from "@/features/voice/use-voice-session";
import type { VoiceScenario } from "@/lib/ai/prompts/voice";
import type { SessionFeedback } from "@/lib/ai/schemas";
import { ApiError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

/**
 * Live voice conversation.
 *
 * The design goal is that the learner forgets the interface exists. There is no
 * push-to-talk: they press call once, then simply speak. The orb shows who has
 * the floor, and the transcript is there to glance at rather than to read.
 */

interface VoiceConversationProps {
  scenarios: readonly VoiceScenario[];
  voiceAvailable: boolean;
  learnerName: string;
}

interface CompleteResponse {
  conversationId: string;
  feedback: SessionFeedback | null;
  feedbackUnavailableReason?: string;
}

function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceConversation({
  scenarios,
  voiceAvailable,
  learnerName,
}: VoiceConversationProps) {
  const { state, start, stop, toggleMute, sendText } = useVoiceSession();

  const [scenarioId, setScenarioId] = useState<string>("free-chat");
  const [typed, setTyped] = useState("");
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(false);

  const isLive =
    state.status === "listening" ||
    state.status === "speaking" ||
    state.status === "connecting" ||
    state.status === "requesting-mic";

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [state.turns]);

  /**
   * Saves the conversation once it ends.
   *
   * Guarded by a ref because the hook can report `ended` more than once (the
   * socket close and the explicit stop both land here), and saving twice would
   * create duplicate conversations. All state updates happen in async
   * continuations rather than synchronously in the effect body.
   */
  useEffect(() => {
    if (state.status !== "ended" || savedRef.current) return;
    if (state.turns.length === 0) return;

    savedRef.current = true;
    let cancelled = false;

    async function save() {
      setIsSaving(true);
      setSaveError(null);

      try {
        const result = await apiPost<CompleteResponse>("/api/ai/voice/complete", {
          turns: state.turns.map((turn) => ({ role: turn.role, text: turn.text })),
          durationSec: state.elapsedSec,
          scenarioId: scenarioId === "free-chat" ? undefined : scenarioId,
        });
        if (cancelled) return;
        setFeedback(result.feedback);
        setFeedbackNote(result.feedbackUnavailableReason ?? null);
      } catch (error) {
        if (cancelled) return;
        setSaveError(
          error instanceof ApiError ? error.message : "We couldn't save that conversation.",
        );
      } finally {
        if (!cancelled) setIsSaving(false);
      }
    }

    void save();

    return () => {
      cancelled = true;
    };
  }, [state.status, state.turns, state.elapsedSec, scenarioId]);

  function handleStart() {
    savedRef.current = false;
    setFeedback(null);
    setFeedbackNote(null);
    setSaveError(null);
    void start({ scenarioId: scenarioId === "free-chat" ? undefined : scenarioId });
  }

  if (!voiceAvailable) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 md:p-8">
        <Alert variant="warning">
          <AlertCircle aria-hidden />
          <AlertTitle>Voice conversation needs a provider</AlertTitle>
          <AlertDescription>
            Live voice requires a Gemini API key with access to the Live API. Add{" "}
            <code className="text-xs">GEMINI_API_KEY</code> to your environment to enable it.
            Everything else in Flua works without it.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col p-4 md:h-dvh md:p-8">
      {/* Setup — only before the first call */}
      {state.status === "idle" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Talk with Flua</h1>
            <p className="text-muted-foreground mx-auto max-w-md text-sm">
              Press call and just start speaking — no buttons to hold. Flua listens, replies out
              loud, and you can interrupt any time.
            </p>
          </div>

          <div className="w-full space-y-3">
            <p className="text-muted-foreground text-xs font-medium">
              What would you like to practise?
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => setScenarioId(scenario.id)}
                  aria-pressed={scenarioId === scenario.id}
                  title={scenario.description}
                  className={cn(
                    "focus-visible:outline-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                    scenarioId === scenario.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {scenario.label}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {scenarios.find((scenario) => scenario.id === scenarioId)?.description}
            </p>
          </div>

          <Button size="lg" onClick={handleStart} className="size-28 rounded-full">
            <span className="flex flex-col items-center gap-1">
              <Mic className="size-8" aria-hidden />
              <span className="text-xs font-medium">Call</span>
            </span>
          </Button>
        </div>
      ) : null}

      {/* Live call */}
      {isLive ? (
        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <div className="flex items-center justify-between">
            <Badge variant={state.status === "speaking" ? "default" : "secondary"}>
              {state.status === "requesting-mic"
                ? "Waiting for microphone…"
                : state.status === "connecting"
                  ? "Connecting…"
                  : state.status === "speaking"
                    ? "Flua is speaking"
                    : "Listening"}
            </Badge>
            <span className="text-muted-foreground font-mono text-sm tabular-nums">
              {formatDuration(state.elapsedSec)}
            </span>
          </div>

          {/* Orb: who has the floor */}
          <div className="flex flex-col items-center gap-3 py-4">
            <div
              className={cn(
                "relative flex size-28 items-center justify-center rounded-full transition-colors duration-300",
                state.status === "speaking" ? "bg-primary/15" : "bg-muted",
              )}
              aria-hidden
            >
              {/* Ring scales with the learner's voice, so they can see it's hearing them. */}
              <div
                className="bg-primary/20 absolute inset-0 rounded-full transition-transform duration-100"
                style={{
                  transform: `scale(${
                    state.status === "speaking" ? 1.12 : 1 + Math.min(state.inputLevel, 1) * 0.28
                  })`,
                }}
              />
              <span
                className={cn(
                  "text-primary relative text-3xl font-bold",
                  state.status === "speaking" && "animate-pulse",
                )}
              >
                F
              </span>
            </div>

            <p className="text-muted-foreground text-sm" aria-live="polite">
              {state.status === "speaking"
                ? "You can interrupt any time — just start talking."
                : state.isMuted
                  ? "Microphone is off"
                  : "Go ahead, I'm listening"}
            </p>
          </div>

          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="min-h-0 flex-1 scrollbar-thin space-y-3 overflow-y-auto rounded-xl border p-4"
          >
            {state.turns.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                What you both say will appear here.
              </p>
            ) : (
              state.turns.map((turn) => (
                <div
                  key={turn.id}
                  className={cn("flex", turn.role === "USER" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                      turn.role === "USER"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted rounded-bl-sm",
                      turn.isPartial && "opacity-80",
                    )}
                  >
                    {turn.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendText(typed);
                setTyped("");
              }}
              className="flex gap-2"
            >
              <label htmlFor="voice-typed" className="sr-only">
                Type instead of speaking
              </label>
              <Input
                id="voice-typed"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="…or type, if you'd rather"
                maxLength={500}
              />
              <Button type="submit" size="icon" variant="outline" disabled={!typed.trim()}>
                <Send className="size-4" aria-hidden />
                <span className="sr-only">Send</span>
              </Button>
            </form>

            <div className="flex items-center justify-center gap-3">
              <Button
                variant={state.isMuted ? "default" : "outline"}
                size="icon"
                onClick={toggleMute}
                aria-label={state.isMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {state.isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>

              <Button variant="destructive" onClick={stop}>
                <PhoneOff className="size-4" aria-hidden />
                End conversation
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* After the call */}
      {state.status === "ended" || state.status === "error" ? (
        <div className="flex-1 space-y-4 overflow-y-auto">
          {state.error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          {saveError ? (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          {state.turns.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">
                    You spoke for {formatDuration(state.elapsedSec)}
                  </h2>
                  <Badge variant="muted">
                    {state.turns.filter((turn) => turn.role === "USER").length} turns
                  </Badge>
                </div>
                <div className="max-h-64 scrollbar-thin space-y-2 overflow-y-auto">
                  {state.turns.map((turn) => (
                    <p key={turn.id} className="text-sm">
                      <span className="text-muted-foreground font-medium">
                        {turn.role === "USER" ? `${learnerName}: ` : "Flua: "}
                      </span>
                      {turn.text}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isSaving ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Looking over how that went…
            </div>
          ) : null}

          {feedbackNote ? (
            <Alert variant="info">
              <AlertDescription>{feedbackNote}</AlertDescription>
            </Alert>
          ) : null}

          {feedback ? <SessionFeedbackPanel feedback={feedback} /> : null}

          <Button onClick={handleStart} className="w-full" disabled={isSaving}>
            <Mic className="size-4" aria-hidden />
            Start another conversation
          </Button>
        </div>
      ) : null}
    </div>
  );
}
