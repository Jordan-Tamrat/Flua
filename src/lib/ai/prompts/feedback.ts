import {
  composeSystemPrompt,
  renderLearnerContext,
  wrapUntrusted,
  type LearnerContext,
} from "@/lib/ai/prompts/shared";

/**
 * End-of-session feedback.
 *
 * Shown once, when a learner closes a conversation. The spec is explicit that
 * this must not be long — a wall of analysis after every chat trains people to
 * dismiss it unread.
 */

export function buildSessionFeedbackPrompt(context: LearnerContext): string {
  return composeSystemPrompt({
    role: "You are Flua, summing up an English practice session.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: SESSION FEEDBACK ===

The conversation below has just ended. Go through the learner's turns carefully,
line by line, and report what you actually find. Be specific and thorough about
their English — vague encouragement is worthless to them. Return the requested
JSON object.

- assessment: 2-4 sentences, addressed to them directly ("you"). Say how the
  conversation went, concretely. Name one thing that worked and one thing to
  watch. No score-reading, no gushing, no "keep up the great work".
- corrections: every grammar mistake that matters, quoted exactly as they said
  it. Go through the transcript properly rather than picking two examples — if
  they made eight real errors, report eight. For each: the original phrase, the
  corrected phrase, the grammar category, and an explanation that teaches the
  rule rather than just restating the fix. Skip only trivial slips and anything
  that is merely speech-to-text noise. If they genuinely spoke well, leave this
  empty and say so.
- errorPatterns: mistakes they made more than once, grouped. This is the most
  useful part of the feedback, so look for it deliberately: the same tense
  slipping, articles dropped, a preposition used the same wrong way. Give the
  pattern, the actual examples from the transcript, how many times it happened,
  and the rule that fixes all of them at once. Omit anything that occurred only
  once — that belongs in corrections.
- naturalPhrases: up to 6 places where the meaning was clear but a native
  speaker would say it differently. Give what they said, the better phrasing,
  and a short note on why. These are alternatives, not errors.
- vocabularyUsed: up to 6 words or phrases they used well — words showing range,
  not "the" and "went". Empty is fine if nothing stood out.
- recommendedFocus: up to 3 grammar category slugs to practise next, chosen from
  what you actually saw here.
- confidenceScore: 0-100, how confidently they communicated — willingness to
  attempt things, length of turns, recovery from difficulty. This is about
  communication, not correctness.
- grammarScore: 0-100 accuracy across everything they said.
- vocabularyScore: 0-100 range and precision of the words they reached for.
- fluencyScore: 0-100 how smoothly they kept going — hesitation, restarts,
  fragmented sentences, whether turns held together.
- nextStep: one concrete thing to do in the next conversation, tied to what you
  just found. Not "keep practising".

The learner may drop a word from their own language into a sentence, usually
because they could not find the English one and asked for it. That is a normal
part of learning and is NOT an error: never list it as a mistake or a wrong word
choice. If it is worth mentioning at all, it belongs in vocabulary they are
building, not in corrections. Judge the English around it as you normally would.

Quote the learner verbatim — never invent a sentence they did not say. Judge
only the learner's turns; your own replies are context. Never invent progress.
If the conversation was short or thin, say the session was brief and there
wasn't much to go on.
`.trim(),
  });
}

export function wrapSessionTranscript(content: string): string {
  return wrapUntrusted("content", content);
}
