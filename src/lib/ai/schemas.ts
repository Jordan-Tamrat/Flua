import { z } from "zod";

import { GRAMMAR_SLUGS } from "@/lib/learning/grammar-taxonomy";

/**
 * Schemas for every structured AI response.
 *
 * AI output is never trusted: each of these is validated before the data
 * touches the database or the UI. Fields are kept flat and small — deep nested
 * schemas raise the chance a model gets the shape wrong, which costs a retry.
 */

/** Category slugs the model may use. Anything else is coerced to word choice. */
const grammarCategorySchema = z
  .string()
  .transform((value) => value.trim().toLowerCase().replace(/\s+/g, "-"))
  .pipe(
    z.string().refine((value) => GRAMMAR_SLUGS.includes(value), {
      message: "Unknown grammar category.",
    }),
  )
  .catch("vocabulary-choice");

export const severitySchema = z.enum(["MINOR", "MODERATE", "MAJOR"]).catch("MODERATE");

export const cefrSchema = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

/* -------------------------------------------------------------------------- */
/*                              Grammar analysis                              */
/* -------------------------------------------------------------------------- */

export const correctionSchema = z.object({
  original: z.string().min(1).max(1000),
  corrected: z.string().min(1).max(1000),
  category: grammarCategorySchema,
  explanation: z.string().min(1).max(600),
  example: z.string().max(300).optional(),
  severity: severitySchema,
});

export type Correction = z.infer<typeof correctionSchema>;

export const grammarAnalysisSchema = z.object({
  /** 0-100 accuracy for the analysed text. */
  score: z.number().min(0).max(100),
  corrections: z.array(correctionSchema).max(12).default([]),
  strengths: z.array(z.string().max(200)).max(5).default([]),
  recommendations: z.array(z.string().max(200)).max(5).default([]),
});

export type GrammarAnalysis = z.infer<typeof grammarAnalysisSchema>;

/* -------------------------------------------------------------------------- */
/*                              Grammar exercises                             */
/* -------------------------------------------------------------------------- */

export const grammarExerciseQuestionSchema = z.object({
  prompt: z.string().min(1).max(400),
  /** 2-4 answer options. */
  options: z.array(z.string().min(1).max(200)).min(2).max(4),
  /** Index into `options`. */
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(400),
});

export const grammarExerciseSetSchema = z.object({
  category: grammarCategorySchema,
  questions: z.array(grammarExerciseQuestionSchema).min(1).max(8),
});

export type GrammarExerciseQuestion = z.infer<typeof grammarExerciseQuestionSchema>;
export type GrammarExerciseSet = z.infer<typeof grammarExerciseSetSchema>;

/* -------------------------------------------------------------------------- */
/*                                 Vocabulary                                 */
/* -------------------------------------------------------------------------- */

export const vocabularyEntrySchema = z.object({
  word: z.string().min(1).max(80),
  definition: z.string().min(1).max(400),
  partOfSpeech: z.string().max(40).optional(),
  exampleSentence: z.string().max(300).optional(),
  synonyms: z.array(z.string().max(60)).max(6).default([]),
  antonyms: z.array(z.string().max(60)).max(6).default([]),
  difficulty: cefrSchema.catch("B1"),
});

export type VocabularyEntry = z.infer<typeof vocabularyEntrySchema>;

export const vocabularySuggestionsSchema = z.object({
  words: z.array(vocabularyEntrySchema).min(1).max(10),
});

export const vocabularyQuizQuestionSchema = z.object({
  word: z.string().min(1).max(80),
  prompt: z.string().min(1).max(300),
  options: z.array(z.string().min(1).max(200)).min(2).max(4),
  correctIndex: z.number().int().min(0).max(3),
});

export const vocabularyQuizSchema = z.object({
  questions: z.array(vocabularyQuizQuestionSchema).min(1).max(10),
});

export type VocabularyQuizQuestion = z.infer<typeof vocabularyQuizQuestionSchema>;
export type VocabularyQuiz = z.infer<typeof vocabularyQuizSchema>;

/* -------------------------------------------------------------------------- */
/*                              Writing analysis                              */
/* -------------------------------------------------------------------------- */

