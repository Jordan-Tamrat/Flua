import type { CefrLevel } from "@/generated/prisma";

/**
 * The grammar taxonomy.
 *
 * Every correction, drill and progress statistic is keyed by one of these
 * slugs, so the AI, the database and the UI all speak the same vocabulary.
 * Adding a category here makes it available everywhere.
 */

export interface GrammarCategory {
  slug: string;
  label: string;
  /** The level at which this is normally taught. */
  level: CefrLevel;
  /** One-line description shown in the UI. */
  summary: string;
  /** A concrete mistake learners make, used to seed drills and explanations. */
  commonMistake: string;
}

export const GRAMMAR_CATEGORIES: readonly GrammarCategory[] = [
  {
    slug: "present-simple",
    label: "Present simple",
    level: "A1",
    summary: "Habits, routines, facts and general truths.",
    commonMistake: "Dropping the -s on he/she/it: “He work here.”",
  },
  {
    slug: "present-continuous",
    label: "Present continuous",
    level: "A1",
    summary: "Actions happening now or around now.",
    commonMistake: "Using it with state verbs: “I am knowing the answer.”",
  },
  {
    slug: "past-simple",
    label: "Past simple",
    level: "A2",
    summary: "Finished actions at a definite time in the past.",
    commonMistake: "Keeping the present form after a past marker: “Yesterday I go to university.”",
  },
  {
    slug: "past-continuous",
    label: "Past continuous",
    level: "A2",
    summary: "An action in progress when something else happened.",
    commonMistake:
      "Using past simple for the background action: “I walked when it started to rain.”",
  },
  {
    slug: "present-perfect",
    label: "Present perfect",
    level: "B1",
    summary: "Past actions with a present result, or experience up to now.",
    commonMistake: "Combining it with a finished time: “I have seen him yesterday.”",
  },
  {
    slug: "future-forms",
    label: "Future forms",
    level: "A2",
    summary: "will, going to, present continuous for arrangements.",
    commonMistake:
      "Using 'will' for planned arrangements: “I will meet my friend at 6, we arranged it.”",
  },
  {
    slug: "articles",
    label: "Articles",
    level: "A2",
    summary: "a, an, the, and the zero article.",
    commonMistake: "Omitting the article: “I went to university by bus and saw doctor.”",
  },
  {
    slug: "prepositions",
    label: "Prepositions",
    level: "A2",
    summary: "in, on, at and other prepositions of time, place and movement.",
    commonMistake: "Wrong preposition of time: “I will see you in Monday.”",
  },
  {
    slug: "modals",
    label: "Modal verbs",
    level: "B1",
    summary: "can, could, should, must, might and their meanings.",
    commonMistake: "Adding 'to' after a modal: “I must to go now.”",
  },
  {
    slug: "conditionals",
    label: "Conditionals",
    level: "B1",
    summary: "Zero, first, second and third conditional patterns.",
    commonMistake: "Using 'will' in the if-clause: “If it will rain, I will stay home.”",
  },
  {
    slug: "passive-voice",
    label: "Passive voice",
    level: "B1",
    summary: "When the action matters more than who did it.",
    commonMistake: "Missing the auxiliary: “The house built in 1990.”",
  },
  {
    slug: "reported-speech",
    label: "Reported speech",
    level: "B2",
    summary: "Reporting what someone said, with the tense shifted back.",
    commonMistake:
      "Not shifting the tense: “He said he is tired.” when reporting a past statement.",
  },
  {
    slug: "comparatives",
    label: "Comparatives and superlatives",
    level: "A2",
    summary: "bigger, the biggest, more interesting, the most interesting.",
    commonMistake: "Doubling the comparative: “This is more easier.”",
  },
  {
    slug: "relative-clauses",
    label: "Relative clauses",
    level: "B1",
    summary: "who, which, that, where — adding information about a noun.",
    commonMistake: "Repeating the subject: “The man who he called me was my uncle.”",
  },
  {
    slug: "subject-verb-agreement",
    label: "Subject-verb agreement",
    level: "A1",
    summary: "Matching the verb to the subject in number.",
    commonMistake: "Mismatching with a plural subject: “My friends is coming.”",
  },
  {
    slug: "countable-uncountable",
    label: "Countable and uncountable nouns",
    level: "A2",
    summary: "much/many, some/any, a lot of, and which nouns take a plural.",
    commonMistake: "Pluralizing an uncountable noun: “I have many informations.”",
  },
  {
    slug: "pronouns",
    label: "Pronouns",
    level: "A1",
    summary: "Subject, object, possessive and reflexive pronouns.",
    commonMistake: "Using a subject pronoun as an object: “She gave the book to I.”",
  },
  {
    slug: "adverbs",
    label: "Adverbs",
    level: "B1",
    summary: "Form, meaning and — especially — position in the sentence.",
    commonMistake: "Splitting verb and object: “I speak well English.”",
  },
  {
    slug: "conjunctions",
    label: "Conjunctions and linking words",
    level: "B1",
    summary: "and, but, because, although, however — joining ideas.",
    commonMistake: "Doubling the connector: “Although it was late, but I stayed.”",
  },
  {
    slug: "word-order",
    label: "Word order",
    level: "A2",
    summary: "Subject-verb-object, questions, and where extras go.",
    commonMistake: "Keeping statement order in a question: “Where you are going?”",
  },
  {
    slug: "vocabulary-choice",
    label: "Word choice",
    level: "B1",
    summary: "Choosing the word a native speaker would actually use.",
    commonMistake: "Confusing similar verbs: “He said me the news.” instead of “told me”.",
  },
  {
    slug: "spelling",
    label: "Spelling",
    level: "A1",
    summary: "Common English spelling patterns and irregularities.",
    commonMistake: "Doubling errors: “stoped” instead of “stopped”.",
  },
  {
    slug: "punctuation",
    label: "Punctuation",
    level: "A2",
    summary: "Commas, apostrophes, and sentence boundaries.",
    commonMistake: "Missing the possessive apostrophe: “my brothers car”.",
  },
] as const;

const CATEGORY_BY_SLUG = new Map(GRAMMAR_CATEGORIES.map((category) => [category.slug, category]));

export function getGrammarCategory(slug: string): GrammarCategory | undefined {
  return CATEGORY_BY_SLUG.get(slug);
}

export function getGrammarLabel(slug: string): string {
  return CATEGORY_BY_SLUG.get(slug)?.label ?? slug;
}

export const GRAMMAR_SLUGS: readonly string[] = GRAMMAR_CATEGORIES.map((category) => category.slug);

export function isGrammarSlug(value: string): boolean {
  return CATEGORY_BY_SLUG.has(value);
}

/** Categories appropriate to a learner's level, for suggesting what to study. */
export function categoriesForLevel(level: CefrLevel): GrammarCategory[] {
  const order: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const maxIndex = order.indexOf(level) + 1; // include one band above
  return GRAMMAR_CATEGORIES.filter((category) => order.indexOf(category.level) <= maxIndex);
}
