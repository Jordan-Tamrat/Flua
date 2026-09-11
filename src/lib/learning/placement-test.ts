/**
 * The placement assessment.
 *
 * Questions are fixed rather than AI-generated, for three reasons: a placement
 * test must be consistent between learners to mean anything, it costs nothing
 * to serve, and it works before any provider is configured. Only the final
 * judgement — reading the free-writing sample — needs a model.
 *
 * The set is ordered easy-to-hard and spans grammar, vocabulary and reading.
 */

export interface PlacementQuestion {
  id: string;
  section: "grammar" | "vocabulary" | "reading";
  /** Roughly the level this question discriminates at. */
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  prompt: string;
  options: string[];
  correctIndex: number;
}

export const PLACEMENT_QUESTIONS: readonly PlacementQuestion[] = [
  {
    id: "g1",
    section: "grammar",
    level: "A1",
    prompt: "She ___ to work by bus every day.",
    options: ["go", "goes", "going", "is go"],
    correctIndex: 1,
  },
  {
    id: "g2",
    section: "grammar",
    level: "A1",
    prompt: "There ___ two books on the table.",
    options: ["is", "am", "are", "be"],
    correctIndex: 2,
  },
  {
    id: "g3",
    section: "grammar",
    level: "A2",
    prompt: "Yesterday I ___ to the market with my sister.",
    options: ["go", "have gone", "went", "am going"],
    correctIndex: 2,
  },
  {
    id: "g4",
    section: "grammar",
    level: "A2",
    prompt: "I'm going to visit my grandmother ___ Saturday.",
    options: ["in", "at", "on", "to"],
    correctIndex: 2,
  },
  {
    id: "g5",
    section: "grammar",
    level: "B1",
    prompt: "I ___ here since 2019.",
    options: ["work", "worked", "am working", "have worked"],
    correctIndex: 3,
  },
  {
    id: "g6",
    section: "grammar",
    level: "B1",
    prompt: "If it rains tomorrow, we ___ the picnic.",
    options: ["cancel", "will cancel", "would cancel", "cancelled"],
    correctIndex: 1,
  },
  {
    id: "g7",
    section: "grammar",
    level: "B1",
    prompt: "The report ___ by the team last week.",
    options: ["wrote", "was written", "has written", "is writing"],
    correctIndex: 1,
  },
  {
    id: "g8",
    section: "grammar",
    level: "B2",
    prompt: "She said she ___ the email the day before.",
    options: ["sends", "sent", "had sent", "was sending"],
    correctIndex: 2,
  },
  {
    id: "g9",
    section: "grammar",
    level: "B2",
    prompt: "If I ___ about the meeting, I would have come.",
    options: ["knew", "have known", "had known", "would know"],
    correctIndex: 2,
  },
  {
    id: "g10",
    section: "grammar",
    level: "C1",
    prompt: "___ had she arrived than the phone rang.",
    options: ["No sooner", "Hardly when", "As soon", "Rather"],
    correctIndex: 0,
  },
  {
    id: "v1",
    section: "vocabulary",
    level: "A1",
    prompt: "The opposite of 'expensive' is ___.",
    options: ["cheap", "hard", "long", "small"],
    correctIndex: 0,
  },
  {
    id: "v2",
    section: "vocabulary",
    level: "A2",
    prompt: "I need to ___ a decision before Friday.",
    options: ["do", "make", "take", "get"],
    correctIndex: 1,
  },
  {
    id: "v3",
    section: "vocabulary",
    level: "B1",
    prompt: "The meeting was ___ because the manager was ill.",
    options: ["called off", "called on", "called up", "called in"],
    correctIndex: 0,
  },
  {
    id: "v4",
    section: "vocabulary",
    level: "B2",
    prompt: "Her argument was ___ — nobody could find a flaw in it.",
    options: ["compelling", "compulsory", "compliant", "complacent"],
    correctIndex: 0,
  },
  {
    id: "v5",
    section: "vocabulary",
    level: "C1",
    prompt: "The new policy was met with ___ scepticism from staff.",
    options: ["widespread", "widened", "wide-eyed", "widening"],
    correctIndex: 0,
  },
  {
    id: "r1",
    section: "reading",
    level: "A2",
    prompt:
      "“The shop opens at 9 a.m. every day except Sunday, when it opens at 11 a.m.” — What time does the shop open on Sunday?",
    options: ["9 a.m.", "11 a.m.", "It is closed", "The text doesn't say"],
    correctIndex: 1,
  },
  {
    id: "r2",
    section: "reading",
    level: "B1",
    prompt:
      "“Although Maria had studied for weeks, she still felt nervous before the exam.” — How did Maria feel?",
    options: [
      "Confident, because she had studied",
      "Nervous, despite having studied",
      "She did not study",
      "She missed the exam",
    ],
    correctIndex: 1,
  },
  {
    id: "r3",
    section: "reading",
    level: "B2",
    prompt:
      "“The proposal, while ambitious, glosses over the practical difficulties of implementation.” — What is the writer's view?",
    options: [
      "The proposal is entirely impractical",
      "The proposal is ambitious but ignores real obstacles",
      "The proposal has already been implemented",
      "The writer fully supports the proposal",
    ],
    correctIndex: 1,
  },
] as const;

/** The free-writing task. Production is the strongest level signal we have. */
export const PLACEMENT_WRITING_PROMPT =
  "Tell us about something you did recently that you enjoyed — where you were, who you were with, and why it stood out. Write 4-6 sentences.";

export const MIN_WRITING_WORDS = 15;

/** Scores the multiple-choice part. Deterministic, no AI needed. */
export function scoreObjectiveSection(answers: Record<string, number>): {
  correct: number;
  total: number;
  percent: number;
  byLevel: Record<string, { correct: number; total: number }>;
} {
  const byLevel: Record<string, { correct: number; total: number }> = {};
  let correct = 0;

  for (const question of PLACEMENT_QUESTIONS) {
    const bucket = (byLevel[question.level] ??= { correct: 0, total: 0 });
    bucket.total += 1;

    if (answers[question.id] === question.correctIndex) {
      correct += 1;
      bucket.correct += 1;
    }
  }

  return {
    correct,
    total: PLACEMENT_QUESTIONS.length,
    percent: Math.round((correct / PLACEMENT_QUESTIONS.length) * 100),
    byLevel,
  };
}
