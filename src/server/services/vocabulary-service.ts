import "server-only";

import type { CefrLevel, ReviewOutcome, VocabularyStatus } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildVocabularyLookupPrompt,
  buildVocabularyQuizPrompt,
  buildVocabularySuggestionPrompt,
  wrapWord,
} from "@/lib/ai/prompts/vocabulary";
import {
  vocabularyEntrySchema,
  vocabularyQuizSchema,
  vocabularySuggestionsSchema,
  type VocabularyEntry,
  type VocabularyQuiz,
} from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { INITIAL_REVIEW_STATE, scheduleNextReview } from "@/lib/learning/spaced-repetition";
import { buildVocabularyContext } from "@/server/services/context-builder";

/**
 * Vocabulary: saving words, looking them up, reviewing and quizzing.
 *
 * A guiding rule from the spec is honoured here: don't call an AI when code can
 * answer. A word the learner has already saved is returned straight from the
 * database, and only genuinely unknown words cost a request.
 */

export interface VocabularyListOptions {
  status?: VocabularyStatus;
  dueOnly?: boolean;
  search?: string;
  limit: number;
  offset: number;
}

export async function listVocabulary(userId: string, options: VocabularyListOptions) {
  const where = {
    userId,
    deletedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.dueOnly ? { dueAt: { lte: new Date() } } : {}),
    ...(options.search ? { word: { contains: options.search, mode: "insensitive" as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.vocabularyItem.findMany({
      where,
      orderBy: options.dueOnly ? { dueAt: "asc" } : { createdAt: "desc" },
      take: options.limit,
      skip: options.offset,
      select: {
        id: true,
        word: true,
        definition: true,
        partOfSpeech: true,
        exampleSentence: true,
        synonyms: true,
        antonyms: true,
        difficulty: true,
        status: true,
        dueAt: true,
        reviewCount: true,
        successCount: true,
        failureCount: true,
        intervalDays: true,
        firstLearnedAt: true,
        lastReviewedAt: true,
      },
    }),
    prisma.vocabularyItem.count({ where }),
  ]);

  return { items, total };
}

/**
 * Looks a word up.
 *
 * Checks the learner's own collection first — a word they've saved needs no
 * model call at all.
 */
export async function lookupWord(
  userId: string,
  word: string,
  signal?: AbortSignal,
): Promise<{ entry: VocabularyEntry; alreadySaved: boolean; savedId?: string }> {
  const normalized = word.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new ValidationError("Enter a word to look up.");
  }

  const existing = await prisma.vocabularyItem.findUnique({
    where: { userId_word: { userId, word: normalized } },
    select: {
      id: true,
      word: true,
      definition: true,
      partOfSpeech: true,
      exampleSentence: true,
      synonyms: true,
      antonyms: true,
      difficulty: true,
      deletedAt: true,
    },
  });

  if (existing && !existing.deletedAt) {
    return {
      alreadySaved: true,
      savedId: existing.id,
      entry: {
        word: existing.word,
        definition: existing.definition,
        partOfSpeech: existing.partOfSpeech ?? undefined,
        exampleSentence: existing.exampleSentence ?? undefined,
        synonyms: existing.synonyms,
        antonyms: existing.antonyms,
        difficulty: existing.difficulty,
      },
    };
  }

  const context = await buildVocabularyContext(userId);

  const result = await getAIService().generateStructured({
    task: "vocabulary",
    userId,
    system: buildVocabularyLookupPrompt(context),
    messages: [{ role: "user", content: wrapWord(normalized) }],
    schema: vocabularyEntrySchema,
    schemaName: "VocabularyEntry",
    temperature: 0.3,
    maxOutputTokens: 700,
    signal,
  });

  return { entry: result.data, alreadySaved: false };
}

export interface SaveWordInput {
  word: string;
  definition: string;
  partOfSpeech?: string;
  exampleSentence?: string;
  synonyms?: string[];
  antonyms?: string[];
  difficulty?: CefrLevel;
  sourceRef?: string;
}

/**
 * Saves a word.
 *
 * Upserts on (userId, word) so saving the same word twice updates it rather
 * than failing — and un-deletes a word the learner previously removed, keeping
 * its review history intact.
 */
export async function saveWord(userId: string, input: SaveWordInput) {
  const normalized = input.word.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new ValidationError("Enter a word to save.");
  }

  return prisma.vocabularyItem.upsert({
    where: { userId_word: { userId, word: normalized } },
    create: {
      userId,
      word: normalized,
      definition: input.definition,
      partOfSpeech: input.partOfSpeech ?? null,
      exampleSentence: input.exampleSentence ?? null,
      synonyms: input.synonyms ?? [],
      antonyms: input.antonyms ?? [],
      difficulty: input.difficulty ?? "B1",
      sourceRef: input.sourceRef ?? null,
      easeFactor: INITIAL_REVIEW_STATE.easeFactor,
      intervalDays: INITIAL_REVIEW_STATE.intervalDays,
      repetitions: INITIAL_REVIEW_STATE.repetitions,
      dueAt: new Date(),
    },
    update: {
      definition: input.definition,
      partOfSpeech: input.partOfSpeech ?? null,
      exampleSentence: input.exampleSentence ?? null,
      synonyms: input.synonyms ?? [],
      antonyms: input.antonyms ?? [],
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      deletedAt: null,
    },
    select: {
      id: true,
      word: true,
      definition: true,
      partOfSpeech: true,
      exampleSentence: true,
      synonyms: true,
      antonyms: true,
      difficulty: true,
      status: true,
      dueAt: true,
    },
  });
}

