-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- CreateEnum
CREATE TYPE "CorrectionStyle" AS ENUM ('IMMEDIATE', 'PER_MESSAGE', 'PERIODIC', 'MINIMAL');

-- CreateEnum
CREATE TYPE "LearningStyle" AS ENUM ('CONVERSATIONAL', 'STRUCTURED', 'VISUAL', 'PRACTICE_HEAVY');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('CONVERSATION', 'TEACHER', 'GRAMMAR', 'VOCABULARY', 'WRITING', 'SPEAKING', 'DAILY_PRACTICE', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MistakeSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "VocabularyStatus" AS ENUM ('NEW', 'LEARNING', 'FAMILIAR', 'MASTERED');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "PracticeActivityKind" AS ENUM ('VOCABULARY_DRILL', 'GRAMMAR_DRILL', 'CONVERSATION', 'WRITING', 'SPEAKING', 'REVIEW');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WritingKind" AS ENUM ('JOURNAL', 'EMAIL', 'ESSAY', 'STORY', 'OPINION', 'MESSAGE', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('WEAKNESS', 'STRENGTH', 'PREFERENCE', 'GOAL', 'PERSONAL_FACT', 'RECURRING_ERROR');

-- CreateEnum
CREATE TYPE "AIRequestType" AS ENUM ('CONVERSATION', 'TEACHER', 'GRAMMAR_ANALYSIS', 'GRAMMAR_EXERCISE', 'VOCABULARY', 'WRITING_ANALYSIS', 'SPEAKING_ANALYSIS', 'TRANSCRIPTION', 'LEVEL_ASSESSMENT', 'MEMORY_EXTRACTION', 'SUMMARIZATION', 'SESSION_FEEDBACK');

-- CreateEnum
CREATE TYPE "AIProviderEventKind" AS ENUM ('SUCCESS', 'FAILOVER', 'RATE_LIMIT', 'QUOTA_EXCEEDED', 'AUTH_ERROR', 'TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR', 'PARSE_ERROR', 'ALL_FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "selfAssessedLevel" "CefrLevel" NOT NULL DEFAULT 'A2',
    "targetLevel" "CefrLevel" NOT NULL DEFAULT 'B2',
    "learningStyle" "LearningStyle" NOT NULL DEFAULT 'CONVERSATIONAL',
    "dailyGoalMinutes" INTEGER NOT NULL DEFAULT 20,
    "speakingConfidence" INTEGER NOT NULL DEFAULT 3,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nativeLanguage" TEXT,
    "estimatedLevel" "CefrLevel" NOT NULL DEFAULT 'A2',
    "levelConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "levelScore" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "lastLevelReviewAt" TIMESTAMP(3),
    "correctionStyle" "CorrectionStyle" NOT NULL DEFAULT 'PERIODIC',
    "conversationDifficulty" INTEGER NOT NULL DEFAULT 3,
    "voiceSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "responseStyle" TEXT NOT NULL DEFAULT 'friendly',
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastPracticeDate" TIMESTAMP(3),
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "achievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'CONVERSATION',
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "topic" TEXT,
    "summary" TEXT,
    "summarizedThrough" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "feedback" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER,
    "corrections" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grammar_mistakes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "originalText" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "example" TEXT,
    "severity" "MistakeSeverity" NOT NULL DEFAULT 'MODERATE',
    "source" TEXT NOT NULL DEFAULT 'conversation',
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grammar_mistakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grammar_topic_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "mistakeCount" INTEGER NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousAccuracy" DOUBLE PRECISION,
    "lastPracticedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grammar_topic_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocabulary_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "partOfSpeech" TEXT,
    "exampleSentence" TEXT,
    "translation" TEXT,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "antonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" "CefrLevel" NOT NULL DEFAULT 'B1',
    "status" "VocabularyStatus" NOT NULL DEFAULT 'NEW',
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "firstLearnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),
    "sourceRef" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vocabulary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vocabulary_reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vocabularyItemId" TEXT NOT NULL,
    "outcome" "ReviewOutcome" NOT NULL,
    "wasCorrect" BOOLEAN NOT NULL,
    "responseMs" INTEGER,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocabulary_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "focusCategory" TEXT,
    "targetMinutes" INTEGER NOT NULL DEFAULT 20,
    "actualSeconds" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_activities" (
    "id" TEXT NOT NULL,
    "practiceSessionId" TEXT NOT NULL,
    "kind" "PracticeActivityKind" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetMinutes" INTEGER NOT NULL DEFAULT 5,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "score" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "writing_submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WritingKind" NOT NULL DEFAULT 'JOURNAL',
    "title" TEXT,
    "prompt" TEXT,
    "content" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "analysis" JSONB,
    "overallScore" DOUBLE PRECISION,
    "grammarScore" DOUBLE PRECISION,
    "vocabularyScore" DOUBLE PRECISION,
    "coherenceScore" DOUBLE PRECISION,
    "analyzedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaking_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "transcript" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "wordsPerMinute" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "transcriptionProvider" TEXT,
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speaking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reinforcementCount" INTEGER NOT NULL DEFAULT 1,
    "sourceRef" TEXT,
    "retiredAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "estimatedLevel" "CefrLevel" NOT NULL,
    "levelScore" DOUBLE PRECISION NOT NULL,
    "minutesPracticed" INTEGER NOT NULL DEFAULT 0,
    "conversationsCount" INTEGER NOT NULL DEFAULT 0,
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "vocabularyLearned" INTEGER NOT NULL DEFAULT 0,
    "vocabularyReviewed" INTEGER NOT NULL DEFAULT 0,
    "mistakesMade" INTEGER NOT NULL DEFAULT 0,
    "grammarAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "writingScore" DOUBLE PRECISION,
    "speakingScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestType" "AIRequestType" NOT NULL,
    "capability" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "fallbackTriggered" BOOLEAN NOT NULL DEFAULT false,
    "attemptedProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "kind" "AIProviderEventKind" NOT NULL,
    "message" TEXT NOT NULL,
    "requestType" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_expiresAt_idx" ON "password_reset_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE INDEX "learning_goals_userId_isPrimary_idx" ON "learning_goals"("userId", "isPrimary");

-- CreateIndex
CREATE INDEX "conversations_userId_deletedAt_updatedAt_idx" ON "conversations"("userId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "conversations_userId_mode_idx" ON "conversations"("userId", "mode");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_createdAt_idx" ON "conversation_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_conversationId_sequence_key" ON "conversation_messages"("conversationId", "sequence");

-- CreateIndex
CREATE INDEX "grammar_mistakes_userId_createdAt_idx" ON "grammar_mistakes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "grammar_mistakes_userId_category_createdAt_idx" ON "grammar_mistakes"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "grammar_topic_stats_userId_accuracy_idx" ON "grammar_topic_stats"("userId", "accuracy");

-- CreateIndex
CREATE UNIQUE INDEX "grammar_topic_stats_userId_category_key" ON "grammar_topic_stats"("userId", "category");

-- CreateIndex
CREATE INDEX "vocabulary_items_userId_deletedAt_dueAt_idx" ON "vocabulary_items"("userId", "deletedAt", "dueAt");

-- CreateIndex
CREATE INDEX "vocabulary_items_userId_status_idx" ON "vocabulary_items"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vocabulary_items_userId_word_key" ON "vocabulary_items"("userId", "word");

-- CreateIndex
CREATE INDEX "vocabulary_reviews_userId_createdAt_idx" ON "vocabulary_reviews"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "vocabulary_reviews_vocabularyItemId_createdAt_idx" ON "vocabulary_reviews"("vocabularyItemId", "createdAt");

-- CreateIndex
CREATE INDEX "practice_sessions_userId_createdAt_idx" ON "practice_sessions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_userId_planDate_key" ON "practice_sessions"("userId", "planDate");

-- CreateIndex
CREATE INDEX "practice_activities_practiceSessionId_orderIndex_idx" ON "practice_activities"("practiceSessionId", "orderIndex");

-- CreateIndex
CREATE INDEX "writing_submissions_userId_deletedAt_createdAt_idx" ON "writing_submissions"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "speaking_sessions_userId_createdAt_idx" ON "speaking_sessions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "learner_memories_userId_retiredAt_reinforcementCount_idx" ON "learner_memories"("userId", "retiredAt", "reinforcementCount");

-- CreateIndex
CREATE INDEX "learner_memories_userId_kind_idx" ON "learner_memories"("userId", "kind");

-- CreateIndex
CREATE INDEX "progress_snapshots_userId_date_idx" ON "progress_snapshots"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "progress_snapshots_userId_date_key" ON "progress_snapshots"("userId", "date");

-- CreateIndex
CREATE INDEX "ai_usage_createdAt_idx" ON "ai_usage"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_provider_createdAt_idx" ON "ai_usage"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_userId_createdAt_idx" ON "ai_usage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_provider_events_createdAt_idx" ON "ai_provider_events"("createdAt");

-- CreateIndex
CREATE INDEX "ai_provider_events_provider_kind_createdAt_idx" ON "ai_provider_events"("provider", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grammar_mistakes" ADD CONSTRAINT "grammar_mistakes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grammar_mistakes" ADD CONSTRAINT "grammar_mistakes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grammar_topic_stats" ADD CONSTRAINT "grammar_topic_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_reviews" ADD CONSTRAINT "vocabulary_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vocabulary_reviews" ADD CONSTRAINT "vocabulary_reviews_vocabularyItemId_fkey" FOREIGN KEY ("vocabularyItemId") REFERENCES "vocabulary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_activities" ADD CONSTRAINT "practice_activities_practiceSessionId_fkey" FOREIGN KEY ("practiceSessionId") REFERENCES "practice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_sessions" ADD CONSTRAINT "speaking_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaking_sessions" ADD CONSTRAINT "speaking_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learner_memories" ADD CONSTRAINT "learner_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
