"use client";

import { BookmarkPlus, Check, Copy, Volume2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { speak, isSpeechSynthesisSupported } from "@/lib/speech/text-to-speech";
import { cn } from "@/lib/utils";

/**
 * A single conversation turn.
 *
 * Assistant messages carry actions — copy, hear it, save a word — because those
 * are the things a learner actually wants to do with a tutor's reply. Word
 * saving works by selecting text in the bubble, which avoids adding a separate
 * lookup UI to every message.
 */

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  isStreaming?: boolean;
}

interface MessageBubbleProps {
  message: ChatMessage;
  voiceSpeed: number;
  onSaveWord?: (word: string) => void;
}

export function MessageBubble({ message, voiceSpeed, onSaveWord }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const isUser = message.role === "USER";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the copy simply doesn't happen.
    }
  }

  function handleSpeak() {
    if (isSpeaking) return;
    setIsSpeaking(true);
    speak(message.content, { rate: voiceSpeed, onEnd: () => setIsSpeaking(false) });
  }

  function handleSaveSelection() {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 0 && selection.length <= 80) {
      onSaveWord?.(selection);
    }
  }

  return (
    <div
      className={cn(
        "group flex animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)] gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser ? (
        <span
          className="bg-primary text-primary-foreground mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          aria-hidden
        >
          F
        </span>
      ) : null}

      <div className={cn("max-w-[85%] space-y-1.5 sm:max-w-[75%]", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm",
          )}
        >
          {message.content}
          {message.isStreaming ? (
            <span className="ml-0.5 inline-flex gap-0.5 align-middle" aria-label="Tutor is typing">
              <span className="inline-block size-1 animate-[typing_1.2s_ease-in-out_infinite] rounded-full bg-current" />
              <span className="inline-block size-1 animate-[typing_1.2s_ease-in-out_0.2s_infinite] rounded-full bg-current" />
              <span className="inline-block size-1 animate-[typing_1.2s_ease-in-out_0.4s_infinite] rounded-full bg-current" />
            </span>
          ) : null}
        </div>

        {!isUser && !message.isStreaming ? (
          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button variant="ghost" size="icon-sm" onClick={handleCopy} aria-label="Copy message">
              {copied ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </Button>

            {isSpeechSynthesisSupported() ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSpeak}
                disabled={isSpeaking}
                aria-label="Hear this message read aloud"
              >
                <Volume2 className={cn("size-3.5", isSpeaking && "text-primary")} aria-hidden />
              </Button>
            ) : null}

            {onSaveWord ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSaveSelection}
                aria-label="Save the selected word to your vocabulary"
                title="Select a word in this message, then click to save it"
              >
                <BookmarkPlus className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