async function getOwnedItem(userId: string, itemId: string) {
  const item = await prisma.vocabularyItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      userId: true,
      deletedAt: true,
      easeFactor: true,
      intervalDays: true,
      repetitions: true,
      reviewCount: true,
      successCount: true,
      failureCount: true,
    },
  });

  if (!item || item.deletedAt || item.userId !== userId) {
    throw new NotFoundError("That word isn't in your collection.");
  }

  return item;
}

export async function updateWord(
  userId: string,
  itemId: string,
  updates: { status?: VocabularyStatus; definition?: string; exampleSentence?: string },
) {
  await getOwnedItem(userId, itemId);

  return prisma.vocabularyItem.update({
    where: { id: itemId },
    data: {
      ...(updates.status ? { status: updates.status } : {}),
      ...(updates.definition ? { definition: updates.definition } : {}),
      ...(updates.exampleSentence !== undefined
        ? { exampleSentence: updates.exampleSentence }
        : {}),
    },
    select: { id: true, word: true, status: true, definition: true, exampleSentence: true },
  });
}

export async function deleteWord(userId: string, itemId: string): Promise<void> {
  await getOwnedItem(userId, itemId);
  await prisma.vocabularyItem.update({
    where: { id: itemId },
    data: { deletedAt: new Date() },
  });
}

/**
 * Records a review and advances the SM-2 schedule.
 *
 * The item update and the review row are written together so the schedule can
 * never drift out of step with its own history.
 */
export async function reviewWord(
  userId: string,
  itemId: string,
  outcome: ReviewOutcome,
  responseMs?: number,
) {
  const item = await getOwnedItem(userId, itemId);

  const next = scheduleNextReview(
    {
      easeFactor: item.easeFactor,
      intervalDays: item.intervalDays,
      repetitions: item.repetitions,
    },
    outcome,
  );

  const [updated] = await prisma.$transaction([
    prisma.vocabularyItem.update({
      where: { id: itemId },
      data: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        dueAt: next.dueAt,
        status: next.status,
        reviewCount: { increment: 1 },
        ...(next.wasCorrect
          ? { successCount: { increment: 1 } }
          : { failureCount: { increment: 1 } }),
        lastReviewedAt: new Date(),
      },
      select: {
        id: true,
        word: true,
        status: true,
        dueAt: true,
        intervalDays: true,
        reviewCount: true,
        successCount: true,
        failureCount: true,
      },
    }),
    prisma.vocabularyReview.create({
      data: {
        userId,
        vocabularyItemId: itemId,
        outcome,
        wasCorrect: next.wasCorrect,
        responseMs: responseMs ?? null,
        intervalDays: next.intervalDays,
      },
    }),
  ]);

  return updated;
}

/** Words due for review right now. */
export async function getDueWords(userId: string, limit: number) {
  return prisma.vocabularyItem.findMany({
    where: { userId, deletedAt: null, dueAt: { lte: new Date() } },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      id: true,
      word: true,
      definition: true,
      partOfSpeech: true,
      exampleSentence: true,
      synonyms: true,
      difficulty: true,
      status: true,
      dueAt: true,
    },
  });
}

/** Suggests new words to learn, avoiding ones already saved. */
export async function suggestWords(
  userId: string,
  topic: string | undefined,
  signal?: AbortSignal,
): Promise<VocabularyEntry[]> {
  const context = await buildVocabularyContext(userId);

  const known = await prisma.vocabularyItem.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { word: true },
  });

  const result = await getAIService().generateStructured({
    task: "vocabulary",
    userId,
    system: buildVocabularySuggestionPrompt(
      context,
      topic,
      known.map((item) => item.word),
    ),
    messages: [
      { role: "user", content: topic ? wrapWord(topic) : "Suggest words for me to learn." },
    ],
    schema: vocabularySuggestionsSchema,
    schemaName: "VocabularySuggestions",
    temperature: 0.8,
    maxOutputTokens: 2000,
    signal,
  });

  // The model can still return a word the learner has, despite the instruction.
  const knownSet = new Set(known.map((item) => item.word));
  return result.data.words.filter((entry) => !knownSet.has(entry.word.toLowerCase()));
}

/** Builds a quiz over words the learner has saved. */
export async function generateQuiz(
  userId: string,
  itemIds: string[] | undefined,
  signal?: AbortSignal,
): Promise<VocabularyQuiz> {
  const items = await prisma.vocabularyItem.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(itemIds && itemIds.length > 0 ? { id: { in: itemIds } } : {}),
    },
    orderBy: itemIds && itemIds.length > 0 ? undefined : { dueAt: "asc" },
    take: 8,
    select: { word: true },
  });

  if (items.length === 0) {
    throw new ValidationError("Save a few words first, then you can quiz yourself on them.");
  }

  const context = await buildVocabularyContext(userId);

  const result = await getAIService().generateStructured({
    task: "vocabulary",
    userId,
    system: buildVocabularyQuizPrompt(
      context,
      items.map((item) => item.word),
    ),
    messages: [{ role: "user", content: "Write the quiz." }],
    schema: vocabularyQuizSchema,
    schemaName: "VocabularyQuiz",
    temperature: 0.6,
    maxOutputTokens: 1800,
    signal,
  });

  return {
    questions: result.data.questions.filter(
      (question) => question.correctIndex < question.options.length,
    ),
  };
}

/** Counters for the dashboard. */
export async function getVocabularyStats(userId: string) {
  const [total, learned, due] = await Promise.all([
    prisma.vocabularyItem.count({ where: { userId, deletedAt: null } }),
    prisma.vocabularyItem.count({
      where: { userId, deletedAt: null, status: { in: ["FAMILIAR", "MASTERED"] } },
    }),
    prisma.vocabularyItem.count({
      where: { userId, deletedAt: null, dueAt: { lte: new Date() } },
    }),
  ]);

  return { total, learned, due };
}
