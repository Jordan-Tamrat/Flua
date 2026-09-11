import "server-only";

import type { CefrLevel } from "@/generated/prisma";
import { prisma } from "@/lib/db/client";
import { CEFR_ORDER } from "@/lib/ai/prompts/shared";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";

/**
 * The progress engine.
 *
 * Everything here is computed from the database in application code. The spec
 * is explicit that an AI must never be asked to calculate something the backend
 * already knows — so streaks, accuracy, retention and practice minutes are all
 * plain arithmetic, and only the *qualitative* level re-estimate involves a
 * model.
 */

/** Normalizes a timestamp to UTC midnight, the unit days are counted in. */
export function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/*                                   Streaks                                  */
/* -------------------------------------------------------------------------- */

/**
 * Records that the learner practised today and updates their streak.
 *
 * Idempotent within a day: practising twice doesn't double the streak.
 */
export async function recordPracticeDay(userId: string): Promise<{
  currentStreak: number;
  longestStreak: number;
}> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { currentStreak: true, longestStreak: true, lastPracticeDate: true },
  });

  if (!profile) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const today = toUtcDate(new Date());

  if (profile.lastPracticeDate) {
    const gap = daysBetween(profile.lastPracticeDate, today);
    if (gap === 0) {
      // Already counted today.
      return { currentStreak: profile.currentStreak, longestStreak: profile.longestStreak };
    }
    if (gap > 1) {
      // A missed day breaks the streak; it restarts at one for today.
      const updated = await prisma.profile.update({
        where: { userId },
        data: { currentStreak: 1, lastPracticeDate: today },
        select: { currentStreak: true, longestStreak: true },
      });
      return updated;
    }
  }

  const currentStreak = profile.currentStreak + 1;
  const longestStreak = Math.max(profile.longestStreak, currentStreak);

  await prisma.profile.update({
    where: { userId },
    data: { currentStreak, longestStreak, lastPracticeDate: today },
  });

  return { currentStreak, longestStreak };
}

/* -------------------------------------------------------------------------- */
/*                              Dashboard metrics                             */
/* -------------------------------------------------------------------------- */

export interface TopicTrend {
  category: string;
  label: string;
  accuracy: number;
  attempts: number;
  /** "improving" | "steady" | "needs-practice" — a direction, not a number. */
  trend: "improving" | "steady" | "declining";
  /** Whether there is enough data to say anything at all. */
  hasEnoughData: boolean;
}

export interface DashboardData {
  name: string;
  estimatedLevel: CefrLevel;
  targetLevel: CefrLevel;
  levelScore: number;
  levelConfidence: number;
  /** e.g. "B1 → B1+" — progress inside the band. */
  levelDisplay: string;
  dailyGoalMinutes: number;
  minutesToday: number;
  goalProgressPercent: number;
  currentStreak: number;
  longestStreak: number;
  conversationsCompleted: number;
  vocabularyLearned: number;
  vocabularyDue: number;
  weaknesses: TopicTrend[];
  strengths: TopicTrend[];
  recentMistakes: Array<{
    id: string;
    originalText: string;
    correctedText: string;
    category: string;
    label: string;
    explanation: string;
    createdAt: Date;
  }>;
  recommendedActivity: {
    title: string;
    description: string;
    href: string;
  };
  onboardingCompleted: boolean;
}

/** How far into its band a score sits, rendered as "B1" or "B1+". */
function formatLevelProgress(level: CefrLevel, score: number): string {
  const index = CEFR_ORDER.indexOf(level);
  const bandSize = 100 / CEFR_ORDER.length;
  const bandStart = index * bandSize;
  const positionInBand = (score - bandStart) / bandSize;

  if (positionInBand >= 0.66) return `${level}+`;
  if (positionInBand <= 0.33) return `${level}−`;
  return level;
}

