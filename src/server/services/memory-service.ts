import "server-only";

import type { MemoryKind } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import { buildMemoryExtractionPrompt, wrapConversationExcerpt } from "@/lib/ai/prompts/memory";
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
