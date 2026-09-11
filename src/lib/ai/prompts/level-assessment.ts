import {
  composeSystemPrompt,
  renderLearnerContext,
  wrapUntrusted,
  type LearnerContext,
} from "@/lib/ai/prompts/shared";

/**
 * Placement assessment and ongoing level re-estimation.
 *
 * The honesty constraint is load-bearing here: Flua's level is an informal
 * estimate from limited evidence, and both the prompt and the UI say so. A
 * confident-sounding wrong level would misjudge every lesson that follows.
 */

export function buildLevelAssessmentPrompt(selfAssessed: string): string {
  return composeSystemPrompt({
    role: "You estimate an English learner's CEFR level from their answers.",
    taskInstructions: `
=== YOUR TASK: ESTIMATE A LEVEL ===

Below are a learner's answers to a short placement assessment: multiple-choice
grammar and vocabulary questions, plus a short piece of free writing.

Estimate their CEFR level (A1-C2) and return the requested JSON object.

How to weigh the evidence:
- The free writing is the strongest signal. What someone can produce says more
  than what they can recognize. Look at range of structures, control of tense,
  word choice, and whether complex sentences hold together.
- Multiple-choice results show recognition, which usually runs one band ahead of
  production. Do not let a good score alone push the level up.
- A learner attempting complex language and getting some of it wrong is usually
  at a higher level than one writing only short correct sentences.

They rated themselves ${selfAssessed}. Treat that as weak evidence — learners
routinely under- and over-estimate. If your reading of the writing disagrees
with it, trust the writing.

Fields:
- estimatedLevel: your best single band.
- confidence: 0-1. Be honest. A short assessment cannot support high confidence.
  Around 0.5-0.7 is right for a normal placement test; go above 0.8 only when
  the evidence is unusually clear and consistent.
- score: 0-100 across the whole A1-C2 range, so progress shows between bands.
  Roughly: A1 0-16, A2 17-33, B1 34-50, B2 51-67, C1 68-84, C2 85-100. Place
  them within their band based on how solidly they sit in it.
- reasoning: 2-4 sentences citing what you actually saw in their answers.
- strengths: up to 3 specific things they can do.
- weaknesses: up to 4 grammar category slugs to work on.

This is an informal estimate to pitch lessons, not an official certification.
Do not describe it as one.
`.trim(),
  });
}

export function buildLevelReassessmentPrompt(context: LearnerContext): string {
  return composeSystemPrompt({
    role: "You re-estimate an English learner's level from recent performance.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: RE-ESTIMATE THE LEVEL ===

Below is a sample of the learner's recent work: things they wrote or said, and
the mistakes recorded for them.

Their level is currently recorded as ${context.estimatedLevel}. Decide whether
that still fits.

- Move the level only when the evidence clearly supports it. Day-to-day
  variation is normal and is not progress or regression.
- Weight recent work more heavily than older work.
- More text and more varied situations mean higher confidence. A handful of
  short messages does not justify a confident judgement.
- Never inflate a level to be encouraging. A learner placed too high gets
  lessons they cannot follow.

Return the requested JSON object, following the same scoring scale as the
placement assessment.
`.trim(),
  });
}

export function wrapAssessmentAnswers(content: string): string {
  return wrapUntrusted("content", content);
}
