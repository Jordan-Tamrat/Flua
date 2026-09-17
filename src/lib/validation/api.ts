import { z } from "zod";

import { GRAMMAR_SLUGS } from "@/lib/learning/grammar-taxonomy";

/**
 * Request schemas for the API surface.
 *
 * Every route validates its input against one of these before any service runs,
 * so handlers never see unchecked data. Length caps are as important as type
 * checks here: they bound the prompt sizes that reach the AI providers.
 */

export const cefrLevelSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export const conversationModeSchema = z.enum([
  "CONVERSATION",
  "TEACHER",
  "GRAMMAR",
  "VOCABULARY",
  "WRITING",
  "SPEAKING",
  "DAILY_PRACTICE",
  "ASSESSMENT",
]);
export const correctionStyleSchema = z.enum(["IMMEDIATE", "PER_MESSAGE", "PERIODIC", "MINIMAL"]);
export const learningStyleSchema = z.enum([
  "CONVERSATIONAL",
  "STRUCTURED",
  "VISUAL",
  "PRACTICE_HEAVY",
]);
export const writingKindSchema = z.enum([
  "JOURNAL",
  "EMAIL",
  "ESSAY",
  "STORY",
  "OPINION",
  "MESSAGE",
  "PROFESSIONAL",
]);
export const vocabularyStatusSchema = z.enum(["NEW", "LEARNING", "FAMILIAR", "MASTERED"]);
export const reviewOutcomeSchema = z.enum(["AGAIN", "HARD", "GOOD", "EASY"]);
export const grammarSlugSchema = z.string().refine((value) => GRAMMAR_SLUGS.includes(value), {
  message: "Unknown grammar topic.",
});

/** A single learner turn. Capped so one message can't balloon a prompt. */
export const learnerMessageSchema = z
  .string()
  .trim()
  .min(1, "Type a message first.")
  .max(4000, "That message is too long — try breaking it up.");

/* -------------------------------- Chat ----------------------------------- */

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1),
  message: learnerMessageSchema,
});

export const createConversationSchema = z.object({
  mode: conversationModeSchema.default("CONVERSATION"),
  topic: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  /** Whether the tutor should speak first. */
  generateOpening: z.boolean().default(true),
});

