import {
  composeSystemPrompt,
  renderLearnerContext,
  wrapUntrusted,
  type LearnerContext,
} from "@/lib/ai/prompts/shared";
import { GRAMMAR_CATEGORIES } from "@/lib/learning/grammar-taxonomy";

/**
 * Grammar analysis and drill generation.
 *
 * Analysis prompts are the strictest in the app: the output feeds the mistake
 * table, which in turn drives the daily plan and the level estimate. A model
 * inventing corrections would corrupt the learner's whole progress picture.
 */

const CATEGORY_LIST = GRAMMAR_CATEGORIES.map(
  (category) => `${category.slug} (${category.label})`,
).join(", ");

export function buildGrammarAnalysisPrompt(context: LearnerContext): string {
  return composeSystemPrompt({
    role: "You are Flua, analysing a learner's English for mistakes.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: FIND REAL MISTAKES ===

Analyse the learner's text and return the requested JSON object.

Rules for corrections:
- Only report genuine errors. If the text is correct, return an empty
  corrections array and a high score. Do not manufacture mistakes to seem useful.
- Style preferences are not errors. Only flag something as a mistake if it is
  actually wrong, or so unnatural a native speaker would not say it.
- One entry per distinct mistake. Do not report the same error twice.
- 'original' must be the learner's exact wording of the problem span — a phrase
  or short sentence, quoted verbatim from their text, not a paraphrase.
- 'corrected' must be the minimal fix. Do not rewrite the whole sentence when
  one word is wrong.
- 'category' must be exactly one of these slugs: ${CATEGORY_LIST}
- 'explanation' explains *why* in one or two sentences, in language the learner
  can understand at their level. Say the reason, not just the rule name.
- 'example' is one more sentence showing the correct pattern in a different context.
- 'severity': MINOR if it's still natural and clear, MODERATE if it sounds
  non-native, MAJOR if it changes or obscures the meaning.

Score: 0-100 for overall accuracy of this text. A text with no errors scores
above 90. Do not be harsh about ambition — a learner attempting a complex
sentence and getting one thing wrong is doing better than one writing only
simple correct sentences.

strengths: up to 3 specific things they did well. Be concrete ("used the present
perfect correctly for experience"), never generic ("good effort").
recommendations: up to 3 specific things to work on next.
`.trim(),
  });
}

export function wrapTextForAnalysis(content: string): string {
  return wrapUntrusted("content", content);
}

/**
 * Drill generation.
 *
 * Called only when a fresh set is genuinely needed — the exercise service
 * prefers stored templates first, to keep free-tier usage low.
 */
export function buildGrammarExercisePrompt(
  context: LearnerContext,
  categorySlug: string,
  categoryLabel: string,
  commonMistake: string,
  /** The learner's own recent errors in this category, verbatim. */
  ownErrors: Array<{ original: string; corrected: string }>,
  avoidPrompts: string[],
): string {
  return composeSystemPrompt({
    role: "You are Flua, writing English grammar practice questions.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: WRITE PRACTICE QUESTIONS ===

Write 5 multiple-choice questions on: ${categoryLabel}.
Use the category slug "${categorySlug}" in your response.

${
  ownErrors.length > 0
    ? `Target what THIS learner actually gets wrong. These are real mistakes they
have made, with the correction:
${ownErrors.map((error) => `- "${error.original}" should be "${error.corrected}"`).join("\n")}

Write questions that test the same underlying point in fresh sentences. Do not
quote their own sentences back at them — they are practised separately — and do
not simply reuse these situations.`
    : `The mistake to target: ${commonMistake}`
}

Requirements:
- Each question has 3 or 4 options, exactly one correct.
- Wrong options must be plausible — the mistakes a learner at this level really
  makes. Obviously silly options teach nothing.
- Vary the question format: gap-fill, choose the correct sentence, correct the
  error. Do not write five of the same shape.
- Where a question stem would otherwise be generic ("Which sentence is
  correct?"), make it specific enough to stand on its own, so two different
  questions never read as the same one.
- Sentences should be natural and about ordinary life. Use the learner's
  interests where it fits naturally.
- 'explanation' says why the right answer is right, in one or two sentences.
- Pitch the vocabulary at the learner's level so the grammar is what's being
  tested, not the words.
${
  avoidPrompts.length > 0
    ? `\nThe learner has already been asked the questions below. Write five DIFFERENT
ones: new sentences, new situations, testing other aspects of this topic. Do not
reuse these, and do not reword them slightly and present them as new.\n${avoidPrompts
        .map((prompt) => `- ${prompt}`)
        .join("\n")}`
    : ""
}
`.trim(),
  });
}
