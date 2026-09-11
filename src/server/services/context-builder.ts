import "server-only";

import type { LearnerContext } from "@/lib/ai/prompts/shared";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";

/**
 * Context builders.
 *
 * Each AI task gets the smallest set of learner facts that measurably improves
 * its output — never the whole profile, and never the whole database. Every
 * extra line here is tokens spent on every request against a free tier, so the
 * limits below are deliberate rather than arbitrary.
 */

/** How many weaknesses/strengths/memories each task is allowed. */
const LIMITS = {
  conversation: { weaknesses: 3, strengths: 2, memories: 5, interests: 4 },
  teacher: { weaknesses: 4, strengths: 2, memories: 3, interests: 2 },
  grammar: { weaknesses: 5, strengths: 3, memories: 2, interests: 2 },
  writing: { weaknesses: 4, strengths: 3, memories: 2, interests: 2 },
  vocabulary: { weaknesses: 2, strengths: 0, memories: 3, interests: 4 },
  speaking: { weaknesses: 3, strengths: 2, memories: 3, interests: 3 },
  feedback: { weaknesses: 3, strengths: 2, memories: 2, interests: 2 },
} as const;

type ContextKind = keyof typeof LIMITS;

interface RawLearnerData {
  name: string;
  estimatedLevel: LearnerContext["estimatedLevel"];
  targetLevel: LearnerContext["targetLevel"];
  correctionStyle: LearnerContext["correctionStyle"];
  difficulty: number;
  interests: string[];
  weaknesses: string[];
  strengths: string[];
  memories: string[];
}

/**
 * Loads everything the builders draw on in a single round trip.
 *
 * Weakness and strength ordering comes from `GrammarTopicStat`, which the
 * progress engine keeps current — so no aggregation over the mistake history
 * is needed on the request path.
 */
async function loadLearnerData(userId: string): Promise<RawLearnerData> {
  const [user, topicStats, memories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        profile: {
          select: {
            estimatedLevel: true,
            targetLevel: true,
            correctionStyle: true,
            conversationDifficulty: true,
            interests: true,
            preferredTopics: true,
          },
        },
      },
    }),
    prisma.grammarTopicStat.findMany({
      where: { userId },
      // Enough rows to satisfy the largest limit at either end of the ranking.
      orderBy: { accuracy: "asc" },
      take: 12,
      select: { category: true, accuracy: true, attempts: true, mistakeCount: true },
    }),
    prisma.learnerMemory.findMany({
      where: { userId, retiredAt: null },
      orderBy: [{ reinforcementCount: "desc" }, { updatedAt: "desc" }],
      take: 8,
      select: { content: true },
    }),
  ]);

  if (!user?.profile) {
    throw new NotFoundError("We couldn't load your learner profile.");
  }

  // A topic needs some evidence behind it before it counts as a weakness.
  const meaningful = topicStats.filter((stat) => stat.attempts >= 3 || stat.mistakeCount >= 2);

  const weaknesses = meaningful
    .filter((stat) => stat.accuracy < 70)
    .map((stat) => getGrammarLabel(stat.category));

  const strengths = [...meaningful]
    .filter((stat) => stat.accuracy >= 85)
    .sort((a, b) => b.accuracy - a.accuracy)
    .map((stat) => getGrammarLabel(stat.category));

  const interests = [...new Set([...user.profile.preferredTopics, ...user.profile.interests])];

  return {
    name: user.name,
    estimatedLevel: user.profile.estimatedLevel,
    targetLevel: user.profile.targetLevel,
    correctionStyle: user.profile.correctionStyle,
    difficulty: user.profile.conversationDifficulty,
    interests,
    weaknesses,
    strengths,
    memories: memories.map((memory) => memory.content),
  };
}

function shape(data: RawLearnerData, kind: ContextKind): LearnerContext {
  const limits = LIMITS[kind];
  return {
    name: data.name,
    estimatedLevel: data.estimatedLevel,
    targetLevel: data.targetLevel,
    correctionStyle: data.correctionStyle,
    difficulty: data.difficulty,
    weaknesses: data.weaknesses.slice(0, limits.weaknesses),
    strengths: data.strengths.slice(0, limits.strengths),
    memories: data.memories.slice(0, limits.memories),
    interests: data.interests.slice(0, limits.interests),
  };
}

export async function buildConversationContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "conversation");
}

export async function buildTeacherContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "teacher");
}

export async function buildGrammarContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "grammar");
}

export async function buildWritingContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "writing");
}

export async function buildVocabularyContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "vocabulary");
}

export async function buildSpeakingContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "speaking");
}

export async function buildFeedbackContext(userId: string): Promise<LearnerContext> {
  return shape(await loadLearnerData(userId), "feedback");
}