function toTrend(accuracy: number, previous: number | null, attempts: number): TopicTrend["trend"] {
  // Small swings on few attempts are noise, not movement.
  if (previous === null || attempts < 5) return "steady";
  const delta = accuracy - previous;
  if (delta >= 5) return "improving";
  if (delta <= -5) return "declining";
  return "steady";
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const startOfToday = toUtcDate(new Date());
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [
    user,
    todaySessions,
    todayConversations,
    conversationCount,
    vocabStats,
    topicStats,
    recentMistakes,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        profile: {
          select: {
            estimatedLevel: true,
            targetLevel: true,
            levelScore: true,
            levelConfidence: true,
            dailyGoalMinutes: true,
            currentStreak: true,
            longestStreak: true,
            onboardingCompletedAt: true,
          },
        },
      },
    }),
    prisma.practiceSession.findFirst({
      where: { userId, planDate: startOfToday },
      select: { actualSeconds: true },
    }),
    prisma.conversation.aggregate({
      where: { userId, deletedAt: null, startedAt: { gte: startOfToday } },
      _sum: { durationSec: true },
    }),
    prisma.conversation.count({
      where: { userId, deletedAt: null, endedAt: { not: null } },
    }),
    prisma.vocabularyItem.groupBy({
      by: ["status"],
      where: { userId, deletedAt: null },
      _count: true,
    }),
    prisma.grammarTopicStat.findMany({
      where: { userId },
      orderBy: { accuracy: "asc" },
      select: {
        category: true,
        accuracy: true,
        previousAccuracy: true,
        attempts: true,
        mistakeCount: true,
      },
    }),
    prisma.grammarMistake.findMany({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        originalText: true,
        correctedText: true,
        category: true,
        explanation: true,
        createdAt: true,
      },
    }),
  ]);

  const profile = user?.profile;
  const dailyGoalMinutes = profile?.dailyGoalMinutes ?? 20;

  const secondsToday =
    (todaySessions?.actualSeconds ?? 0) + (todayConversations._sum.durationSec ?? 0);
  const minutesToday = Math.round(secondsToday / 60);

  const vocabularyLearned = vocabStats
    .filter((group) => group.status === "FAMILIAR" || group.status === "MASTERED")
    .reduce((total, group) => total + group._count, 0);

  const vocabularyDue = await prisma.vocabularyItem.count({
    where: { userId, deletedAt: null, dueAt: { lte: new Date() } },
  });

  const trends: TopicTrend[] = topicStats.map((stat) => ({
    category: stat.category,
    label: getGrammarLabel(stat.category),
    accuracy: Math.round(stat.accuracy),
    attempts: stat.attempts,
    trend: toTrend(stat.accuracy, stat.previousAccuracy, stat.attempts),
    hasEnoughData: stat.attempts >= 3 || stat.mistakeCount >= 2,
  }));

  const weaknesses = trends
    .filter((trend) => trend.hasEnoughData && trend.accuracy < 70)
    .slice(0, 4);
  const strengths = trends
    .filter((trend) => trend.hasEnoughData && trend.accuracy >= 85)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 3);

  const level = profile?.estimatedLevel ?? "A2";
  const levelScore = profile?.levelScore ?? 30;

  return {
    name: user?.name ?? "there",
    estimatedLevel: level,
    targetLevel: profile?.targetLevel ?? "B2",
    levelScore,
    levelConfidence: profile?.levelConfidence ?? 0.2,
    levelDisplay: formatLevelProgress(level, levelScore),
    dailyGoalMinutes,
    minutesToday,
    goalProgressPercent: Math.min(100, Math.round((minutesToday / dailyGoalMinutes) * 100)),
    currentStreak: profile?.currentStreak ?? 0,
    longestStreak: profile?.longestStreak ?? 0,
    conversationsCompleted: conversationCount,
    vocabularyLearned,
    vocabularyDue,
    weaknesses,
    strengths,
    recentMistakes: recentMistakes.map((mistake) => ({
      ...mistake,
      label: getGrammarLabel(mistake.category),
    })),
    recommendedActivity: recommendActivity({
      weaknesses,
      vocabularyDue,
      minutesToday,
      dailyGoalMinutes,
    }),
    onboardingCompleted: profile?.onboardingCompletedAt !== null,
  };
}

