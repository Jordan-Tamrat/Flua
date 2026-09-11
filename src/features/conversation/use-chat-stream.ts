"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Consumes the NDJSON chat stream.
 *
 * The endpoint frames each event as one JSON object per line, so this reads the
 * body incrementally and splits on newlines — a chunk boundary can land in the
 * middle of a line, which is why the tail is buffered rather than parsed.
 */

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: (messageId: string) => void;
  onError: (message: string) => void;
}

type StreamFrame =
  | { type: "chunk"; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; code: string; message: string };

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (conversationId: string, message: string, callbacks: StreamCallbacks) => {
      // A new send supersedes anything still in flight.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // Pre-stream failures come back as a normal JSON error envelope.
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          callbacks.onError(
            payload?.error?.message ?? "We couldn't reach the tutor. Please try again.",
          );
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          // The final element is either empty or a partial line; keep it.
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim().length === 0) continue;

            let frame: StreamFrame;
            try {
              frame = JSON.parse(line) as StreamFrame;
            } catch {
              continue;
            }

            if (frame.type === "chunk") {
              callbacks.onChunk(frame.text);
            } else if (frame.type === "done") {
              callbacks.onDone(frame.messageId);
            } else if (frame.type === "error") {
              callbacks.onError(frame.message);
            }
          }
        }
      } catch (error) {
        // A user-initiated cancel isn't an error worth surfacing.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        callbacks.onError("The connection dropped. Please try again.");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  return { send, cancel, isStreaming };
}
