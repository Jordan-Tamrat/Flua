import "server-only";

import type { CefrLevel, CorrectionStyle, LearningStyle } from "@/generated/prisma";
import { prisma } from "@/lib/db/client";
import { NotFoundError } from "@/lib/errors";

/**
 * Learner profile and settings.
 *
 * Note the deliberate separation of `selfAssessedLevel` from `estimatedLevel`:
 * onboarding captures what the learner believes, while the system maintains its
 * own estimate from evidence. The two are never conflated.
 */

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      profile: {
        select: {
          selfAssessedLevel: true,
          targetLevel: true,
          estimatedLevel: true,
          levelScore: true,
          levelConfidence: true,
          learningStyle: true,
          dailyGoalMinutes: true,
          speakingConfidence: true,
          interests: true,
          preferredTopics: true,
          nativeLanguage: true,
          correctionStyle: true,
          conversationDifficulty: true,
          voiceSpeed: true,
          theme: true,
          responseStyle: true,
          currentStreak: true,
          longestStreak: true,
          onboardingCompletedAt: true,
        },
      },
      goals: {
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, description: true, isPrimary: true, achievedAt: true },
      },
    },
  });

  if (!user?.profile) {
    throw new NotFoundError("We couldn't load your profile.");
  }

  return user;
}

export interface OnboardingInput {
  name: string;
  selfAssessedLevel: CefrLevel;
  targetLevel: CefrLevel;
  learningStyle: LearningStyle;
  dailyGoalMinutes: number;
  speakingConfidence: number;
  interests: string[];
  preferredTopics: string[];
  nativeLanguage?: string;
  goals: string[];
}

/**
 * Saves onboarding answers.
 *
 * The initial `estimatedLevel` mirrors the self-assessment but carries low
 * confidence, so the placement test (or ordinary practice) can move it without
 * fighting an over-confident prior.
 */
export async function completeOnboarding(userId: string, input: OnboardingInput) {
  const initialScore = scoreForLevel(input.selfAssessedLevel);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { name: input.name },
    }),
    prisma.profile.update({
      where: { userId },
      data: {
        selfAssessedLevel: input.selfAssessedLevel,
        targetLevel: input.targetLevel,
        estimatedLevel: input.selfAssessedLevel,
        levelScore: initialScore,
        levelConfidence: 0.25,
        learningStyle: input.learningStyle,
        dailyGoalMinutes: input.dailyGoalMinutes,
        speakingConfidence: input.speakingConfidence,
        interests: input.interests,
        preferredTopics: input.preferredTopics,
        nativeLanguage: input.nativeLanguage ?? null,
        onboardingCompletedAt: new Date(),
      },
    }),
    prisma.learningGoal.deleteMany({ where: { userId } }),
    prisma.learningGoal.createMany({
      data: input.goals.map((goal, index) => ({
        userId,
        label: goal,
        isPrimary: index === 0,
      })),
    }),
  ]);

  return getProfile(userId);
}

/** Mid-band score for a CEFR level, matching `levelFromScore`'s bands. */
function scoreForLevel(level: CefrLevel): number {
  const midpoints: Record<CefrLevel, number> = {
    A1: 8,
    A2: 25,
    B1: 42,
    B2: 59,
    C1: 76,
    C2: 92,
  };
  return midpoints[level];
}

export interface SettingsInput {
  name?: string;
  targetLevel?: CefrLevel;
  dailyGoalMinutes?: number;
  correctionStyle?: CorrectionStyle;
  conversationDifficulty?: number;
  voiceSpeed?: number;
  theme?: string;
  responseStyle?: string;
  interests?: string[];
  preferredTopics?: string[];
  learningStyle?: LearningStyle;
}

export async function updateSettings(userId: string, input: SettingsInput) {
  const profileData = {
    ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
    ...(input.dailyGoalMinutes !== undefined ? { dailyGoalMinutes: input.dailyGoalMinutes } : {}),
    ...(input.correctionStyle ? { correctionStyle: input.correctionStyle } : {}),
    ...(input.conversationDifficulty !== undefined
      ? { conversationDifficulty: input.conversationDifficulty }
      : {}),
    ...(input.voiceSpeed !== undefined ? { voiceSpeed: input.voiceSpeed } : {}),
    ...(input.theme ? { theme: input.theme } : {}),
    ...(input.responseStyle ? { responseStyle: input.responseStyle } : {}),
    ...(input.interests ? { interests: input.interests } : {}),
    ...(input.preferredTopics ? { preferredTopics: input.preferredTopics } : {}),
    ...(input.learningStyle ? { learningStyle: input.learningStyle } : {}),
  };

  await prisma.$transaction([
    ...(input.name
      ? [prisma.user.update({ where: { id: userId }, data: { name: input.name } })]
      : []),
    ...(Object.keys(profileData).length > 0
      ? [prisma.profile.update({ where: { userId }, data: profileData })]
      : []),
  ]);

  return getProfile(userId);
}

/** Whether the learner still needs to go through onboarding. */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { onboardingCompletedAt: true },
  });

  return profile?.onboardingCompletedAt === null || profile === null;
}
