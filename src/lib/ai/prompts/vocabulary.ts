import {
  composeSystemPrompt,
  renderLearnerContext,
  wrapUntrusted,
  type LearnerContext,
} from "@/lib/ai/prompts/shared";

/**
 * Vocabulary prompts.
 *
 * These are the cheapest AI calls in the app and route to light models. Note
 * that plain word lookups do not come here at all — the vocabulary service
 * checks the learner's own saved words first, and only asks a model for words
 * it has never seen.
 */

export function buildVocabularyLookupPrompt(context: LearnerContext): string {
  return composeSystemPrompt({
    role: "You are Flua, explaining English words to a learner.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: EXPLAIN A WORD ===

Return the requested JSON object for the word given.

- definition: what it means, in language at or slightly below the learner's
  level. Do not define a word using harder words than the word itself.
- partOfSpeech: noun, verb, adjective, adverb, phrasal verb, idiom, etc.
- exampleSentence: one natural sentence a real person would say, showing the
  word in a context that makes its meaning clear.
- synonyms / antonyms: up to 4 each, only genuinely close ones. An empty list is
  better than a bad match. Many words have no real antonym — leave it empty then.
- difficulty: the CEFR level at which a learner would normally meet this word.

If the word has several distinct meanings, define the most common one and
mention the others in a single clause at the end of the definition.

If the input is not a real English word, give your best reading of what they
meant, and say so in the definition.
`.trim(),
  });
}

export function buildVocabularySuggestionPrompt(
  context: LearnerContext,
  topic: string | undefined,
  knownWords: string[],
): string {
  return composeSystemPrompt({
    role: "You are Flua, choosing vocabulary for a learner to study.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: SUGGEST WORDS ===

Suggest 6 words for ${context.name} to learn${topic ? ` about: ${topic}` : ""}.

- Choose words just above their current level — useful and reachable, not
  obscure. A word they'll actually use beats an impressive one.
- Prefer words connected to their interests and goals.
- Include a mix: not all nouns. Useful verbs, adjectives and common phrasal
  verbs or collocations are often more valuable than single nouns.
- Fill every field, following the same rules as a word lookup.
${
  knownWords.length > 0
    ? `\nThey already know these — do not suggest them:\n${knownWords.slice(0, 60).join(", ")}`
    : ""
}
`.trim(),
  });
}

export function buildVocabularyQuizPrompt(context: LearnerContext, words: string[]): string {
  return composeSystemPrompt({
    role: "You are Flua, writing a vocabulary quiz.",
    learnerContext: renderLearnerContext(context),
    taskInstructions: `
=== YOUR TASK: WRITE A VOCABULARY QUIZ ===

Write one multiple-choice question for each of these words:
${words.join(", ")}

- Test whether the learner can *use* the word, not just recall a dictionary
  gloss. A gap-fill sentence where only the right word fits works well.
- 4 options per question, exactly one correct.
- Distractors should be words that are plausibly confusable — similar meaning,
  similar form, or the same part of speech.
- 'word' must be exactly the word being tested, spelled as given above.
- Keep the surrounding sentence at or below the learner's level.
`.trim(),
  });
}

export function wrapWord(word: string): string {
  return wrapUntrusted("content", word);
}
