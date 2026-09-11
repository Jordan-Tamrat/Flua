import { limitByUser, requireSession } from "@/lib/api/guards";
import { apiFailure, parseJsonBody } from "@/lib/api/response";
import { toAppError } from "@/lib/errors";
import { createRequestId, logger } from "@/lib/logger";
import { chatRequestSchema } from "@/lib/validation/api";
import {
  appendMessage,
  maybeSummarizeConversation,
  streamTutorReply,
} from "@/server/services/conversation-service";
import { addPracticeSeconds } from "@/server/services/practice-service";
import { recordPracticeDay } from "@/server/services/progress-service";

/**
 * Streaming chat endpoint.
 *
 * Emits newline-delimited JSON rather than raw text so the client can
 * distinguish content from a mid-stream error. Deliberately provider-agnostic:
 * the wire format says nothing about which model produced the tokens.
 *
 * Frames:
 *   {"type":"chunk","text":"…"}
 *   {"type":"done","messageId":"…"}
 *   {"type":"error","code":"…","message":"…"}
 */

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function frame(payload: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(payload)}\n`);
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  // Authentication, rate limiting and validation happen before the stream
  // starts, so these failures return a normal JSON error response.
  let userId: string;
  let conversationId: string;
  let message: string;

  try {
    const session = await requireSession();
    userId = session.userId;

    limitByUser(userId, "chat");

    const body = await parseJsonBody(request, chatRequestSchema);
    conversationId = body.conversationId;
    message = body.message;
  } catch (error) {
    const appError = toAppError(error);
    logger.warn("Chat request rejected", {
      requestId,
      endpoint: "POST /api/ai/chat",
      code: appError.code,
    });
    return apiFailure(appError, requestId);
  }

  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";

      try {
        for await (const chunk of streamTutorReply({
          userId,
          conversationId,
          learnerMessage: message,
          signal: request.signal,
        })) {
          assistantText += chunk.text;
          controller.enqueue(frame({ type: "chunk", text: chunk.text }));
        }

        // The reply is persisted only after the stream completes, so a partial
        // response never becomes part of the conversation history.
        const saved = await appendMessage(conversationId, {
          role: "ASSISTANT",
          content: assistantText,
          latencyMs: Date.now() - startedAt,
        });

        controller.enqueue(frame({ type: "done", messageId: saved.id }));
        controller.close();

        // Housekeeping runs after the learner already has their reply.
        void Promise.allSettled([
          maybeSummarizeConversation(conversationId, userId),
          recordPracticeDay(userId),
          addPracticeSeconds(userId, Math.round((Date.now() - startedAt) / 1000) + 30),
        ]);
      } catch (error) {
        const appError = toAppError(error);

        logger.error("Chat stream failed", {
          requestId,
          endpoint: "POST /api/ai/chat",
          userId,
          code: appError.code,
          error: appError.message,
        });

        // If any text already reached the client, keep it: a partial reply plus
        // an error is more useful than silently dropping what was generated.
        if (assistantText.length > 0) {
          await appendMessage(conversationId, {
            role: "ASSISTANT",
            content: assistantText,
            latencyMs: Date.now() - startedAt,
          }).catch(() => undefined);
        }

        controller.enqueue(
          frame({ type: "error", code: appError.code, message: appError.publicMessage }),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Request-Id": requestId,
      // Tells nginx-style proxies not to buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
