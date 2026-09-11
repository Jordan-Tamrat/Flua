import "server-only";

import type { MistakeSeverity } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildGrammarAnalysisPrompt,
  buildGrammarExercisePrompt,
  wrapTextForAnalysis,
} from "@/lib/ai/prompts/grammar";
import { buildLessonPrompt } from "@/lib/ai/prompts/teacher";
import {
  grammarAnalysisSchema,
  grammarExerciseSetSchema,
  lessonSchema,
  type Correction,
  type GrammarAnalysis,
  type GrammarExerciseSet,
  type Lesson,
} from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getGrammarCategory } from "@/lib/learning/grammar-taxonomy";
import { logger } from "@/lib/logger";
import { buildGrammarContext, buildTeacherContext } from "@/server/services/context-builder";

/**
 * Grammar analysis, mistake recording and drill generation.
 *
 * Recorded mistakes are the substrate for the level estimate, the daily plan
 * and the progress page, so this module is careful about what it writes: only
 * corrections the model actually grounded in the learner's own text.
 */

export interface AnalyzeTextParams {
  userId: string;
  text: string;
  /** Where the text came from — kept on each mistake for filtering later. */
  source: "conversation" | "writing" | "speaking" | "practice";
  conversationId?: string;
  signal?: AbortSignal;
}

export async function analyzeGrammar(params: AnalyzeTextParams): Promise<GrammarAnalysis> {
  const context = await buildGrammarContext(params.userId);

  const result = await getAIService().generateStructured({
    task: "grammar_analysis",
    userId: params.userId,
    system: buildGrammarAnalysisPrompt(context),
    messages: [{ role: "user", content: wrapTextForAnalysis(params.text) }],
    schema: grammarAnalysisSchema,
    schemaName: "GrammarAnalysis",
    temperature: 0.1,
    maxOutputTokens: 1600,
  });

  const analysis = result.data;

  // A model occasionally "corrects" a phrase the learner never wrote. Anything
  // not traceable to the source text is dropped rather than stored as fact.
  const grounded = analysis.corrections.filter((correction) =>
    isGroundedInText(correction.original, params.text),
  );

  if (grounded.length !== analysis.corrections.length) {
    logger.warn("Dropped ungrounded corrections", {
      userId: params.userId,
      dropped: analysis.corrections.length - grounded.length,
    });
  }

  await recordCorrections({
    userId: params.userId,
    corrections: grounded,
    source: params.source,
    conversationId: params.conversationId,
  });

  return { ...analysis, corrections: grounded };
}

/**
 * Loose containment check.
 *
 * Normalizes whitespace, case and typographic punctuation before comparing, so
 * a faithful quote still matches while an invented one does not.
 */
function isGroundedInText(quoted: string, source: string): boolean {
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

  const normalizedSource = normalize(source);
  const normalizedQuote = normalize(quoted);

  if (normalizedQuote.length === 0) return false;
  if (normalizedSource.includes(normalizedQuote)) return true;

  // Allow for a trailing period the model added to a mid-sentence quote.
  const withoutTerminal = normalizedQuote.replace(/[.!?]+$/, "");
  return withoutTerminal.length > 0 && normalizedSource.includes(withoutTerminal);
}

interface RecordCorrectionsParams {
  userId: string;
  corrections: Correction[];
  source: string;
  conversationId?: string;
}

/**
 * Persists corrections and updates the per-category rolling stats that the
 * dashboard and daily plan read.
 */
export async function recordCorrections(params: RecordCorrectionsParams): Promise<void> {
  if (params.corrections.length === 0) return;

  await prisma.grammarMistake.createMany({
    data: params.corrections.map((correction) => ({
      userId: params.userId,
      conversationId: params.conversationId ?? null,
      originalText: correction.original,
      correctedText: correction.corrected,
      category: correction.category,
      explanation: correction.explanation,
      example: correction.example ?? null,
      severity: correction.severity as MistakeSeverity,
      source: params.source,
    })),
  });

  const byCategory = new Map<string, number>();
  for (const correction of params.corrections) {
    byCategory.set(correction.category, (byCategory.get(correction.category) ?? 0) + 1);
  }

  for (const [category, mistakes] of byCategory) {
    await bumpTopicStat(params.userId, category, { attempts: mistakes, correct: 0 });
  }
}

/**
 * Updates a category's rolling accuracy.
 *
 * `previousAccuracy` is snapshotted before the change so the UI can show a
 * trend arrow without keeping a full time series per category.
 */
