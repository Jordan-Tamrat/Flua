"use client";

import { Loader2, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiPost } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ConversationSummary {
  id: string;
  title: string;
  topic: string | null;
  messageCount: number;
  updatedAt: string;
  endedAt: string | null;
}

interface ConversationStarterProps {
  recent: ConversationSummary[];
  suggestedTopics: string[];
  mode: "CONVERSATION" | "TEACHER";
}

export function ConversationStarter({ recent, suggestedTopics, mode }: ConversationStarterProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startConversation(selectedTopic?: string) {
    setIsCreating(true);
    setError(null);

    try {
      const result = await apiPost<{ conversation: { id: string } }>("/api/conversations", {
        mode,
        topic: selectedTopic || undefined,
        // In Teacher mode the learner asks first, so no opening line is generated.
        generateOpening: mode === "CONVERSATION",
      });

      router.push(`/${mode === "TEACHER" ? "teacher" : "conversation"}/${result.conversation.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't start the conversation.");
      setIsCreating(false);
    }
  }

  const basePath = mode === "TEACHER" ? "/teacher" : "/conversation";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "TEACHER" ? "Teacher" : "Conversation"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {mode === "TEACHER"
            ? "Ask anything about English and get a proper explanation with examples and practice."
            : "Talk about whatever you like. Flua adapts to your level and saves corrections for the end."}
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {mode === "TEACHER" ? "Start a teaching session" : "Start talking"}
          </CardTitle>
          <CardDescription>
            {mode === "TEACHER"
              ? "You can ask things like “Explain the present perfect” or “Why is this sentence wrong?”"
              : "Pick a topic, or just start and see where it goes."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic">Topic (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder={
                  mode === "TEACHER"
                    ? "e.g. the difference between since and for"
                    : "e.g. my week at university"
                }
                maxLength={120}
                disabled={isCreating}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void startConversation(topic);
                  }
                }}
              />
              <Button onClick={() => startConversation(topic)} disabled={isCreating}>
                {isCreating ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                Start
              </Button>
            </div>
          </div>

          {suggestedTopics.length > 0 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium">Or try one of these</p>
              <div className="flex flex-wrap gap-2">
                {suggestedTopics.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => startConversation(suggestion)}
                    disabled={isCreating}
                    className={cn(
                      "border-border hover:bg-muted focus-visible:outline-ring rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2",
                      isCreating && "pointer-events-none opacity-50",
                    )}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {recent.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Recent sessions</h2>
          <ul className="space-y-2">
            {recent.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`${basePath}/${conversation.id}`}
                  className="border-border hover:border-primary/40 focus-visible:outline-ring flex items-center gap-3 rounded-xl border p-3 transition-colors focus-visible:outline-2"
                >
                  <MessageCircle className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{conversation.title}</span>
                    <span className="text-muted-foreground block text-xs">
                      {conversation.messageCount} message
                      {conversation.messageCount === 1 ? "" : "s"}
                      {conversation.endedAt ? " · finished" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
