import type { ReviewOutcome, VocabularyStatus } from "@/generated/prisma";

/**
 * SM-2 spaced repetition.
 *
 * Implemented in application code rather than asked of an AI model: this is
 * deterministic arithmetic, and spending a free-tier request on it would be
 * both slower and less reliable. The schema stores the full SM-2 state
 * (ease factor, interval, repetition count) so the algorithm can be swapped for
 * FSRS or similar later without a migration.
 */

/** Quality score per outcome, on SM-2's original 0-5 scale. */
const OUTCOME_QUALITY: Record<ReviewOutcome, number> = {
  AGAIN: 1,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
};

const MIN_EASE_FACTOR = 1.3;
const DEFAULT_EASE_FACTOR = 2.5;

export interface ReviewState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface ReviewUpdate extends ReviewState {
  dueAt: Date;
  status: VocabularyStatus;
  wasCorrect: boolean;
}

/**
 * Computes the next review state.
 *
 * A failed review resets the interval but keeps a reduced ease factor, so a
 * word the learner repeatedly forgets comes back more often than one they miss
 * once.
 */
export function scheduleNextReview(
  current: ReviewState,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): ReviewUpdate {
  const quality = OUTCOME_QUALITY[outcome];
  const wasCorrect = quality >= 3;

  // SM-2's ease adjustment. Harder recalls shrink the factor; easy ones grow it.
  const rawEase = current.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const easeFactor = Math.max(MIN_EASE_FACTOR, Number(rawEase.toFixed(2)));

  let repetitions: number;
  let intervalDays: number;

  if (!wasCorrect) {
    // Forgotten: start the ladder again, but review tomorrow rather than today
    // so the learner isn't shown the same failed card repeatedly in one sitting.
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = current.repetitions + 1;
    if (repetitions === 1) {
      intervalDays = 1;
    } else if (repetitions === 2) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(current.intervalDays * easeFactor);
    }
    // A year is far enough out; beyond that the schedule stops being meaningful.
    intervalDays = Math.min(intervalDays, 365);
  }

  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    easeFactor,
    intervalDays,
    repetitions,
    dueAt,
    status: deriveStatus(repetitions, intervalDays),
    wasCorrect,
  };
}

/** Maps SM-2 state onto the learner-facing familiarity label. */
export function deriveStatus(repetitions: number, intervalDays: number): VocabularyStatus {
  if (repetitions === 0) return "LEARNING";
  if (intervalDays >= 60 && repetitions >= 5) return "MASTERED";
  if (intervalDays >= 6 && repetitions >= 2) return "FAMILIAR";
  return "LEARNING";
}

export const INITIAL_REVIEW_STATE: ReviewState = {
  easeFactor: DEFAULT_EASE_FACTOR,
  intervalDays: 0,
  repetitions: 0,
};
