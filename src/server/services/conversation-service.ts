import "server-only";

import type { ConversationMode, Prisma } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildConversationOpenerPrompt,
  buildConversationSystemPrompt,
  buildSummarizationPrompt,
  wrapLearnerMessage,
} from "@/lib/ai/prompts/conversation";
import { buildTeacherSystemPrompt } from "@/lib/ai/prompts/teacher";
import type { LearnerContext } from "@/lib/ai/prompts/shared";
import type { AIMessage } from "@/lib/ai/types";
import { prisma } from "@/lib/db/client";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildConversationContext, buildTeacherContext } from "@/server/services/context-builder";

/**
 * Conversation orchestration: history, context windowing and streaming replies.
 *
 * The central cost/quality tradeoff lives here. Sending an unbounded transcript
 * to a free-tier model is both expensive and eventually impossible, so a
 * conversation is represented to the model as:
 *
 *     rolling summary of old turns  +  the last N turns verbatim
 *
 * which keeps prompt size flat no matter how long the conversation runs.
 */

/** Verbatim turns kept in the live window. */
const LIVE_WINDOW_MESSAGES = 12;
/** Once this many turns sit outside the window, they get folded into a summary. */
const SUMMARIZE_AFTER_UNSUMMARIZED = 10;

export interface ConversationSummary {
  id: string;
  title: string;
  mode: ConversationMode;
  topic: string | null;
  messageCount: number;
  updatedAt: Date;
  endedAt: Date | null;
}

export interface ConversationMessageView {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  sequence: number;
  createdAt: Date;
  corrections: unknown;
}

/** Loads a conversation, enforcing ownership. */
export async function getOwnedConversation(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      userId: true,
      mode: true,
      title: true,
      topic: true,
      summary: true,
      summarizedThrough: true,
      messageCount: true,
      startedAt: true,
      endedAt: true,
      deletedAt: true,
      feedback: true,
    },
  });

  if (!conversation || conversation.deletedAt) {
    throw new NotFoundError("That conversation doesn't exist.");
  }
  if (conversation.userId !== userId) {
    // Deliberately the same message as "not found": confirming the row exists
    // would leak that another user owns a conversation with this id.
    throw new NotFoundError("That conversation doesn't exist.");
  }

  return conversation;
}

export async function listConversations(
  userId: string,
  options: { mode?: ConversationMode; limit: number; cursor?: string },
): Promise<ConversationSummary[]> {
  return prisma.conversation.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(options.mode ? { mode: options.mode } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: options.limit,
    ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
    select: {
      id: true,
      title: true,
      mode: true,
      topic: true,
      messageCount: true,
      updatedAt: true,
      endedAt: true,
    },
  });
}

export async function createConversation(
  userId: string,
  input: { mode: ConversationMode; topic?: string; title?: string },
) {
  return prisma.conversation.create({
    data: {
      userId,
      mode: input.mode,
      topic: input.topic ?? null,
      title: input.title ?? defaultTitle(input.mode, input.topic),
    },
    select: { id: true, title: true, mode: true, topic: true, createdAt: true },
  });
}

function defaultTitle(mode: ConversationMode, topic?: string): string {
  if (topic) return topic.slice(0, 80);
  return mode === "TEACHER" ? "Teaching session" : "New conversation";
}

export async function softDeleteConversation(
  conversationId: string,
  userId: string,
): Promise<void> {
  const conversation = await getOwnedConversation(conversationId, userId);
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { deletedAt: new Date() },
  });
}

export async function getConversationMessages(
  conversationId: string,
  userId: string,
): Promise<ConversationMessageView[]> {
  await getOwnedConversation(conversationId, userId);

  return prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      sequence: true,
      createdAt: true,
      corrections: true,
    },
  });
}

/**
 * Assembles the model-facing message list.
 *
 * Returns the summary (if any) folded into the system prompt as context, plus
 * the most recent turns verbatim.
 */
async function buildModelMessages(
  conversationId: string,
  summary: string | null,
): Promise<{ messages: AIMessage[]; summaryNote: string | null }> {
  const recent = await prisma.conversationMessage.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { sequence: "desc" },
    take: LIVE_WINDOW_MESSAGES,
    select: { role: true, content: true, sequence: true },
  });

  const ordered = recent.reverse();

  const messages: AIMessage[] = ordered.map((message) => ({
    role: message.role === "USER" ? "user" : "assistant",
    // Learner turns are re-wrapped so the injection boundary holds across the
    // whole history, not just the newest message.
    content: message.role === "USER" ? wrapLearnerMessage(message.content) : message.content,
  }));

  return {
    messages,
    summaryNote: summary ? `Earlier in this conversation: ${summary}` : null,
  };
}

/** Next sequence number for a conversation. */
async function nextSequence(conversationId: string): Promise<number> {
  const last = await prisma.conversationMessage.findFirst({
    where: { conversationId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? -1) + 1;
}

export async function appendMessage(
  conversationId: string,
  input: {
    role: "USER" | "ASSISTANT";
    content: string;
    provider?: string;
    model?: string;
    latencyMs?: number;
    corrections?: Prisma.InputJsonValue;
  },
): Promise<{ id: string; sequence: number }> {
  const sequence = await nextSequence(conversationId);

  const [message] = await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        conversationId,
        role: input.role,
        content: input.content,
        sequence,
        provider: input.provider ?? null,
        model: input.model ?? null,
        latencyMs: input.latencyMs ?? null,
        ...(input.corrections === undefined ? {} : { corrections: input.corrections }),
      },
      select: { id: true, sequence: true },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { messageCount: { increment: 1 }, updatedAt: new Date() },
    }),
  ]);

  return message;
}

