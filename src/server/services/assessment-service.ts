import "server-only";

import type { CefrLevel } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildLevelAssessmentPrompt,
  buildLevelReassessmentPrompt,
  wrapAssessmentAnswers,
} from "@/lib/ai/prompts/level-assessment";
import { levelAssessmentSchema, type LevelAssessment } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { PLACEMENT_QUESTIONS, scoreObjectiveSection } from "@/lib/learning/placement-test";
import { buildGrammarContext } from "@/server/services/context-builder";
import { bumpTopicStat } from "@/server/services/grammar-service";

/**
 * Level assessment.
 *
 * The multiple-choice half is scored in code; only the free-writing sample goes
 * to a model. The result is explicitly an estimate — `levelConfidence` is stored
 * alongside it and shown in the UI, because a confident wrong level would
 * mis-pitch every lesson that follows.
 */

/** How much the estimate is allowed to move in one re-assessment. */
const MAX_SCORE_SHIFT = 12;

export interface PlacementSubmission {
  userId: string;
  answers: Record<string, number>;
  writingSample: string;
  signal?: AbortSignal;
}

export async function runPlacementAssessment(
  submission: PlacementSubmission,
): Promise<LevelAssessment> {
  const objective = scoreObjectiveSection(submission.answers);

  const profile = await prisma.profile.findUnique({
    where: { userId: submission.userId },
    select: { selfAssessedLevel: true },
  });

  const answerReport = PLACEMENT_QUESTIONS.map((question) => {
    const given = submission.answers[question.id];
    const chosen = given !== undefined ? question.options[given] : "(no answer)";
    const isCorrect = given === question.correctIndex;
    return `[${question.level}/${question.section}] "${question.prompt}" → chose: ${chosen} ${
      isCorrect ? "(correct)" : `(wrong; correct: ${question.options[question.correctIndex]})`
    }`;
  }).join("\n");

  const payload = [
    `Multiple choice: ${objective.correct}/${objective.total} correct (${objective.percent}%).`,
    "",
    "Answers:",
    answerReport,
    "",
    "Free writing sample:",
    submission.writingSample,
  ].join("\n");

  const result = await getAIService().generateStructured({
    task: "level_assessment",
    userId: submission.userId,
    system: buildLevelAssessmentPrompt(profile?.selfAssessedLevel ?? "A2"),
    messages: [{ role: "user", content: wrapAssessmentAnswers(payload) }],
    schema: levelAssessmentSchema,
    schemaName: "LevelAssessment",
    temperature: 0.2,
    maxOutputTokens: 1200,
    signal: submission.signal,
  });

  const assessment = result.data;

  await prisma.profile.update({
    where: { userId: submission.userId },
    data: {
      estimatedLevel: assessment.estimatedLevel,
      levelScore: assessment.score,
      levelConfidence: assessment.confidence,
      lastLevelReviewAt: new Date(),
    },
  });

  // Seed the weakness picture so the very first daily plan is already targeted
  // rather than generic.
  for (const weakness of assessment.weaknesses) {
    await bumpTopicStat(submission.userId, weakness, { attempts: 2, correct: 0 });
  }

  logger.info("Placement assessment completed", {
    userId: submission.userId,
    level: assessment.estimatedLevel,
  });

  return assessment;
}

/**
 * Re-estimates the level from recent work.
 *
 * Deliberately damped: a single good or bad day should not move a learner's
 * level, so the score is clamped to a maximum shift and the band only changes
 * when the new score genuinely crosses a boundary.
 */
export async function reassessLevel(
  userId: string,
  signal?: AbortSignal,
): Promise<LevelAssessment | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { estimatedLevel: true, levelScore: true, levelConfidence: true },
  });

  if (!profile) throw new NotFoundError("We couldn't load your profile.");

  const [recentMessages, recentWriting, recentMistakes] = await Promise.all([
    prisma.conversationMessage.findMany({
      where: { role: "USER", conversation: { userId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { content: true },
    }),
    prisma.writingSubmission.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true },
    }),
    prisma.grammarMistake.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { originalText: true, correctedText: true, category: true },
    }),
  ]);

  // Without enough recent production there is nothing to judge, and asking a
  // model anyway would just spend quota to produce noise.
  if (recentMessages.length < 5 && recentWriting.length === 0) {
    return null;
  }

  const context = await buildGrammarContext(userId);

  const payload = [
    "Recent things the learner wrote or said:",
    ...recentMessages.slice(0, 15).map((message) => `- ${message.content.slice(0, 300)}`),
    "",
    ...(recentWriting.length > 0
      ? ["Recent writing:", ...recentWriting.map((entry) => entry.content.slice(0, 800))]
      : []),
    "",
    "Recent recorded mistakes:",
    ...recentMistakes.map(
      (mistake) => `- [${mistake.category}] "${mistake.originalText}" → "${mistake.correctedText}"`,
    ),
  ].join("\n");

  const result = await getAIService().generateStructured({
    task: "level_assessment",
    userId,
    system: buildLevelReassessmentPrompt(context),
    messages: [{ role: "user", content: wrapAssessmentAnswers(payload) }],
    schema: levelAssessmentSchema,
    schemaName: "LevelAssessment",
    temperature: 0.2,
    maxOutputTokens: 1000,
    signal,
  });

  const assessment = result.data;

  const clampedScore = clampShift(profile.levelScore, assessment.score, MAX_SCORE_SHIFT);
  const level = levelFromScore(clampedScore);

  await prisma.profile.update({
    where: { userId },
    data: {
      estimatedLevel: level,
      levelScore: clampedScore,
      // Confidence rises slowly as evidence accumulates, and is capped: an
      // informal estimate should never present itself as certain.
      levelConfidence: Math.min(0.85, (profile.levelConfidence + assessment.confidence) / 2 + 0.05),
      lastLevelReviewAt: new Date(),
    },
  });

  return { ...assessment, estimatedLevel: level, score: clampedScore };
}

function clampShift(current: number, proposed: number, maxShift: number): number {
  const delta = proposed - current;
  const bounded = Math.max(-maxShift, Math.min(maxShift, delta));
  return Math.max(0, Math.min(100, current + bounded));
}

/** Maps a 0-100 score onto a CEFR band using equal-width bands. */
export function levelFromScore(score: number): CefrLevel {
  if (score < 17) return "A1";
  if (score < 34) return "A2";
  if (score < 51) return "B1";
  if (score < 68) return "B2";
  if (score < 85) return "C1";
  return "C2";
}

/**
 * Nudges the level score after routine practice.
 *
 * This is the cheap, continuous half of level tracking — no AI involved. Strong
 * accuracy pushes the score up slightly, poor accuracy down, with the step kept
 * small so the level reflects a trend rather than a session.
 */
export async function nudgeLevelScore(userId: string, accuracyPercent: number): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { levelScore: true },
  });

  if (!profile) return;

  // Centre on 75%: doing better than that means the work is a bit easy.
  const delta = (accuracyPercent - 75) / 100;
  const newScore = Math.max(0, Math.min(100, profile.levelScore + delta));

  await prisma.profile.update({
    where: { userId },
    data: { levelScore: newScore, estimatedLevel: levelFromScore(newScore) },
  });
}
