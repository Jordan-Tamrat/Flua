import "server-only";

import type { MemoryKind } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildMemoryExtractionPrompt,
  buildSessionRecapPrompt,
  wrapConversationExcerpt,
  wrapRecapTranscript,
} from "@/lib/ai/prompts/memory";
import { memoryExtractionSchema } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";

/**
 * Long-term learner memory.
 *
 * Memory is valuable only while it stays small and true, so extraction is
 * deliberately conservative: run after a session rather than per message, cap
 * the total, reinforce duplicates instead of adding near-copies, and retire the
 * least useful entries when the cap is reached.
 */

/** Hard ceiling on active memories per learner. */
const MAX_ACTIVE_MEMORIES = 30;
/** Below this the model is guessing, and a wrong "fact" is worse than none. */
const MIN_CONFIDENCE = 0.6;
/** Only extract when a session had enough substance to say anything about. */
const MIN_MESSAGES_FOR_EXTRACTION = 6;
/**
 * Lower than the extraction threshold on purpose: even a couple of exchanges
 * usually contain something worth picking up next time, and this call is the
 * cheaper of the two.
 */
const MIN_MESSAGES_FOR_RECAP = 4;
/** How much of a long conversation reaches the recap model. */
const MAX_RECAP_TRANSCRIPT_CHARS = 6000;

export async function getActiveMemories(userId: string, limit = 20) {
  return prisma.learnerMemory.findMany({
    where: { userId, retiredAt: null },
    orderBy: [{ reinforcementCount: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      kind: true,
      content: true,
      confidence: true,
      reinforcementCount: true,
      createdAt: true,
    },
  });
}

/**
 * Rough duplicate detection.
 *
 * Compares normalized word sets — enough to catch "struggles with articles" vs
 * "has trouble with articles" without an embedding model, which would be a
 * disproportionate dependency for this.
 */
function isSimilar(a: string, b: string): boolean {
  const tokenize = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );

  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return false;

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }

  const overlap = shared / Math.min(setA.size, setB.size);
  return overlap >= 0.6;
}

export interface ExtractMemoriesParams {
  userId: string;
  conversationId: string;
  signal?: AbortSignal;
}

/**
 * Extracts durable facts from a finished conversation.
 *
 * Best-effort by design: this runs after the learner has already received their
 * feedback, so a failure here is logged and dropped rather than surfaced.
 */
