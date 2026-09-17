import "server-only";

import type { ActivityStatus, PracticeActivityKind } from "@/generated/prisma";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";
import { getGrammarCategory, getGrammarLabel } from "@/lib/learning/grammar-taxonomy";
import { toUtcDate } from "@/server/services/progress-service";

/**
 * The daily practice plan.
 *
 * Built entirely in application code from the learner's own statistics — no AI
 * call is needed to decide what someone should practise, because the database
 * already knows where they are weakest and what is due for review. Content for
 * each activity is generated lazily, only when the learner actually opens it.
 */

export interface PlannedActivity {
  kind: PracticeActivityKind;
  title: string;
  description: string;
  targetMinutes: number;
}

/**
 * Chooses the day's focus and activities.
 *
 * The split follows the spec's example shape — a little vocabulary, a little
 * grammar, then conversation — but the grammar slot is aimed at whatever the
 * learner is currently getting wrong, and the vocabulary slot only appears when
 * something is actually due.
 */
function planActivities(input: {
  dailyGoalMinutes: number;
  focusCategory: string | null;
  dueWordCount: number;
}): PlannedActivity[] {
  const activities: PlannedActivity[] = [];
  const goal = input.dailyGoalMinutes;

  if (input.dueWordCount > 0) {
    activities.push({
      kind: "VOCABULARY_DRILL",
      title: `Review ${Math.min(input.dueWordCount, 15)} words`,
      description:
        input.dueWordCount > 15
          ? "The words most at risk of slipping away. The rest can wait for tomorrow."
          : "These are due today — this is the moment they stick.",
      targetMinutes: Math.max(3, Math.round(goal * 0.25)),
    });
  }

  if (input.focusCategory) {
    const category = getGrammarCategory(input.focusCategory);
    activities.push({
      kind: "GRAMMAR_DRILL",
      title: `Practise ${getGrammarLabel(input.focusCategory).toLowerCase()}`,
      description: category
        ? `A short lesson and five questions. ${category.commonMistake}`
        : "A short lesson and five questions on this pattern.",
      targetMinutes: Math.max(4, Math.round(goal * 0.25)),
    });
  }

  // Speaking is the highest-value activity, so it gets the largest slice and
  // closes the plan — the pattern practised above gets used out loud.
  activities.push({
    kind: "SPEAKING",
    title: input.focusCategory
      ? `Talk using ${getGrammarLabel(input.focusCategory).toLowerCase()}`
      : "Talk with Flua",
    description: input.focusCategory
      ? "Say today's pattern out loud in a real conversation — that's what makes it automatic."
      : "A few minutes of real conversation, out loud.",
    targetMinutes: Math.max(5, Math.round(goal * 0.5)),
  });

  return activities;
}

/**
 * Returns today's plan, creating it on first request of the day.
 *
 * The unique (userId, planDate) constraint makes this safe against concurrent
 * requests: a race loses on insert and re-reads the winner's row.
 */
