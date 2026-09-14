import "server-only";

import { prisma } from "@/lib/db/client";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { appendMessage, createConversation } from "@/server/services/conversation-service";
import { generateSessionFeedback } from "@/server/services/feedback-service";
import {
  extractMemoriesFromConversation,
  generateSessionRecap,
} from "@/server/services/memory-service";
import { addPracticeSeconds } from "@/server/services/practice-service";
import { recordPracticeDay, recordProgressSnapshot } from "@/server/services/progress-service";
import type { SessionFeedback } from "@/lib/ai/schemas";

/**
 * Persists a finished live voice conversation.
 *
 * The conversation happens entirely between the browser and the provider, so
 * the server never sees it until this point. Saving the transcript here is what
 * lets voice practice feed the same loop as text: corrections recorded, level
 * re-estimated, tomorrow's plan adapted.
 *
 * Only the transcript is stored. Audio is never persisted.
 */

export interface VoiceTurnInput {
  role: "USER" | "ASSISTANT";
  text: string;
}

export interface SaveVoiceSessionParams {
  userId: string;
  turns: VoiceTurnInput[];
  durationSec: number;
  scenarioId?: string;
  scenarioLabel?: string;
}

export interface SaveVoiceSessionResult {
  conversationId: string;
  feedback: SessionFeedback | null;
  /** Present when feedback couldn't be produced, explaining why. */
  feedbackUnavailableReason?: string;
}

/** Below this there isn't enough material to say anything useful. */
const MIN_LEARNER_TURNS = 2;

export async function saveVoiceSession(
  params: SaveVoiceSessionParams,
): Promise<SaveVoiceSessionResult> {
  const turns = params.turns
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }))
    .filter((turn) => turn.text.length > 0);

  if (turns.length === 0) {
    throw new ValidationError("That conversation was empty, so there's nothing to save.");
  }

  const learnerTurns = turns.filter((turn) => turn.role === "USER");

  const conversation = await createConversation(params.userId, {
    mode: "SPEAKING",
    topic: params.scenarioLabel,
    title: params.scenarioLabel ? `Speaking — ${params.scenarioLabel}` : "Speaking practice",
  });

  // Written sequentially so the stored ordering matches how it was spoken.
  for (const turn of turns) {
    await appendMessage(conversation.id, { role: turn.role, content: turn.text });
  }

  const durationSec = Math.max(0, Math.round(params.durationSec));

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { endedAt: new Date(), durationSec },
  });

  // Also recorded as a speaking session so the progress page can show spoken
  // practice separately from typed practice.
  const wordCount = learnerTurns.reduce(
    (total, turn) => total + turn.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  await prisma.speakingSession.create({
    data: {
      userId: params.userId,
      conversationId: conversation.id,
      transcript: learnerTurns.map((turn) => turn.text).join("\n"),
      durationSec,
      wordCount,
      wordsPerMinute: durationSec >= 20 ? Math.round((wordCount / durationSec) * 60) : null,
      transcriptionProvider: "gemini-live",
    },
  });

  // Practice credit is recorded before feedback, so a provider failure can't
  // cost the learner the time they actually put in.
  await Promise.allSettled([
    addPracticeSeconds(params.userId, durationSec),
    recordPracticeDay(params.userId),
  ]);

  let feedback: SessionFeedback | null = null;
  let feedbackUnavailableReason: string | undefined;

  if (learnerTurns.length < MIN_LEARNER_TURNS) {
    feedbackUnavailableReason =
      "That was a short conversation — talk a little longer next time and you'll get feedback on it.";
  } else {
    try {
      feedback = await generateSessionFeedback(params.userId, conversation.id);
    } catch (error) {
      // The conversation is already saved; failing feedback must not lose it.
      logger.warn("Voice session feedback failed", {
        userId: params.userId,
        error: String(error),
      });
      feedbackUnavailableReason =
        "We couldn't generate feedback just now, but your practice has been saved.";
    }
  }

  /*
   * Everything Flua should carry into the next conversation is written here,
   * awaited.
   *
   * This used to hang off feedback generation as a fire-and-forget call, which
   * meant it silently did not run whenever feedback failed or came back cached —
   * and on a serverless host the function could be frozen before an un-awaited
   * promise ever settled. Both paths lost the session's memory entirely, which
   * is why Flua could hold conversations for days and still greet the learner
   * like a stranger.
   *
   * Run together because they are independent and both cheap (light tier), so
   * this costs one round trip rather than three. `allSettled` because none of
   * them may fail a session the learner has already finished; each also logs
   * and swallows its own errors.
   */
  await Promise.allSettled([
    generateSessionRecap({ userId: params.userId, conversationId: conversation.id }),
    extractMemoriesFromConversation({ userId: params.userId, conversationId: conversation.id }),
    recordProgressSnapshot(params.userId),
  ]);

  return { conversationId: conversation.id, feedback, feedbackUnavailableReason };
}