export async function extractMemoriesFromConversation(
  params: ExtractMemoriesParams,
): Promise<number> {
  const messages = await prisma.conversationMessage.findMany({
    where: { conversationId: params.conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { sequence: "asc" },
    select: { role: true, content: true },
  });

  if (messages.length < MIN_MESSAGES_FOR_EXTRACTION) {
    return 0;
  }

  const existing = await prisma.learnerMemory.findMany({
    where: { userId: params.userId, retiredAt: null },
    orderBy: { reinforcementCount: "desc" },
    take: 25,
    select: { id: true, content: true, reinforcementCount: true },
  });

  const transcript = messages
    .map((message) => `${message.role === "USER" ? "Learner" : "Tutor"}: ${message.content}`)
    .join("\n")
    .slice(0, 6000);

  try {
    const result = await getAIService().generateStructured({
      task: "memory_extraction",
      userId: params.userId,
      system: buildMemoryExtractionPrompt(existing.map((memory) => memory.content)),
      messages: [{ role: "user", content: wrapConversationExcerpt(transcript) }],
      schema: memoryExtractionSchema,
      schemaName: "MemoryExtraction",
      temperature: 0.2,
      maxOutputTokens: 600,
      signal: params.signal,
    });

    let saved = 0;

    for (const memory of result.data.memories) {
      if (memory.confidence < MIN_CONFIDENCE) continue;

      const duplicate = existing.find((entry) => isSimilar(entry.content, memory.content));

      if (duplicate) {
        // Seeing the same thing again is evidence, so it raises the memory's
        // priority rather than creating a near-identical second row.
        await prisma.learnerMemory.update({
          where: { id: duplicate.id },
          data: {
            reinforcementCount: { increment: 1 },
            confidence: Math.min(1, memory.confidence + 0.1),
            lastUsedAt: new Date(),
          },
        });
        continue;
      }

      await prisma.learnerMemory.create({
        data: {
          userId: params.userId,
          kind: memory.kind as MemoryKind,
          content: memory.content,
          confidence: memory.confidence,
          sourceRef: params.conversationId,
        },
      });
      saved += 1;
    }

    await enforceMemoryCap(params.userId);
    return saved;
  } catch (error) {
    logger.warn("Memory extraction failed", {
      userId: params.userId,
      error: String(error),
    });
    return 0;
  }
}

export interface GenerateRecapParams {
  userId: string;
  conversationId: string;
  signal?: AbortSignal;
}

/**
 * Writes the "what we talked about" note for a finished conversation.
 *
 * This is episodic memory, and it is what lets the next session open with "how
 * did the interview go?" instead of "what would you like to talk about?".
 * Durable *traits* are handled by `extractMemoriesFromConversation`; this
 * records the *events*, which nothing previously did for spoken sessions.
 *
 * Stored on `Conversation.summary`, which already exists and sits unused for
 * spoken sessions — the text path maintains it as a rolling compression of older
 * turns, and the meaning is the same here: what happened in this thread.
 *
 * Best-effort: a missing recap costs continuity, never the learner's session.
 */
export async function generateSessionRecap(params: GenerateRecapParams): Promise<string | null> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { userId: true, messageCount: true },
    });

    if (!conversation || conversation.userId !== params.userId) return null;

    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: params.conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { sequence: "asc" },
      select: { role: true, content: true },
    });

    if (messages.length < MIN_MESSAGES_FOR_RECAP) return null;

    const learner = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });

    /*
     * Trimmed from the front, keeping the most recent turns: the end of a long
     * conversation is what the learner will remember and what is most likely to
     * still be live next time.
     */
    const lines = messages.map(
      (message) => `${message.role === "USER" ? "Learner" : "Tutor"}: ${message.content}`,
    );

    let transcript = lines.join("\n");
    if (transcript.length > MAX_RECAP_TRANSCRIPT_CHARS) {
      const kept: string[] = [];
      let length = 0;
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line === undefined) continue;
        if (length + line.length + 1 > MAX_RECAP_TRANSCRIPT_CHARS) break;
        kept.unshift(line);
        length += line.length + 1;
      }
      transcript = kept.join("\n");
    }

    const result = await getAIService().generateText({
      task: "summarization",
      userId: params.userId,
      system: buildSessionRecapPrompt(learner?.name ?? "the learner"),
      messages: [{ role: "user", content: wrapRecapTranscript(transcript) }],
      temperature: 0.4,
      maxOutputTokens: 200,
      signal: params.signal,
    });

    const summary = result.text.trim();
    // A near-empty answer means the model found nothing worth remembering,
    // which the prompt explicitly allows. Storing it would show up as a blank
    // bullet in the next session's prompt.
    if (summary.length < 15) return null;

    await prisma.conversation.update({
      where: { id: params.conversationId },
      data: { summary, summarizedThrough: conversation.messageCount },
    });

    return summary;
  } catch (error) {
    logger.warn("Session recap failed", {
      userId: params.userId,
      error: String(error),
    });
    return null;
  }
}

/** Retires the least-reinforced memories once a learner exceeds the cap. */
async function enforceMemoryCap(userId: string): Promise<void> {
  const count = await prisma.learnerMemory.count({ where: { userId, retiredAt: null } });
  if (count <= MAX_ACTIVE_MEMORIES) return;

  const surplus = await prisma.learnerMemory.findMany({
    where: { userId, retiredAt: null },
    orderBy: [{ reinforcementCount: "asc" }, { confidence: "asc" }, { updatedAt: "asc" }],
    take: count - MAX_ACTIVE_MEMORIES,
    select: { id: true },
  });

  await prisma.learnerMemory.updateMany({
    where: { id: { in: surplus.map((memory) => memory.id) } },
    data: { retiredAt: new Date() },
  });
}

/** Lets a learner remove something the tutor remembered. */
export async function retireMemory(userId: string, memoryId: string): Promise<void> {
  await prisma.learnerMemory.updateMany({
    where: { id: memoryId, userId },
    data: { retiredAt: new Date() },
  });
}
