import {
  composeSystemPrompt,
  renderLearnerContext,
  wrapUntrusted,
  type LearnerContext,
} from "@/lib/ai/prompts/shared";

/**
 * Writing analysis.
 *
 * The defining constraint: never silently rewrite. A learner who receives a
 * polished paragraph back has learned nothing. Every change must be shown with
 * its reason, and the natural rewrite comes last, as a comparison.
 */

const KIND_GUIDANCE: Record<string, string> = {
  JOURNAL:
    "A personal journal entry. Judge it as informal personal writing — contractions and loose structure are fine.",
  EMAIL: "An email. Register and opening/closing conventions matter as much as grammar.",
  ESSAY: "An essay. Structure, argument and paragraph cohesion matter alongside accuracy.",
  STORY: "A story. Narrative tenses, sequencing and descriptive range matter.",
  OPINION: "An opinion piece. Look at how clearly the position is stated and supported.",
  MESSAGE: "A short message to a person. Tone and naturalness matter more than formal correctness.",
  PROFESSIONAL: "Professional writing. Register, precision and conciseness are the priorities.",
};

export function buildWritingAnalysisPrompt(
  context: LearnerContext,
  kind: string,
  prompt?: string,
): string {
  return composeSystemPrompt({
    role: "You are Flua, giving feedback on a learner's writing.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: ANALYSE WRITING ===

Text type: ${KIND_GUIDANCE[kind] ?? "General writing."}
${prompt ? `They were writing in response to: ${prompt}` : ""}

Return the requested JSON object.

Scores (0-100 each): grammar, vocabulary, coherence, and an overall score.
Judge against what is reasonable for a learner at ${context.estimatedLevel}, not
against a native writer. An ambitious sentence with one error is worth more than
a safe simple one.

corrections — the heart of this. For each real problem:
- 'original': the learner's exact words, quoted verbatim from their text.
- 'corrected': the minimal fix. Change what is wrong and nothing else.
- 'explanation': why, in one or two sentences they can understand. Give the
  reason, not just a label. "'Yesterday' places this in finished past time, so
  the verb needs the past form" teaches; "wrong tense" does not.
- 'example': one more sentence showing the same pattern used correctly.
- 'category' and 'severity' as specified.

Do not correct style you merely dislike. Do not flag American vs British
spelling as an error. Do not correct the same error more than once — if they
made it five times, report it once and say it recurs in the explanation.

strengths: up to 3 specific things that worked, quoting their own words where
you can.
suggestions: up to 3 concrete next steps.

naturalVersion: the whole text rewritten as a fluent native speaker would write
it, keeping the learner's meaning, voice and intent. This comes after the
explanations and never replaces them. Keep the same length and the same
opinions — improve the English, not the content.
`.trim(),
  });
}

export function wrapWriting(content: string): string {
  return wrapUntrusted("learner_writing", content);
}

/** Writing prompts for the composer, generated at the learner's level. */
export function buildWritingPromptSuggestionPrompt(context: LearnerContext, kind: string): string {
  return composeSystemPrompt({
    role: "You are Flua, suggesting something for a learner to write about.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: SUGGEST A WRITING PROMPT ===

Suggest one thing for ${context.name} to write as a ${kind.toLowerCase()}.

- One or two sentences.
- Concrete and answerable — something they have opinions or memories about.
- Connect it to their interests where you can.
- Pitch it so it naturally requires the grammar they're currently working on,
  without saying so.
- Output only the prompt itself. No preamble, no quotes.
`.trim(),
  });
}