export async function getOrCreateTodaysPlan(userId: string) {
  const today = toUtcDate(new Date());

  const existing = await prisma.practiceSession.findUnique({
    where: { userId_planDate: { userId, planDate: today } },
    select: {
      id: true,
      planDate: true,
      focusCategory: true,
      targetMinutes: true,
      actualSeconds: true,
      completedAt: true,
      activities: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          title: true,
          description: true,
          targetMinutes: true,
          orderIndex: true,
          score: true,
          completedAt: true,
        },
      },
    },
  });

  if (existing) return existing;

  const [profile, candidates, dueWordCount] = await Promise.all([
    prisma.profile.findUnique({
      where: { userId },
      select: { dailyGoalMinutes: true },
    }),
    /*
     * Candidates for today's focus, ranked in code. Conversation evidence is an
     * error rate and drill evidence is a percentage; picking the "worst" needs
     * both compared on their own scales rather than sorted by one column.
     */
    prisma.grammarTopicStat.findMany({
      where: {
        userId,
        OR: [{ attempts: { gte: 5 } }, { errorRate: { not: null } }],
      },
      select: { category: true, accuracy: true, attempts: true, errorRate: true },
    }),
    prisma.vocabularyItem.count({
      where: { userId, deletedAt: null, dueAt: { lte: new Date() } },
    }),
  ]);

  const dailyGoalMinutes = profile?.dailyGoalMinutes ?? 20;

  /*
   * Prefer what the learner actually gets wrong when speaking over what they
   * score in drills: conversation is where the language has to work, and a
   * topic can look fine in multiple choice while still failing out loud.
   */
  const worstSpoken = candidates
    .filter((stat) => stat.errorRate !== null && stat.errorRate >= 0.8)
    .sort((a, b) => (b.errorRate ?? 0) - (a.errorRate ?? 0))[0];

  const worstDrilled = candidates
    .filter((stat) => stat.attempts >= 5 && stat.accuracy < 75)
    .sort((a, b) => a.accuracy - b.accuracy)[0];

  const focusCategory = (worstSpoken ?? worstDrilled)?.category ?? null;

  const planned = planActivities({ dailyGoalMinutes, focusCategory, dueWordCount });

  try {
    return await prisma.practiceSession.create({
      data: {
        userId,
        planDate: today,
        focusCategory,
        targetMinutes: dailyGoalMinutes,
        activities: {
          create: planned.map((activity, index) => ({
            kind: activity.kind,
            title: activity.title,
            description: activity.description,
            targetMinutes: activity.targetMinutes,
            orderIndex: index,
          })),
        },
      },
      select: {
        id: true,
        planDate: true,
        focusCategory: true,
        targetMinutes: true,
        actualSeconds: true,
        completedAt: true,
        activities: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            kind: true,
            status: true,
            title: true,
            description: true,
            targetMinutes: true,
            orderIndex: true,
            score: true,
            completedAt: true,
          },
        },
      },
    });
  } catch {
    // Lost a creation race — the other request's plan is the canonical one.
    const winner = await prisma.practiceSession.findUnique({
      where: { userId_planDate: { userId, planDate: today } },
      select: {
        id: true,
        planDate: true,
        focusCategory: true,
        targetMinutes: true,
        actualSeconds: true,
        completedAt: true,
        activities: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            kind: true,
            status: true,
            title: true,
            description: true,
            targetMinutes: true,
            orderIndex: true,
            score: true,
            completedAt: true,
          },
        },
      },
    });

    if (!winner) throw new NotFoundError("We couldn't build today's plan.");
    return winner;
  }
}

async function getOwnedActivity(userId: string, activityId: string) {
  const activity = await prisma.practiceActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      practiceSessionId: true,
      kind: true,
      status: true,
      practiceSession: { select: { userId: true, id: true } },
    },
  });

  if (!activity || activity.practiceSession.userId !== userId) {
    throw new NotFoundError("That practice activity doesn't exist.");
  }

  return activity;
}

export async function updateActivityStatus(
  userId: string,
  activityId: string,
  status: ActivityStatus,
  score?: number,
) {
  const activity = await getOwnedActivity(userId, activityId);

  const updated = await prisma.practiceActivity.update({
    where: { id: activity.id },
    data: {
      status,
      ...(score !== undefined ? { score } : {}),
      ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
    },
    select: { id: true, status: true, score: true, completedAt: true },
  });

  await maybeCompleteSession(activity.practiceSessionId);

  return updated;
}

/** Marks the day complete once nothing is left outstanding. */
async function maybeCompleteSession(sessionId: string): Promise<void> {
  const remaining = await prisma.practiceActivity.count({
    where: { practiceSessionId: sessionId, status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  if (remaining === 0) {
    await prisma.practiceSession.update({
      where: { id: sessionId },
      data: { completedAt: new Date() },
    });
  }
}

/** Adds practice time to today's session. */
/**
 * Credits practice time to today's session.
 *
 * Creates today's plan first if it doesn't exist. Without that, a learner whose
 * first action of the day is a conversation would have `updateMany` match zero
 * rows and lose the time silently.
 */
export async function addPracticeSeconds(userId: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;

  const today = toUtcDate(new Date());

  const updated = await prisma.practiceSession.updateMany({
    where: { userId, planDate: today },
    data: { actualSeconds: { increment: Math.round(seconds) } },
  });

  if (updated.count > 0) return;

  await getOrCreateTodaysPlan(userId);
  await prisma.practiceSession.updateMany({
    where: { userId, planDate: today },
    data: { actualSeconds: { increment: Math.round(seconds) } },
  });
}

export async function saveActivityPayload(
  userId: string,
  activityId: string,
  payload: object,
): Promise<void> {
  const activity = await getOwnedActivity(userId, activityId);

  await prisma.practiceActivity.update({
    where: { id: activity.id },
    data: { payload: payload as never },
  });
}
