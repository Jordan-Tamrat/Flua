-- AlterTable
ALTER TABLE "grammar_mistakes" ADD COLUMN     "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "intervalDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repetitions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retestCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "streak" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "grammar_mistakes_userId_retiredAt_dueAt_idx" ON "grammar_mistakes"("userId", "retiredAt", "dueAt");
