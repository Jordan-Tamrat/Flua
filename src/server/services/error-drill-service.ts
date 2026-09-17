import "server-only";

import type { ReviewOutcome } from "@/generated/prisma";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";
import { scheduleNextReview } from "@/lib/learning/spaced-repetition";
import { bumpTopicStat } from "@/server/services/grammar-service";

/**
 * Retrieval practice on the learner's own mistakes.
 *
 * Corrections used to be shown once, after a session, and then never mentioned
 * again — the learner read them and moved on. Reading a correction is not what
 * changes anything; being asked to produce the right form again, later, is.
 * This puts each recorded mistake back in front of the learner on a spaced
 * schedule, as their own sentence, and asks them to fix it.
 *
 * Two things make it cheap. The schedule reuses the SM-2 already running for
 * vocabulary, and the grading needs no model at all: `correctedText` was
 * produced by a model that had the learner's sentence in front of it, so the
 * target answer is already stored beside the error. Comparing two strings is
 * free, and it is exact.
 */

export interface ErrorDrillItem {
  mistakeId: string;
  /** Verbatim what the learner said. The whole point is that it is theirs. */
  prompt: string;
  category: string;
  categoryLabel: string;
  /** Shown only after an attempt, so it can't be read off the page first. */
  explanation: string;
  saidAt: string;
  retestCount: number;
}

export interface ErrorDrillResult {
  wasCorrect: boolean;
  /** Revealed after the attempt either way — a failed retrieval still teaches. */
  correctedText: string;
  explanation: string;
  outcome: ReviewOutcome;
  retired: boolean;
  dueAt: string;
}

/** Below this the queue starts feeling like a chore rather than a quick check. */
export const MAX_DRILLS_PER_SESSION = 8;

/** Consecutive correct retests before an item is considered learned. */
const RETIRE_AT_STREAK = 3;

/**
 * Mistakes ready to be put back to the learner.
 *
 * Ordered by how overdue they are, so the ones closest to being forgotten come
 * first. `correctedText` is deliberately not selected — it must not reach the
 * client before the learner has attempted the fix.
 */
export async function getDueErrorDrills(
  userId: string,
  limit = MAX_DRILLS_PER_SESSION,
): Promise<ErrorDrillItem[]> {
  const rows = await prisma.grammarMistake.findMany({
    where: { userId, retiredAt: null, dueAt: { lte: new Date() } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: Math.min(limit, MAX_DRILLS_PER_SESSION),
    select: {
      id: true,
      originalText: true,
      category: true,
      explanation: true,
      createdAt: true,
      retestCount: true,
    },
  });

  return rows.map((row) => ({
    mistakeId: row.id,
    prompt: row.originalText,
    category: row.category,
    categoryLabel: getGrammarLabel(row.category),
    explanation: row.explanation,
    saidAt: row.createdAt.toISOString(),
    retestCount: row.retestCount,
  }));
}

/** How many are waiting, for the dashboard and the daily plan. */
export async function countDueErrorDrills(userId: string): Promise<number> {
  return prisma.grammarMistake.count({
    where: { userId, retiredAt: null, dueAt: { lte: new Date() } },
  });
}

/**
 * Normalises an answer for comparison.
 *
 * Case, surrounding punctuation and spacing are not what is being tested —
 * failing someone for a missing full stop on a spoken sentence would be
 * measuring typing, not English.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-level edit distance, so "one word off" can be told from "wrong". */
function wordDistance(a: string[], b: string[]): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dist[i]![0] = i;
  for (let j = 0; j < cols; j += 1) dist[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dist[rows - 1]![cols - 1]!;
}

/** Whether a correct answer took long enough to count as effortful recall. */
const SLOW_ANSWER_MS = 12_000;

/**
 * Grades a typed attempt and advances the schedule.
 *
 * Grading happens here rather than in the browser so the expected answer never
 * has to be sent to the client before the attempt.
 */
export async function recordErrorDrillResult(
  userId: string,
  mistakeId: string,
  typedAnswer: string,
  responseMs?: number,
): Promise<ErrorDrillResult> {
  const mistake = await prisma.grammarMistake.findFirst({
    where: { id: mistakeId, userId },
    select: {
      id: true,
      correctedText: true,
      explanation: true,
      category: true,
      easeFactor: true,
      intervalDays: true,
      repetitions: true,
      streak: true,
      retestCount: true,
    },
  });

  if (!mistake) {
    throw new NotFoundError("That practice item doesn't exist.");
  }

  const expected = normalise(mistake.correctedText).split(" ").filter(Boolean);
  const actual = normalise(typedAnswer).split(" ").filter(Boolean);
  const distance = wordDistance(expected, actual);

  /*
   * Three bands rather than pass/fail. A learner who fixes the error but phrases
   * the rest differently has demonstrated the thing being tested, and marking
   * that wrong would teach them to guess the model's wording instead of the
   * grammar.
   */
  let outcome: ReviewOutcome;
  if (distance === 0) {
    outcome = responseMs !== undefined && responseMs > SLOW_ANSWER_MS ? "HARD" : "GOOD";
  } else if (distance <= 2) {
    outcome = "HARD";
  } else {
    outcome = "AGAIN";
  }

  const next = scheduleNextReview(
    {
      easeFactor: mistake.easeFactor,
      intervalDays: mistake.intervalDays,
      repetitions: mistake.repetitions,
    },
    outcome,
  );

  const streak = next.wasCorrect ? mistake.streak + 1 : 0;
  const retired = streak >= RETIRE_AT_STREAK;

  await prisma.grammarMistake.update({
    where: { id: mistake.id },
    data: {
      easeFactor: next.easeFactor,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      dueAt: next.dueAt,
      retestCount: { increment: 1 },
      streak,
      retiredAt: retired ? new Date() : null,
      // Seeing the correction here is the acknowledgement the old unused
      // `acknowledgeMistake` was meant to record.
      acknowledgedAt: new Date(),
    },
  });

  /*
   * A drill has a right answer, so unlike conversation it can legitimately move
   * drill accuracy for the category. This is the only path that gives a topic
   * credit for getting something right.
   */
  await bumpTopicStat(userId, mistake.category, {
    attempts: 1,
    correct: next.wasCorrect ? 1 : 0,
  });

  return {
    wasCorrect: next.wasCorrect,
    correctedText: mistake.correctedText,
    explanation: mistake.explanation,
    outcome,
    retired,
    dueAt: next.dueAt.toISOString(),
  };
}

/**
 * Drops an item the learner can't sensibly fix.
 *
 * These sentences come from speech-to-text, so some are transcription noise
 * rather than a real mistake. One nonsensical drill is enough to make the whole
 * feature feel broken, so there has to be a way to say so.
 */
export async function dismissErrorDrill(userId: string, mistakeId: string): Promise<void> {
  const updated = await prisma.grammarMistake.updateMany({
    where: { id: mistakeId, userId, retiredAt: null },
    data: { retiredAt: new Date() },
  });

  if (updated.count === 0) {
    throw new NotFoundError("That practice item doesn't exist.");
  }
}