/**
 * Picks what to suggest next.
 *
 * Pure rules, no AI: reviews that are due come first because forgetting is
 * time-sensitive, then the weakest grammar topic, then conversation.
 */
function recommendActivity(input: {
  weaknesses: TopicTrend[];
  vocabularyDue: number;
  minutesToday: number;
  dailyGoalMinutes: number;
}): DashboardData["recommendedActivity"] {
  if (input.vocabularyDue >= 5) {
    return {
      title: `Review ${input.vocabularyDue} words`,
      description: "These are due today — reviewing them now is when it sticks best.",
      href: "/vocabulary?due=1",
    };
  }

  const weakest = input.weaknesses[0];
  if (weakest) {
    return {
      title: `Practise ${weakest.label.toLowerCase()}`,
      description: `This is the area costing you the most right now (${weakest.accuracy}% accurate).`,
      href: `/grammar/${weakest.category}`,
    };
  }

  if (input.minutesToday < input.dailyGoalMinutes) {
    // Speaking is where the most progress happens, so it's the default nudge.
    return {
      title: "Talk with Flua",
      description: "A few minutes of real conversation out loud beats anything else.",
      href: "/speaking",
    };
  }

  return {
    title: "Write something",
    description: "You've hit today's goal. Writing is a good way to consolidate it.",
    href: "/writing",
  };
}

/* -------------------------------------------------------------------------- */
/*                              Progress over time                            */
/* -------------------------------------------------------------------------- */

/**
 * Writes today's snapshot.
 *
 * One row per learner per day, upserted, so the trend chart reads a small
 * indexed table instead of aggregating the full history on every page view.
 */