export const listConversationsSchema = z.object({
  mode: conversationModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/* ------------------------------- Analysis -------------------------------- */

export const analyzeRequestSchema = z.object({
  text: z.string().trim().min(1, "There's nothing to analyse.").max(8000),
  source: z.enum(["conversation", "writing", "speaking", "practice"]).default("conversation"),
  conversationId: z.string().optional(),
});

/* -------------------------------- Grammar -------------------------------- */

export const grammarExerciseRequestSchema = z.object({
  category: grammarSlugSchema,
});

export const grammarLessonRequestSchema = z.object({
  category: grammarSlugSchema,
});

export const grammarResultsSchema = z.object({
  category: grammarSlugSchema,
  correct: z.number().int().min(0).max(50),
  total: z.number().int().min(1).max(50),
});

/* ------------------------------ Vocabulary -------------------------------- */

export const vocabularyLookupSchema = z.object({
  word: z.string().trim().min(1, "Enter a word.").max(80),
});

export const vocabularySaveSchema = z.object({
  word: z.string().trim().min(1).max(80),
  definition: z.string().trim().min(1).max(500),
  partOfSpeech: z.string().trim().max(40).optional(),
  exampleSentence: z.string().trim().max(400).optional(),
  synonyms: z.array(z.string().max(60)).max(8).optional(),
  antonyms: z.array(z.string().max(60)).max(8).optional(),
  difficulty: cefrLevelSchema.optional(),
  sourceRef: z.string().max(120).optional(),
});

export const vocabularyUpdateSchema = z.object({
  status: vocabularyStatusSchema.optional(),
  definition: z.string().trim().min(1).max(500).optional(),
  exampleSentence: z.string().trim().max(400).optional(),
});

export const vocabularyReviewSchema = z.object({
  outcome: reviewOutcomeSchema,
  responseMs: z.number().int().min(0).max(600_000).optional(),
});

/**
 * A typed attempt at fixing one of the learner's own sentences.
 *
 * `action: "dismiss"` is for an item that came out of speech-to-text as
 * nonsense and can't be fixed — it retires rather than being graded.
 */
export const errorDrillAttemptSchema = z.union([
  z.object({
    action: z.literal("attempt"),
    answer: z.string().trim().min(1, "Type your answer first.").max(1000),
    responseMs: z.number().int().min(0).max(600_000).optional(),
  }),
  z.object({ action: z.literal("dismiss") }),
]);

export const vocabularyListSchema = z.object({
  status: vocabularyStatusSchema.optional(),
  due: z.enum(["0", "1"]).optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const vocabularySuggestSchema = z.object({
  topic: z.string().trim().max(120).optional(),
});

export const vocabularyQuizSchema = z.object({
  itemIds: z.array(z.string()).max(10).optional(),
});

/* -------------------------------- Writing -------------------------------- */

export const writingSubmitSchema = z.object({
  kind: writingKindSchema.default("JOURNAL"),
  title: z.string().trim().max(120).optional(),
  prompt: z.string().trim().max(500).optional(),
  content: z
    .string()
    .trim()
    .min(20, "Write a little more — at least a couple of sentences.")
    .max(10_000, "That's longer than we can analyse in one go. Try splitting it up."),
});

export const writingPromptSchema = z.object({
  kind: writingKindSchema.default("JOURNAL"),
});

export const writingListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ------------------------------- Speaking -------------------------------- */

export const speakingAnalyzeSchema = z.object({
  transcript: z.string().trim().min(1, "There's nothing to analyse.").max(6000),
  durationSec: z.number().int().min(0).max(3600),
  conversationId: z.string().optional(),
  transcriptionProvider: z.string().max(40).optional(),
});

/* ------------------------------ Assessment ------------------------------- */

export const placementSubmitSchema = z.object({
  answers: z.record(z.string(), z.number().int().min(0).max(3)),
  writingSample: z
    .string()
    .trim()
    .min(40, "Write a few sentences so we can judge your level fairly.")
    .max(3000),
});

/* ------------------------------- Practice -------------------------------- */

export const activityUpdateSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]),
  score: z.number().min(0).max(100).optional(),
});

export const practiceTimeSchema = z.object({
  seconds: z.number().int().min(1).max(7200),
});

/* -------------------------------- Profile -------------------------------- */

export const onboardingSchema = z.object({
  name: z.string().trim().min(1, "Tell us what to call you.").max(80),
  selfAssessedLevel: cefrLevelSchema,
  targetLevel: cefrLevelSchema,
  learningStyle: learningStyleSchema,
  dailyGoalMinutes: z.number().int().min(5).max(180),
  speakingConfidence: z.number().int().min(1).max(5),
  interests: z.array(z.string().trim().max(40)).max(12).default([]),
  preferredTopics: z.array(z.string().trim().max(40)).max(12).default([]),
  nativeLanguage: z.string().trim().max(60).optional(),
  goals: z.array(z.string().trim().min(1).max(120)).min(1, "Pick at least one goal.").max(6),
});

export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetLevel: cefrLevelSchema.optional(),
  dailyGoalMinutes: z.number().int().min(5).max(180).optional(),
  correctionStyle: correctionStyleSchema.optional(),
  conversationDifficulty: z.number().int().min(1).max(5).optional(),
  voiceSpeed: z.number().min(0.5).max(2).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  responseStyle: z.enum(["friendly", "concise", "detailed"]).optional(),
  interests: z.array(z.string().trim().max(40)).max(12).optional(),
  preferredTopics: z.array(z.string().trim().max(40)).max(12).optional(),
  learningStyle: learningStyleSchema.optional(),
  /**
   * Collected at onboarding but never previously editable or used. Knowing it
   * lets the tutor anticipate transfer errors — an Amharic speaker's article
   * mistakes have a different cause from a Spanish speaker's.
   */
  nativeLanguage: z.string().trim().max(60).optional(),
});

/* -------------------------------- Progress ------------------------------- */

export const progressQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});