/** Builds the system prompt appropriate to the conversation's mode. */
export async function buildSystemPromptForMode(
  userId: string,
  mode: ConversationMode,
  topic: string | null,
): Promise<{ prompt: string; context: LearnerContext }> {
  if (mode === "TEACHER") {
    const context = await buildTeacherContext(userId);
    return { prompt: buildTeacherSystemPrompt(context), context };
  }

  const context = await buildConversationContext(userId);
  return { prompt: buildConversationSystemPrompt(context, topic ?? undefined), context };
}

export interface StreamReplyParams {
  userId: string;
  conversationId: string;
  learnerMessage: string;
  signal?: AbortSignal;
}

/**
 * Streams the tutor's reply.
 *
 * The learner's message is persisted before generation starts, so a failure
 * mid-stream never loses what they typed. The assistant turn is written by the
 * caller once the stream completes, because only the caller knows whether the
 * client actually received it.
 */
export async function* streamTutorReply(
  params: StreamReplyParams,
): AsyncGenerator<{ type: "text"; text: string }> {
  const conversation = await getOwnedConversation(params.conversationId, params.userId);

  if (conversation.endedAt) {
    throw new AuthorizationError(
      "This session has already ended. Start a new one to keep practising.",
    );
  }

  await appendMessage(conversation.id, { role: "USER", content: params.learnerMessage });

  const { prompt } = await buildSystemPromptForMode(
    params.userId,
    conversation.mode,
    conversation.topic,
  );

  const { messages, summaryNote } = await buildModelMessages(conversation.id, conversation.summary);

  const system = summaryNote ? `${prompt}\n\n=== CONVERSATION SO FAR ===\n${summaryNote}` : prompt;

  const aiService = getAIService();
  const task = conversation.mode === "TEACHER" ? "teacher" : "conversation";

  for await (const chunk of aiService.streamText({
    task,
    userId: params.userId,
    system,
    messages,
    // Conversation wants variety and warmth; teaching wants consistency.
    temperature: conversation.mode === "TEACHER" ? 0.4 : 0.8,
    maxOutputTokens: conversation.mode === "TEACHER" ? 900 : 400,
    signal: params.signal,
  })) {
    if (chunk.type === "text") {
      yield { type: "text", text: chunk.text };
    }
  }
}

/**
 * Folds older turns into the rolling summary when enough have accumulated.
 *
 * Runs after a reply rather than before, so it never delays the learner. A
 * failure here is logged and ignored: a slightly larger prompt next time is
 * much better than a broken conversation.
 */
export async function maybeSummarizeConversation(
  conversationId: string,
  userId: string,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { messageCount: true, summarizedThrough: true, summary: true },
  });

  if (!conversation) return;

  const outsideWindow = conversation.messageCount - LIVE_WINDOW_MESSAGES;
  const unsummarized = outsideWindow - conversation.summarizedThrough;

  if (unsummarized < SUMMARIZE_AFTER_UNSUMMARIZED) return;

  const toSummarize = await prisma.conversationMessage.findMany({
    where: {
      conversationId,
      sequence: { gte: conversation.summarizedThrough, lt: outsideWindow },
      role: { in: ["USER", "ASSISTANT"] },
    },
    orderBy: { sequence: "asc" },
    select: { role: true, content: true },
  });

  if (toSummarize.length === 0) return;

  const transcript = toSummarize
    .map((message) => `${message.role === "USER" ? "Learner" : "Tutor"}: ${message.content}`)
    .join("\n");

  try {
    const result = await getAIService().generateText({
      task: "summarization",
      userId,
      system: buildSummarizationPrompt(),
      messages: [
        {
          role: "user",
          content: [
            conversation.summary ? `Previous summary: ${conversation.summary}` : "",
            `<content>\n${transcript}\n</content>`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 250,
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        summary: result.text.trim(),
        summarizedThrough: outsideWindow,
      },
    });
  } catch (error) {
    logger.warn("Conversation summarization failed", {
      endpoint: "summarization",
      error: String(error),
    });
  }
}

/** Generates the tutor's opening line for a new conversation. */
export async function generateOpeningMessage(
  userId: string,
  conversationId: string,
): Promise<string> {
  const conversation = await getOwnedConversation(conversationId, userId);
  const context = await buildConversationContext(userId);

  const result = await getAIService().generateText({
    task: "conversation",
    userId,
    system: buildConversationOpenerPrompt(context, conversation.topic ?? undefined),
    messages: [{ role: "user", content: "Begin the conversation." }],
    temperature: 0.9,
    maxOutputTokens: 120,
  });

  const opening = result.text.trim();

  await appendMessage(conversationId, {
    role: "ASSISTANT",
    content: opening,
    provider: result.provider,
    model: result.model,
  });

  return opening;
}

/** Ends a session and records how long it ran. */
export async function endConversation(conversationId: string, userId: string): Promise<void> {
  const conversation = await getOwnedConversation(conversationId, userId);
  if (conversation.endedAt) return;

  const durationSec = Math.max(
    0,
    Math.round((Date.now() - conversation.startedAt.getTime()) / 1000),
  );

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { endedAt: new Date(), durationSec },
  });
}