export async function recordProgressSnapshot(userId: string): Promise<void> {
  const today = toUtcDate(new Date());
  const dayStart = today;
  const dayEnd = new Date(today.getTime() + 86_400_000);

  const [profile, conversations, messages, vocabLearned, vocabReviewed, mistakes, topicStats] =
    await Promise.all([
      prisma.profile.findUnique({
        where: { userId },
        select: { estimatedLevel: true, levelScore: true },
      }),
      prisma.conversation.aggregate({
        where: { userId, deletedAt: null, startedAt: { gte: dayStart, lt: dayEnd } },
        _count: true,
        _sum: { durationSec: true },
      }),
      prisma.conversationMessage.count({
        where: {
          role: "USER",
          createdAt: { gte: dayStart, lt: dayEnd },
          conversation: { userId },
        },
      }),
      prisma.vocabularyItem.count({
        where: { userId, deletedAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.vocabularyReview.count({
        where: { userId, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.grammarMistake.count({
        where: { userId, createdAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.grammarTopicStat.findMany({
        where: { userId },
        select: { accuracy: true, attempts: true },
      }),
    ]);

  if (!profile) return;

  const totalAttempts = topicStats.reduce((sum, stat) => sum + stat.attempts, 0);
  const weightedAccuracy =
    totalAttempts > 0
      ? topicStats.reduce((sum, stat) => sum + stat.accuracy * stat.attempts, 0) / totalAttempts
      : 0;

  const practiceSession = await prisma.practiceSession.findUnique({
    where: { userId_planDate: { userId, planDate: today } },
    select: { actualSeconds: true },
  });

  const minutesPracticed = Math.round(
    ((conversations._sum.durationSec ?? 0) + (practiceSession?.actualSeconds ?? 0)) / 60,
  );

  await prisma.progressSnapshot.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      userId,
      date: today,
      estimatedLevel: profile.estimatedLevel,
      levelScore: profile.levelScore,
      minutesPracticed,
      conversationsCount: conversations._count,
      messagesSent: messages,
      vocabularyLearned: vocabLearned,
      vocabularyReviewed: vocabReviewed,
      mistakesMade: mistakes,
      grammarAccuracy: Math.round(weightedAccuracy),
    },
    update: {
      estimatedLevel: profile.estimatedLevel,
      levelScore: profile.levelScore,
      minutesPracticed,
      conversationsCount: conversations._count,
      messagesSent: messages,
      vocabularyLearned: vocabLearned,
      vocabularyReviewed: vocabReviewed,
      mistakesMade: mistakes,
      grammarAccuracy: Math.round(weightedAccuracy),
    },
  });
}

export interface ProgressOverview {
  snapshots: Array<{
    date: Date;
    levelScore: number;
    minutesPracticed: number;
    grammarAccuracy: number;
    vocabularyReviewed: number;
    mistakesMade: number;
  }>;
  topics: TopicTrend[];
  totals: {
    totalMinutes: number;
    totalConversations: number;
    totalWords: number;
    totalReviews: number;
    /** Share of reviews answered correctly, 0-100. */
    retentionRate: number;
    currentStreak: number;
    longestStreak: number;
  };
  writingScores: Array<{ date: Date; score: number }>;
  speakingScores: Array<{ date: Date; score: number }>;
}

export async function getProgressOverview(userId: string, days: number): Promise<ProgressOverview> {
  const since = new Date(Date.now() - days * 86_400_000);

  const [snapshots, topicStats, conversations, vocabCount, reviews, profile, writing, speaking] =
    await Promise.all([
      prisma.progressSnapshot.findMany({
        where: { userId, date: { gte: toUtcDate(since) } },
        orderBy: { date: "asc" },
        select: {
          date: true,
          levelScore: true,
          minutesPracticed: true,
          grammarAccuracy: true,
          vocabularyReviewed: true,
          mistakesMade: true,
        },
      }),
      prisma.grammarTopicStat.findMany({
        where: { userId },
        orderBy: { accuracy: "asc" },
        select: {
          category: true,
          accuracy: true,
          previousAccuracy: true,
          attempts: true,
          mistakeCount: true,
        },
      }),
      prisma.conversation.aggregate({
        where: { userId, deletedAt: null },
        _count: true,
        _sum: { durationSec: true },
      }),
      prisma.vocabularyItem.count({ where: { userId, deletedAt: null } }),
      prisma.vocabularyReview.groupBy({
        by: ["wasCorrect"],
        where: { userId },
        _count: true,
      }),
      prisma.profile.findUnique({
        where: { userId },
        select: { currentStreak: true, longestStreak: true },
      }),
      prisma.writingSubmission.findMany({
        where: { userId, deletedAt: null, overallScore: { not: null } },
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { createdAt: true, overallScore: true },
      }),
      prisma.speakingSession.findMany({
        where: { userId, confidenceScore: { not: null } },
        orderBy: { createdAt: "asc" },
        take: 30,
        select: { createdAt: true, confidenceScore: true },
      }),
    ]);

  const correctReviews = reviews.find((group) => group.wasCorrect)?._count ?? 0;
  const totalReviews = reviews.reduce((sum, group) => sum + group._count, 0);

  return {
    snapshots,
    topics: topicStats.map((stat) => ({
      category: stat.category,
      label: getGrammarLabel(stat.category),
      accuracy: Math.round(stat.accuracy),
      attempts: stat.attempts,
      trend: toTrend(stat.accuracy, stat.previousAccuracy, stat.attempts),
      hasEnoughData: stat.attempts >= 3 || stat.mistakeCount >= 2,
    })),
    totals: {
      totalMinutes: Math.round((conversations._sum.durationSec ?? 0) / 60),
      totalConversations: conversations._count,
      totalWords: vocabCount,
      totalReviews,
      retentionRate: totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 0,
      currentStreak: profile?.currentStreak ?? 0,
      longestStreak: profile?.longestStreak ?? 0,
    },
    writingScores: writing.map((entry) => ({
      date: entry.createdAt,
      score: entry.overallScore ?? 0,
    })),
    speakingScores: speaking.map((entry) => ({
      date: entry.createdAt,
      score: entry.confidenceScore ?? 0,
    })),
  };
}
