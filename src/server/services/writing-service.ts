import "server-only";

import type { WritingKind } from "@/generated/prisma";
import { getAIService } from "@/lib/ai/ai-service";
import {
  buildWritingAnalysisPrompt,
  buildWritingPromptSuggestionPrompt,
  wrapWriting,
} from "@/lib/ai/prompts/writing";
import { writingAnalysisSchema, type WritingAnalysis } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildWritingContext } from "@/server/services/context-builder";
import { recordCorrections } from "@/server/services/grammar-service";

/**
 * Writing submissions and their analysis.
 *
 * Analysis results are stored on the submission so a learner can reopen old
 * work and see the same feedback, and so the progress engine can read writing
 * scores without re-running any AI.
 */

export function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export async function createSubmission(
  userId: string,
  input: { kind: WritingKind; title?: string; prompt?: string; content: string },
) {
  return prisma.writingSubmission.create({
    data: {
      userId,
      kind: input.kind,
      title: input.title ?? null,
      prompt: input.prompt ?? null,
      content: input.content,
      wordCount: countWords(input.content),
    },
    select: {
      id: true,
      kind: true,
      title: true,
      prompt: true,
      content: true,
      wordCount: true,
      createdAt: true,
    },
  });
}

async function getOwnedSubmission(userId: string, submissionId: string) {
  const submission = await prisma.writingSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      userId: true,
      deletedAt: true,
      kind: true,
      prompt: true,
      content: true,
      analysis: true,
    },
  });

  if (!submission || submission.deletedAt || submission.userId !== userId) {
    throw new NotFoundError("That piece of writing doesn't exist.");
  }

  return submission;
}

/**
 * Analyses a submission and stores the result.
 *
 * Corrections are also written to the shared mistake table so that writing
 * errors feed the same weakness picture as conversation errors — a learner who
 * drops articles in writing should get article practice in their daily plan.
 */
export async function analyzeSubmission(
  userId: string,
  submissionId: string,
  signal?: AbortSignal,
): Promise<WritingAnalysis> {
  const submission = await getOwnedSubmission(userId, submissionId);
  const context = await buildWritingContext(userId);

  const result = await getAIService().generateStructured({
    task: "writing_analysis",
    userId,
    system: buildWritingAnalysisPrompt(context, submission.kind, submission.prompt ?? undefined),
    messages: [{ role: "user", content: wrapWriting(submission.content) }],
    schema: writingAnalysisSchema,
    schemaName: "WritingAnalysis",
    temperature: 0.2,
    maxOutputTokens: 3000,
    signal,
  });

  const analysis = result.data;

  await prisma.writingSubmission.update({
    where: { id: submissionId },
    data: {
      analysis: analysis as unknown as object,
      overallScore: analysis.overallScore,
      grammarScore: analysis.grammarScore,
      vocabularyScore: analysis.vocabularyScore,
      coherenceScore: analysis.coherenceScore,
      analyzedAt: new Date(),
    },
  });

  try {
    await recordCorrections({
      userId,
      corrections: analysis.corrections,
      source: "writing",
    });
  } catch (error) {
    // Feedback is already saved and shown; a stats-write failure must not
    // turn a successful analysis into an error for the learner.
    logger.warn("Failed to record writing corrections", { userId, error: String(error) });
  }

  return analysis;
}

export async function listSubmissions(userId: string, limit: number, offset: number) {
  const where = { userId, deletedAt: null };

  const [items, total] = await Promise.all([
    prisma.writingSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        kind: true,
        title: true,
        wordCount: true,
        overallScore: true,
        analyzedAt: true,
        createdAt: true,
      },
    }),
    prisma.writingSubmission.count({ where }),
  ]);

  return { items, total };
}

export async function getSubmission(userId: string, submissionId: string) {
  const submission = await getOwnedSubmission(userId, submissionId);

  return prisma.writingSubmission.findUnique({
    where: { id: submission.id },
    select: {
      id: true,
      kind: true,
      title: true,
      prompt: true,
      content: true,
      wordCount: true,
      analysis: true,
      overallScore: true,
      grammarScore: true,
      vocabularyScore: true,
      coherenceScore: true,
      analyzedAt: true,
      createdAt: true,
    },
  });
}

export async function deleteSubmission(userId: string, submissionId: string): Promise<void> {
  const submission = await getOwnedSubmission(userId, submissionId);
  await prisma.writingSubmission.update({
    where: { id: submission.id },
    data: { deletedAt: new Date() },
  });
}

/** Suggests something to write about. */
export async function suggestWritingPrompt(
  userId: string,
  kind: WritingKind,
  signal?: AbortSignal,
): Promise<string> {
  const context = await buildWritingContext(userId);

  const result = await getAIService().generateText({
    task: "summarization", // light task: one short sentence
    userId,
    system: buildWritingPromptSuggestionPrompt(context, kind),
    messages: [{ role: "user", content: "Suggest a prompt." }],
    temperature: 0.9,
    maxOutputTokens: 120,
    signal,
  });

  return result.text.trim();
}
