import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma";

/**
 * Development seed data.
 *
 * Creates one demo learner with enough history that every screen has something
 * real to show — a dashboard with no data looks broken, and it is hard to judge
 * the UI against empty states alone.
 *
 * The demo password is deliberately obvious and documented in the README. It is
 * a development fixture, never a production credential.
 */

const DEMO_EMAIL = "demo@flua.app";
const DEMO_PASSWORD = "demo-password-123";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env before seeding.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Normalizes a date to UTC midnight, matching the app's day boundary. */
function utcDay(offsetDays = 0): Date {
  const now = new Date();
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offsetDays),
  );
  return date;
}

async function main() {
  console.warn("Seeding development data…");

  // Re-running the seed should be safe, so the demo account is cleared first.
  // Cascading deletes take everything owned by the user with it.
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Yordanos",
      passwordHash,
      profile: {
        create: {
          selfAssessedLevel: "A2",
          targetLevel: "B2",
          estimatedLevel: "B1",
          levelScore: 41,
          levelConfidence: 0.55,
          learningStyle: "CONVERSATIONAL",
          dailyGoalMinutes: 20,
          speakingConfidence: 3,
          interests: ["Technology", "Music", "Travel"],
          preferredTopics: ["Technology", "University life"],
          nativeLanguage: "Amharic",
          correctionStyle: "PERIODIC",
          conversationDifficulty: 3,
          currentStreak: 4,
          longestStreak: 9,
          lastPracticeDate: utcDay(0),
          onboardingCompletedAt: new Date(),
        },
      },
      goals: {
        create: [
          { label: "Speak more confidently", isPrimary: true },
          { label: "Prepare for work or interviews" },
        ],
      },
    },
    select: { id: true },
  });

  const userId = user.id;

  /* ----------------------------- Vocabulary ------------------------------ */

  const words = [
    {
      word: "reliable",
      definition: "Able to be trusted to do what you expect or promise.",
      partOfSpeech: "adjective",
      exampleSentence: "She's the most reliable person on the team.",
      synonyms: ["dependable", "trustworthy"],
      antonyms: ["unreliable"],
      difficulty: "B1" as const,
      status: "FAMILIAR" as const,
      repetitions: 3,
      intervalDays: 14,
      reviewCount: 4,
      successCount: 4,
    },
    {
      word: "overwhelmed",
      definition: "Having more to deal with than you can manage.",
      partOfSpeech: "adjective",
      exampleSentence: "I felt overwhelmed by all the coursework.",
      synonyms: ["swamped"],
      antonyms: [],
      difficulty: "B2" as const,
      status: "LEARNING" as const,
      repetitions: 1,
      intervalDays: 1,
      reviewCount: 2,
      successCount: 1,
    },
    {
      word: "come up with",
      definition: "To think of an idea, plan or solution.",
      partOfSpeech: "phrasal verb",
      exampleSentence: "We came up with a better way to organise the files.",
      synonyms: ["devise", "think of"],
      antonyms: [],
      difficulty: "B1" as const,
      status: "LEARNING" as const,
      repetitions: 2,
      intervalDays: 6,
      reviewCount: 3,
      successCount: 2,
    },
    {
      word: "straightforward",
      definition: "Easy to understand or do; not complicated.",
      partOfSpeech: "adjective",
      exampleSentence: "The instructions were straightforward enough.",
      synonyms: ["simple", "clear"],
      antonyms: ["complicated"],
      difficulty: "B2" as const,
      status: "NEW" as const,
      repetitions: 0,
      intervalDays: 0,
      reviewCount: 0,
      successCount: 0,
    },
    {
      word: "get the hang of",
      definition: "To learn how to do something after some practice.",
      partOfSpeech: "idiom",
      exampleSentence: "It took a week, but I got the hang of the new system.",
      synonyms: ["master"],
      antonyms: [],
      difficulty: "B2" as const,
      status: "NEW" as const,
      repetitions: 0,
      intervalDays: 0,
      reviewCount: 0,
      successCount: 0,
    },
    {
      word: "deadline",
      definition: "The time by which something must be finished.",
      partOfSpeech: "noun",
      exampleSentence: "The deadline for the report is Friday.",
      synonyms: ["cut-off"],
      antonyms: [],
      difficulty: "A2" as const,
      status: "MASTERED" as const,
      repetitions: 6,
      intervalDays: 90,
      reviewCount: 7,
      successCount: 7,
    },
  ];

  for (const [index, entry] of words.entries()) {
    await prisma.vocabularyItem.create({
      data: {
        userId,
        word: entry.word,
        definition: entry.definition,
        partOfSpeech: entry.partOfSpeech,
        exampleSentence: entry.exampleSentence,
        synonyms: entry.synonyms,
        antonyms: entry.antonyms,
        difficulty: entry.difficulty,
        status: entry.status,
        repetitions: entry.repetitions,
        intervalDays: entry.intervalDays,
        easeFactor: 2.5,
        reviewCount: entry.reviewCount,
        successCount: entry.successCount,
        failureCount: entry.reviewCount - entry.successCount,
        // Stagger due dates so some words are ready to review right away.
        dueAt: index < 3 ? utcDay(1) : utcDay(-entry.intervalDays),
        firstLearnedAt: utcDay(10 - index),
        lastReviewedAt: entry.reviewCount > 0 ? utcDay(2) : null,
      },
    });
  }

  /* ------------------------------ Grammar -------------------------------- */

  const topicStats = [
    { category: "past-simple", attempts: 22, correct: 13 },
    { category: "articles", attempts: 30, correct: 16 },
    { category: "present-perfect", attempts: 15, correct: 9 },
    { category: "prepositions", attempts: 18, correct: 14 },
    { category: "present-simple", attempts: 25, correct: 23 },
    { category: "comparatives", attempts: 12, correct: 11 },
  ];

  for (const stat of topicStats) {
    const accuracy = Math.round((stat.correct / stat.attempts) * 100);
    await prisma.grammarTopicStat.create({
      data: {
        userId,
        category: stat.category,
        attempts: stat.attempts,
        correct: stat.correct,
        mistakeCount: stat.attempts - stat.correct,
        accuracy,
        // A slightly lower previous value makes the trend arrows meaningful.
        previousAccuracy: Math.max(0, accuracy - 4),
        lastPracticedAt: utcDay(1),
      },
    });
  }

  const conversation = await prisma.conversation.create({
    data: {
      userId,
      mode: "CONVERSATION",
      title: "My week at university",
      topic: "University life",
      startedAt: utcDay(1),
      endedAt: utcDay(1),
      durationSec: 720,
      messageCount: 6,
      messages: {
        create: [
          {
            role: "ASSISTANT",
            sequence: 0,
            content: "You mentioned you're studying — what have you been working on this week?",
          },
          {
            role: "USER",
            sequence: 1,
            content: "Yesterday I go to university and I see my friend. We study together.",
          },
          {
            role: "ASSISTANT",
            sequence: 2,
            content: "Nice — what were you two working on?",
          },
          {
            role: "USER",
            sequence: 3,
            content: "We work on project about database. It was difficult but we finish it.",
          },
          {
            role: "ASSISTANT",
            sequence: 4,
            content:
              "Databases can be tough going. What was the hardest part — the design, or getting it running?",
          },
          {
            role: "USER",
            sequence: 5,
            content: "The design is hard. I have many thing to think about.",
          },
        ],
      },
    },
    select: { id: true },
  });

  const mistakes = [
    {
      originalText: "Yesterday I go to university",
      correctedText: "Yesterday I went to university",
      category: "past-simple",
      explanation:
        "“Yesterday” places this in finished past time, so the verb needs the past form “went”.",
      example: "Last week I went to the library twice.",
      severity: "MODERATE" as const,
    },
    {
      originalText: "I see my friend",
      correctedText: "I saw my friend",
      category: "past-simple",
      explanation:
        "This happened yesterday too, so it takes the past form “saw” rather than “see”.",
      example: "I saw her at the bus stop this morning.",
      severity: "MODERATE" as const,
    },
    {
      originalText: "project about database",
      correctedText: "a project about databases",
      category: "articles",
      explanation:
        "A singular countable noun needs an article — “a project”. “Databases” is plural here because you mean them in general.",
      example: "I'm working on a project about renewable energy.",
      severity: "MODERATE" as const,
    },
    {
      originalText: "I have many thing to think about",
      correctedText: "I have many things to think about",
      category: "countable-uncountable",
      explanation: "“Many” is used with plural countable nouns, so “thing” becomes “things”.",
      example: "There are many things I still want to learn.",
      severity: "MINOR" as const,
    },
  ];

  for (const [index, mistake] of mistakes.entries()) {
    await prisma.grammarMistake.create({
      data: {
        userId,
        conversationId: conversation.id,
        originalText: mistake.originalText,
        correctedText: mistake.correctedText,
        category: mistake.category,
        explanation: mistake.explanation,
        example: mistake.example,
        severity: mistake.severity,
        source: "conversation",
        createdAt: utcDay(index === 0 ? 1 : 2),
      },
    });
  }

  /* ------------------------------ Memories ------------------------------- */

  await prisma.learnerMemory.createMany({
    data: [
      {
        userId,
        kind: "RECURRING_ERROR",
        content: "Often keeps the present form after a past time marker like 'yesterday'.",
        confidence: 0.85,
        reinforcementCount: 3,
      },
      {
        userId,
        kind: "WEAKNESS",
        content: "Frequently drops articles before singular countable nouns.",
        confidence: 0.8,
        reinforcementCount: 4,
      },
      {
        userId,
        kind: "PERSONAL_FACT",
        content: "Studies computer science at university and works on group projects.",
        confidence: 0.9,
        reinforcementCount: 2,
      },
      {
        userId,
        kind: "GOAL",
        content: "Wants to feel confident speaking English in job interviews.",
        confidence: 0.9,
        reinforcementCount: 1,
      },
      {
        userId,
        kind: "PREFERENCE",
        content: "Enjoys talking about technology and music.",
        confidence: 0.75,
        reinforcementCount: 2,
      },
    ],
  });

  /* ------------------------------- Writing ------------------------------- */

  await prisma.writingSubmission.create({
    data: {
      userId,
      kind: "JOURNAL",
      title: "A busy week",
      content:
        "This week was very busy for me. I have many thing to do for university and I don't sleep enough. On Tuesday I go to the library with my friend and we study until late. I think I need to organise my time better.",
      wordCount: 47,
      overallScore: 68,
      grammarScore: 62,
      vocabularyScore: 70,
      coherenceScore: 74,
      analyzedAt: utcDay(3),
      createdAt: utcDay(3),
    },
  });

  /* ------------------------------ Speaking ------------------------------- */

  await prisma.speakingSession.create({
    data: {
      userId,
      transcript:
        "Um, this weekend I go to the market with my sister. We buy some vegetables and, uh, some fruit. After that we cook together at home. It was nice.",
      durationSec: 24,
      wordCount: 30,
      wordsPerMinute: 75,
      confidenceScore: 64,
      createdAt: utcDay(2),
    },
  });

  /* ------------------------------ Progress ------------------------------- */

  // Two weeks of daily snapshots, so the trend charts have something to draw.
  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const practised = daysAgo % 4 !== 0; // a couple of missed days looks realistic
    await prisma.progressSnapshot.create({
      data: {
        userId,
        date: utcDay(daysAgo),
        estimatedLevel: daysAgo > 8 ? "A2" : "B1",
        levelScore: 34 + (13 - daysAgo) * 0.55,
        minutesPracticed: practised ? 12 + ((13 - daysAgo) % 5) * 4 : 0,
        conversationsCount: practised ? 1 : 0,
        messagesSent: practised ? 6 + (daysAgo % 3) : 0,
        vocabularyLearned: practised && daysAgo % 3 === 0 ? 2 : 0,
        vocabularyReviewed: practised ? 4 : 0,
        mistakesMade: practised ? 3 : 0,
        grammarAccuracy: 60 + (13 - daysAgo) * 0.9,
      },
    });
  }

  console.warn(`Seeded demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
