import "server-only";

import type { SessionFeedback } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import {
  getConversationMessages,
  getOwnedConversation,
} from "@/server/services/conversation-service";
import { getStoredFeedback } from "@/server/services/feedback-service";

import type { ChatMessage } from "@/features/conversation/message-bubble";

/**
 * Loads everything the conversation screen needs.
 *
 * Shared by the Conversation and Teacher routes, which render the same view in
 * different modes. Returns `null` when the conversation doesn't exist or isn't
 * the caller's, so the page can call `notFound()` without wrapping JSX in a
 * try/catch.
 */

export interface ConversationPageData {
  conversationId: string;
  mode: "CONVERSATION" | "TEACHER";
  isEnded: boolean;
  feedback: SessionFeedback | null;
  voiceSpeed: number;
  messages: ChatMessage[];
}

export async function loadConversationPageData(
  conversationId: string,
  userId: string,
): Promise<ConversationPageData | null> {
  try {
    const [conversation, messages, profile, feedback] = await Promise.all([
      getOwnedConversation(conversationId, userId),
      getConversationMessages(conversationId, userId),
      prisma.profile.findUnique({
        where: { userId },
        select: { voiceSpeed: true },
      }),
      getStoredFeedback(userId, conversationId),
    ]);

    return {
      conversationId: conversation.id,
      mode: conversation.mode === "TEACHER" ? "TEACHER" : "CONVERSATION",
      isEnded: conversation.endedAt !== null,
      feedback,
      voiceSpeed: profile?.voiceSpeed ?? 1,
      messages: messages
        .filter((message) => message.role !== "SYSTEM")
        .map((message) => ({
          id: message.id,
          role: message.role as "USER" | "ASSISTANT",
          content: message.content,
        })),
    };
  } catch (error) {
    // The service raises NotFound for both a missing row and another user's
    // row, so an id belonging to someone else is indistinguishable from a typo.
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
