import "server-only";

import { getAIService } from "@/lib/ai/ai-service";
import { buildSessionFeedbackPrompt, wrapSessionTranscript } from "@/lib/ai/prompts/feedback";
import { sessionFeedbackSchema, type SessionFeedback } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildFeedbackContext } from "@/server/services/context-builder";
import { getOwnedConversation } from "@/server/services/conversation-service";
import { recordCorrections } from "@/server/services/grammar-service";
import { extractMemoriesFromConversation } from "@/server/services/memory-service";

/**
 * End-of-session feedback.
 *
 * This is the step that closes the learning loop the spec describes: the
 * session ends, feedback appears, the weaknesses it found are recorded, and
 * tomorrow's plan is built from them.
 */

/** Below this there isn't enough material to say anything meaningful. */
const MIN_LEARNER_MESSAGES = 3;

export async function generateSessionFeedback(
  userId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<SessionFeedback> {
  const conversation = await getOwnedConversation(conversationId, userId);

  // Feedback is generated once and cached on the conversation, so reopening an
  // ended session doesn't spend another request.
  if (conversation.feedback) {
    const cached = sessionFeedbackSchema.safeParse(conversation.feedback);
    if (cached.success) return cached.data;
  }

  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { sequence: "asc" },
    select: { role: true, content: true },
  });

  const learnerMessages = messages.filter((message) => message.role === "USER");

  if (learnerMessages.length < MIN_LEARNER_MESSAGES) {
    throw new ValidationError(
      "This session was too short to give useful feedback. Try chatting a bit longer next time.",
    );
  }

  const context = await buildFeedbackContext(userId);

  const transcript = messages
    .map((message) => `${message.role === "USER" ? "Learner" : "Tutor"}: ${message.content}`)
    .join("\n")
    .slice(0, 8000);

  const result = await getAIService().generateStructured({
    task: "session_feedback",
    userId,
    system: buildSessionFeedbackPrompt(context),
    messages: [{ role: "user", content: wrapSessionTranscript(transcript) }],
    schema: sessionFeedbackSchema,
    schemaName: "SessionFeedback",
    temperature: 0.3,
    maxOutputTokens: 1800,
    signal,
  });

  const feedback = result.data;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { feedback: feedback as unknown as object },
  });

  // Recording corrections and extracting memories are both secondary to showing
  // the learner their feedback, so neither is allowed to fail the request.
  try {
    await recordCorrections({
      userId,
      corrections: feedback.corrections,
      source: "conversation",
      conversationId,
    });
  } catch (error) {
    logger.warn("Failed to record session corrections", { userId, error: String(error) });
  }

  void extractMemoriesFromConversation({ userId, conversationId }).catch((error: unknown) => {
    logger.warn("Memory extraction failed after session", { userId, error: String(error) });
  });

  return feedback;
}

export async function getStoredFeedback(
  userId: string,
  conversationId: string,
): Promise<SessionFeedback | null> {
  const conversation = await getOwnedConversation(conversationId, userId);
  if (!conversation.feedback) return null;

  const parsed = sessionFeedbackSchema.safeParse(conversation.feedback);
  if (!parsed.success) {
    // Stored feedback predates a schema change, or was written by an older
    // version. Treat it as absent rather than crashing the page.
    logger.warn("Stored session feedback failed validation", { conversationId });
    return null;
  }

  return parsed.data;
}

/** Loads a conversation's feedback, or throws if the session doesn't exist. */
export async function requireConversationForFeedback(userId: string, conversationId: string) {
  const conversation = await getOwnedConversation(conversationId, userId);
  if (!conversation) {
    throw new NotFoundError("That conversation doesn't exist.");
  }
  return conversation;
}
