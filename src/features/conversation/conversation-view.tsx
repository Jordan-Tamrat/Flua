"use client";

import { Loader2, RotateCcw, Send, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { MessageBubble, type ChatMessage } from "@/features/conversation/message-bubble";
import { SessionFeedbackPanel } from "@/features/conversation/session-feedback-panel";
import { useChatStream } from "@/features/conversation/use-chat-stream";
import { ApiError, apiPost } from "@/lib/api/client";
import type { SessionFeedback } from "@/lib/ai/schemas";

/**
 * The conversation screen.
 *
 * Streaming is the point: the reply builds up token by token in a placeholder
 * bubble, so the learner never watches a spinner. When a send fails the message
 * they typed is restored to the composer rather than lost.
 */

interface ConversationViewProps {
  conversationId: string;
  initialMessages: ChatMessage[];
  voiceSpeed: number;
  mode: "CONVERSATION" | "TEACHER";
  isEnded: boolean;
  initialFeedback: SessionFeedback | null;
}

export function ConversationView({
  conversationId,
  initialMessages,
  voiceSpeed,
  mode,
  isEnded,
  initialFeedback,
}: ConversationViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { send, cancel, isStreaming } = useChatStream();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(isEnded);
  const [feedback, setFeedback] = useState<SessionFeedback | null>(initialFeedback);
  const [isEnding, setIsEnding] = useState(false);
  /** The last message sent, kept so "retry" can resend it. */
  const [lastSent, setLastSent] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest turn in view as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submitMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || isStreaming) return;

      setError(null);
      setLastSent(trimmed);

      const userMessage: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "USER",
        content: trimmed,
      };

      const placeholderId = `streaming-${Date.now()}`;
      setMessages((current) => [
        ...current,
        userMessage,
        { id: placeholderId, role: "ASSISTANT", content: "", isStreaming: true },
      ]);

      await send(conversationId, trimmed, {
        onChunk: (chunk) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === placeholderId
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          );
        },
        onDone: (messageId) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === placeholderId
                ? { ...message, id: messageId, isStreaming: false }
                : message,
            ),
          );
        },
        onError: (message) => {
          setError(message);
          setMessages((current) => {
            const placeholder = current.find((entry) => entry.id === placeholderId);
            // Keep a partial reply if one arrived; drop an empty placeholder.
            if (placeholder && placeholder.content.length > 0) {
              return current.map((entry) =>
                entry.id === placeholderId ? { ...entry, isStreaming: false } : entry,
              );
            }
            return current.filter((entry) => entry.id !== placeholderId);
          });
        },
      });
    },
    [conversationId, isStreaming, send],
  );

  async function handleSubmit() {
    const text = input;
    setInput("");
    await submitMessage(text);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter makes a new line — the convention people expect.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  async function handleRetry() {
    if (!lastSent) return;
    // Drop the failed exchange before resending so it isn't duplicated.
    setMessages((current) => {
      const lastUserIndex = current.findLastIndex((message) => message.role === "USER");
      return lastUserIndex === -1 ? current : current.slice(0, lastUserIndex);
    });
    await submitMessage(lastSent);
  }

  async function handleEndSession() {
    setIsEnding(true);
    setError(null);

    try {
      const result = await apiPost<{ feedback: SessionFeedback }>(
        `/api/conversations/${conversationId}/end`,
      );
      setFeedback(result.feedback);
      setEnded(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VALIDATION_ERROR") {
        // Too short for feedback — end it anyway rather than trapping them here.
        setEnded(true);
        toast({ title: "Session ended", description: caught.message });
      } else {
        setError(caught instanceof ApiError ? caught.message : "We couldn't finish the session.");
      }
    } finally {
      setIsEnding(false);
    }
  }

  async function handleSaveWord(word: string) {
    try {
      const lookup = await apiPost<{
        entry: {
          word: string;
          definition: string;
          partOfSpeech?: string;
          exampleSentence?: string;
        };
      }>("/api/ai/vocabulary", { action: "lookup", word });

      await apiPost("/api/vocabulary", {
        word: lookup.entry.word,
        definition: lookup.entry.definition,
        partOfSpeech: lookup.entry.partOfSpeech,
        exampleSentence: lookup.entry.exampleSentence,
        sourceRef: conversationId,
      });

      toast({
        title: `Saved "${lookup.entry.word}"`,
        description: "It's in your vocabulary list for review.",
        variant: "success",
      });
    } catch (caught) {
      toast({
        title: "Couldn't save that word",
        description: caught instanceof ApiError ? caught.message : "Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col md:h-full">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {mode === "TEACHER" ? "Teacher" : "Conversation"}
          </h1>
          <p className="text-muted-foreground text-xs">
            {ended ? "This session has ended" : "Talk naturally — corrections come at the end"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!ended ? (
            <Button variant="outline" size="sm" onClick={handleEndSession} disabled={isEnding}>
              {isEnding ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Finishing…
                </>
              ) : (
                "End session"
              )}
            </Button>
          ) : (
            <Button size="sm" onClick={() => router.push("/conversation")}>
              <SquarePen className="size-4" aria-hidden />
              New
            </Button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 scrollbar-thin space-y-4 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            <p>Say hello and see where it goes.</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              voiceSpeed={voiceSpeed}
              onSaveWord={message.role === "ASSISTANT" ? handleSaveWord : undefined}
            />
          ))
        )}

        {feedback ? <SessionFeedbackPanel feedback={feedback} /> : null}
      </div>

      {error ? (
        <div className="px-4 pb-2">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>{error}</span>
              {lastSent ? (
                <Button variant="outline" size="sm" onClick={handleRetry} className="shrink-0">
                  <RotateCcw className="size-3.5" aria-hidden />
                  Retry
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {!ended ? (
        <div className="border-border border-t p-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor="chat-input" className="sr-only">
              Your message
            </label>
            <Textarea
              id="chat-input"
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message…"
              rows={1}
              className="max-h-40 min-h-11 flex-1 resize-none"
              disabled={isStreaming}
            />

            {isStreaming ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={cancel}
                aria-label="Stop generating"
              >
                <X className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={input.trim().length === 0}
                aria-label="Send message"
              >
                <Send className="size-4" aria-hidden />
              </Button>
            )}
          </form>
        </div>
      ) : null}
    </div>
  );
}