export async function bumpTopicStat(
  userId: string,
  category: string,
  delta: { attempts: number; correct: number },
): Promise<void> {
  const existing = await prisma.grammarTopicStat.findUnique({
    where: { userId_category: { userId, category } },
    select: { attempts: true, correct: true, mistakeCount: true, accuracy: true },
  });

  const attempts = (existing?.attempts ?? 0) + delta.attempts;
  const correct = (existing?.correct ?? 0) + delta.correct;
  const mistakeCount = (existing?.mistakeCount ?? 0) + (delta.attempts - delta.correct);
  const accuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;

  await prisma.grammarTopicStat.upsert({
    where: { userId_category: { userId, category } },
    create: {
      userId,
      category,
      attempts,
      correct,
      mistakeCount,
      accuracy,
      lastPracticedAt: new Date(),
    },
    update: {
      attempts,
      correct,
      mistakeCount,
      accuracy,
      previousAccuracy: existing?.accuracy ?? null,
      lastPracticedAt: new Date(),
    },
  });
}

/** Recent corrections for the dashboard and the grammar page. */
export async function getRecentMistakes(userId: string, limit: number) {
  return prisma.grammarMistake.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      originalText: true,
      correctedText: true,
      category: true,
      explanation: true,
      example: true,
      severity: true,
      source: true,
      createdAt: true,
      acknowledgedAt: true,
    },
  });
}

export async function getTopicStats(userId: string) {
  return prisma.grammarTopicStat.findMany({
    where: { userId },
    orderBy: { accuracy: "asc" },
    select: {
      category: true,
      attempts: true,
      correct: true,
      mistakeCount: true,
      accuracy: true,
      previousAccuracy: true,
      lastPracticedAt: true,
    },
  });
}

/** Generates a drill set for a category. */
export async function generateExercises(
  userId: string,
  categorySlug: string,
  signal?: AbortSignal,
): Promise<GrammarExerciseSet> {
  const category = getGrammarCategory(categorySlug);
  if (!category) {
    throw new ValidationError("That grammar topic doesn't exist.");
  }

  const context = await buildGrammarContext(userId);

  // Avoid repeating questions the learner has already answered recently.
  const recentActivities = await prisma.practiceActivity.findMany({
    where: {
      kind: "GRAMMAR_DRILL",
      practiceSession: { userId },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { payload: true },
  });

  const seenPrompts = recentActivities
    .flatMap((activity) => extractPrompts(activity.payload))
    .slice(0, 10);

  const result = await getAIService().generateStructured({
    task: "grammar_exercise",
    userId,
    system: buildGrammarExercisePrompt(
      context,
      category.slug,
      category.label,
      category.commonMistake,
      seenPrompts,
    ),
    messages: [{ role: "user", content: `Write practice questions for: ${category.label}.` }],
    schema: grammarExerciseSetSchema,
    schemaName: "GrammarExerciseSet",
    temperature: 0.7,
    maxOutputTokens: 1600,
    signal,
  });

  // A model can return a correctIndex outside the options it generated; those
  // questions are unanswerable, so they are discarded rather than shown.
  const questions = result.data.questions.filter(
    (question) => question.correctIndex < question.options.length,
  );

  if (questions.length === 0) {
    throw new ValidationError("We couldn't build a valid exercise. Please try again.");
  }

  return { category: category.slug, questions };
}

function extractPrompts(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const questions = (payload as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question) =>
      typeof question === "object" && question !== null
        ? (question as { prompt?: unknown }).prompt
        : undefined,
    )
    .filter((prompt): prompt is string => typeof prompt === "string");
}

/** Generates a full structured lesson for the grammar library. */
export async function generateLesson(
  userId: string,
  categorySlug: string,
  signal?: AbortSignal,
): Promise<Lesson> {
  const category = getGrammarCategory(categorySlug);
  if (!category) {
    throw new NotFoundError("That grammar topic doesn't exist.");
  }

  const context = await buildTeacherContext(userId);

  const result = await getAIService().generateStructured({
    task: "grammar_analysis",
    userId,
    system: buildLessonPrompt(context, category.label, category.summary),
    messages: [{ role: "user", content: `Write the lesson for: ${category.label}.` }],
    schema: lessonSchema,
    schemaName: "Lesson",
    temperature: 0.5,
    maxOutputTokens: 2000,
    signal,
  });

  return {
    ...result.data,
    exercise: result.data.exercise.filter(
      (question) => question.correctIndex < question.options.length,
    ),
  };
}

/** Records the outcome of a drill, feeding the same stats as live corrections. */
export async function recordDrillResults(
  userId: string,
  categorySlug: string,
  results: { correct: number; total: number },
): Promise<void> {
  if (results.total <= 0) return;

  await bumpTopicStat(userId, categorySlug, {
    attempts: results.total,
    correct: results.correct,
  });
}

export async function acknowledgeMistake(userId: string, mistakeId: string): Promise<void> {
  const mistake = await prisma.grammarMistake.findUnique({
    where: { id: mistakeId },
    select: { userId: true },
  });

  if (!mistake || mistake.userId !== userId) {
    throw new NotFoundError("That correction doesn't exist.");
  }

  await prisma.grammarMistake.update({
    where: { id: mistakeId },
    data: { acknowledgedAt: new Date() },
  });
}
