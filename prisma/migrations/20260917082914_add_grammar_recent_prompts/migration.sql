-- AlterTable
ALTER TABLE "grammar_topic_stats" ADD COLUMN     "recentPrompts" TEXT[] DEFAULT ARRAY[]::TEXT[];
