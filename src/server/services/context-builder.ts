import "server-only";

import type { MemoryKind } from "@/generated/prisma";
import type { LearnerContext, SessionRecall } from "@/lib/ai/prompts/shared";
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

/*
 * How much of each thing a task is allowed.
 *
 * Personal and language memories are budgeted separately on purpose. Ranked
 * together by reinforcement count, grammar diagnostics win: the same error
 * recurs every session and bumps its own score, so over time they crowd out
 * everything that makes a conversation feel personal — and they duplicate the
 * "Currently struggles with" line that is already in the prompt. Conversational
 * modes therefore get mostly personal memories; analytical modes get the
 * language ones, where they are actually the point.
 *
 * `sessions` is recall of past conversations, which is meaningful for talking
 * and pure noise when analysing a piece of writing.
 */
const LIMITS = {
  conversation: {
    weaknesses: 3,
    strengths: 2,
    personalMemories: 6,
    languageMemories: 1,
    sessions: 5,
    interests: 4,
  },
  teacher: {
    weaknesses: 4,
    strengths: 2,
    personalMemories: 2,
    languageMemories: 2,
    sessions: 0,
    interests: 2,
  },
  grammar: {
    weaknesses: 5,
    strengths: 3,
    personalMemories: 0,
    languageMemories: 2,
    sessions: 0,
    interests: 2,
  },
  writing: {
    weaknesses: 4,
    strengths: 3,
    personalMemories: 1,
    languageMemories: 2,
    sessions: 0,
    interests: 2,
  },
  vocabulary: {
    weaknesses: 2,
    strengths: 0,
    personalMemories: 3,
    languageMemories: 0,
    sessions: 0,
    interests: 4,
  },
  speaking: {
    weaknesses: 3,
    strengths: 2,
    personalMemories: 5,
    languageMemories: 1,
    sessions: 5,
    interests: 3,
  },
  feedback: {
    weaknesses: 3,
    strengths: 2,
    personalMemories: 1,
    languageMemories: 2,
    sessions: 0,
    interests: 2,
  },
} as const;

type ContextKind = keyof typeof LIMITS;

/** Memory kinds that describe the learner's English rather than the learner. */
const LANGUAGE_KINDS: ReadonlySet<MemoryKind> = new Set<MemoryKind>([
  "WEAKNESS",
  "RECURRING_ERROR",
]);

interface RawLearnerData {
  name: string;
  estimatedLevel: LearnerContext["estimatedLevel"];
  targetLevel: LearnerContext["targetLevel"];
  correctionStyle: LearnerContext["correctionStyle"];
  difficulty: number;
  interests: string[];
  weaknesses: string[];
  strengths: string[];
  personalMemories: string[];
  languageMemories: string[];
  recentSessions: SessionRecall[];
}

/**
 * Loads everything the builders draw on in a single round trip.
 *
 * Weakness and strength ordering comes from `GrammarTopicStat`, which the
 * progress engine keeps current — so no aggregation over the mistake history
 * is needed on the request path.
 */
async function loadLearnerData(userId: string): Promise<RawLearnerData> {
  const [user, topicStats, memories, sessions] = await Promise.all([
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
      // Ranked in code: a weakness can come from either evidence source, and
      // neither column orders the other correctly on its own.
      take: 24,
      select: {
        category: true,
        accuracy: true,
        attempts: true,
        mistakeCount: true,
        errorRate: true,
        recentErrors: true,
        recentExposure: true,
      },
    }),
    prisma.learnerMemory.findMany({
      where: { userId, retiredAt: null },
      orderBy: [{ reinforcementCount: "desc" }, { updatedAt: "desc" }],
      // Enough to fill both buckets: ranked together, language memories
      // otherwise occupy the whole window before a personal one is reached.
      take: 16,
      select: { content: true, kind: true },
    }),
    // What was actually talked about, most recent first — reversed below so the
    // prompt reads oldest to newest. Covered by @@index([userId, mode]).
    prisma.conversation.findMany({
      where: {
        userId,
        deletedAt: null,
        mode: "SPEAKING",
        summary: { not: null },
        endedAt: { not: null },
      },
      orderBy: { endedAt: "desc" },
      take: 5,
      select: { summary: true, endedAt: true },
    }),
  ]);

  if (!user?.profile) {
    throw new NotFoundError("We couldn't load your learner profile.");
  }

  /*
   * Two independent kinds of evidence, ranked separately and then merged.
   *
   * Conversation gives an error *rate* per hundred words — it has a denominator
   * but no notion of a right answer. Drills give a *percentage* — a real score,
   * but only over questions the learner chose to answer. Averaging them would
   * be meaningless, so each is thresholded on its own terms and the worst of
   * both lists is what reaches the prompt.
   */
  const ratedWeak = topicStats
    .filter((stat) => stat.errorRate !== null && stat.errorRate >= 0.8)
    .sort((a, b) => (b.errorRate ?? 0) - (a.errorRate ?? 0));

  const drilledWeak = topicStats
    .filter((stat) => stat.attempts >= 5 && stat.accuracy < 70)
    .sort((a, b) => a.accuracy - b.accuracy);

  const weaknesses = [
    ...new Set([...ratedWeak, ...drilledWeak].map((stat) => getGrammarLabel(stat.category))),
  ];

  /*
   * A strength has to be earned. Requiring zero errors — not merely few — keeps
   * out the case where one slip across thousands of words produces a tiny rate
   * that looks like mastery; a single observed failure is not evidence of
   * getting something right, just of rarely being wrong about it.
   */
  const strengths = [
    ...new Set(
      [
        ...topicStats.filter(
          (stat) =>
            stat.recentExposure >= 400 && stat.errorRate !== null && stat.recentErrors === 0,
        ),
        ...topicStats
          .filter((stat) => stat.attempts >= 5 && stat.accuracy >= 85)
          .sort((a, b) => b.accuracy - a.accuracy),
      ].map((stat) => getGrammarLabel(stat.category)),
    ),
  ];

  const interests = [...new Set([...user.profile.preferredTopics, ...user.profile.interests])];

  const now = Date.now();
  const recentSessions: SessionRecall[] = sessions
    .filter((session) => session.summary !== null && session.endedAt !== null)
    // Oldest first, so the most recent session is the last thing the model reads.
    .reverse()
    .map((session) => ({
      summary: session.summary as string,
      daysAgo: Math.max(
        0,
        Math.floor((now - (session.endedAt as Date).getTime()) / (1000 * 60 * 60 * 24)),
      ),
    }));

  return {
    name: user.name,
    estimatedLevel: user.profile.estimatedLevel,
    targetLevel: user.profile.targetLevel,
    correctionStyle: user.profile.correctionStyle,
    difficulty: user.profile.conversationDifficulty,
    interests,
    weaknesses,
    strengths,
    personalMemories: memories
      .filter((memory) => !LANGUAGE_KINDS.has(memory.kind))
      .map((memory) => memory.content),
    languageMemories: memories
      .filter((memory) => LANGUAGE_KINDS.has(memory.kind))
      .map((memory) => memory.content),
    recentSessions,
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
    personalMemories: data.personalMemories.slice(0, limits.personalMemories),
    languageMemories: data.languageMemories.slice(0, limits.languageMemories),
    interests: data.interests.slice(0, limits.interests),
    // Kept oldest-first; taking from the end keeps the most recent sessions.
    recentSessions: limits.sessions > 0 ? data.recentSessions.slice(-limits.sessions) : undefined,
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