export const writingAnalysisSchema = z.object({
  overallScore: z.number().min(0).max(100),
  grammarScore: z.number().min(0).max(100),
  vocabularyScore: z.number().min(0).max(100),
  coherenceScore: z.number().min(0).max(100),
  /** A short overall read, two or three sentences. */
  summary: z.string().min(1).max(800),
  corrections: z.array(correctionSchema).max(20).default([]),
  strengths: z.array(z.string().max(240)).max(5).default([]),
  suggestions: z.array(z.string().max(240)).max(5).default([]),
  /** A natural rewrite, offered after the explanations — never instead of them. */
  naturalVersion: z.string().max(4000).optional(),
});

export type WritingAnalysis = z.infer<typeof writingAnalysisSchema>;

/* -------------------------------------------------------------------------- */
/*                              Speaking analysis                             */
/* -------------------------------------------------------------------------- */

export const speakingAnalysisSchema = z.object({
  /** 0-100, derived from fluency signals in the transcript. */
  fluencyScore: z.number().min(0).max(100),
  grammarScore: z.number().min(0).max(100),
  vocabularyScore: z.number().min(0).max(100),
  summary: z.string().min(1).max(600),
  corrections: z.array(correctionSchema).max(10).default([]),
  /** Phrases that would sound more natural. */
  naturalAlternatives: z
    .array(z.object({ said: z.string().max(300), better: z.string().max(300) }))
    .max(6)
    .default([]),
});

export type SpeakingAnalysis = z.infer<typeof speakingAnalysisSchema>;

/* -------------------------------------------------------------------------- */
/*                             Level assessment                               */
/* -------------------------------------------------------------------------- */

export const levelAssessmentSchema = z.object({
  estimatedLevel: cefrSchema,
  /** 0-1 — how sure the model is. */
  confidence: z.number().min(0).max(1),
  /** 0-100 continuous score inside/across bands. */
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1).max(800),
  strengths: z.array(z.string().max(200)).max(5).default([]),
  weaknesses: z.array(grammarCategorySchema).max(6).default([]),
});

export type LevelAssessment = z.infer<typeof levelAssessmentSchema>;

/* -------------------------------------------------------------------------- */
/*                              Session feedback                              */
/* -------------------------------------------------------------------------- */

export const sessionFeedbackSchema = z.object({
  /** Two to four sentences. The spec explicitly asks for brevity here. */
  assessment: z.string().min(1).max(700),
  vocabularyUsed: z.array(z.string().max(80)).max(10).default([]),
  naturalPhrases: z
    .array(z.object({ phrase: z.string().max(200), note: z.string().max(240) }))
    .max(5)
    .default([]),
  corrections: z.array(correctionSchema).max(10).default([]),
  recommendedFocus: z.array(grammarCategorySchema).max(3).default([]),
  /** 0-100 — how confidently the learner communicated. */
  confidenceScore: z.number().min(0).max(100),
});

export type SessionFeedback = z.infer<typeof sessionFeedbackSchema>;

/* -------------------------------------------------------------------------- */
/*                              Memory extraction                             */
/* -------------------------------------------------------------------------- */

export const memoryKindSchema = z.enum([
  "WEAKNESS",
  "STRENGTH",
  "PREFERENCE",
  "GOAL",
  "PERSONAL_FACT",
  "RECURRING_ERROR",
]);

export const extractedMemorySchema = z.object({
  kind: memoryKindSchema,
  /** One short sentence. Long memories defeat the purpose. */
  content: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});

export const memoryExtractionSchema = z.object({
  memories: z.array(extractedMemorySchema).max(5).default([]),
});

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;
export type MemoryExtraction = z.infer<typeof memoryExtractionSchema>;

/* -------------------------------------------------------------------------- */
/*                              Teacher lessons                               */
/* -------------------------------------------------------------------------- */

export const lessonSchema = z.object({
  title: z.string().min(1).max(120),
  /** Plain-language explanation, before any rule. */
  simpleExplanation: z.string().min(1).max(900),
  rule: z.string().min(1).max(700),
  examples: z.array(z.string().max(300)).min(1).max(6),
  commonMistake: z.object({
    wrong: z.string().max(300),
    right: z.string().max(300),
    why: z.string().max(400),
  }),
  exercise: z.array(grammarExerciseQuestionSchema).min(1).max(5),
});

export type Lesson = z.infer<typeof lessonSchema>;
