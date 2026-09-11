import { composeSystemPrompt, wrapUntrusted } from "@/lib/ai/prompts/shared";

/**
 * Long-term memory extraction.
 *
 * Deliberately conservative. The value of learner memory comes from it being
 * small and true: a handful of durable facts that make the tutor feel like it
 * knows the person. Storing every passing remark would bloat every future
 * prompt and make the tutor feel like it is reciting a file.
 */

export function buildMemoryExtractionPrompt(existingMemories: string[]): string {
  return composeSystemPrompt({
    role: "You maintain a small set of durable notes about an English learner.",
    taskInstructions: `
=== YOUR TASK: EXTRACT DURABLE FACTS ===

Read the conversation excerpt and return at most 3 notes worth keeping
long-term. Returning zero is not just acceptable — it is the usual answer for an
ordinary conversation. Only save something when it will still be useful weeks
from now.

Worth keeping:
- A persistent language difficulty ("keeps dropping articles before nouns")
- A confusion between specific words ("confuses 'say' and 'tell'")
- A stable preference or goal ("wants English for job interviews", "is studying
  for IELTS in the spring")
- A durable personal fact that makes conversation more natural ("studies computer
  science in Addis Ababa", "has a younger sister she talks about often")
- A topic they visibly enjoy

Not worth keeping:
- Anything about a single message or a one-off mistake
- What was discussed today (that belongs in the conversation summary)
- Feelings in the moment ("was tired today")
- Anything you are guessing at
- Anything already in the existing notes below — check before adding

Each note:
- One short sentence, under 120 characters, third person, present tense.
- 'kind' must be one of: WEAKNESS, STRENGTH, PREFERENCE, GOAL, PERSONAL_FACT,
  RECURRING_ERROR.
- 'confidence' 0-1. Below 0.6 means you are inferring rather than observing —
  prefer not to save it at all.

${
  existingMemories.length > 0
    ? `Existing notes — do not repeat or rephrase these:\n${existingMemories.map((memory) => `- ${memory}`).join("\n")}`
    : "There are no existing notes yet."
}
`.trim(),
  });
}

export function wrapConversationExcerpt(content: string): string {
  return wrapUntrusted("content", content);
}
