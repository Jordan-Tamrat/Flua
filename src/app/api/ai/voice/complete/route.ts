import { z } from "zod";

import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { getVoiceScenario } from "@/lib/ai/prompts/voice";
import { saveVoiceSession } from "@/server/services/voice-session-service";

/**
 * Saves a finished voice conversation and returns its feedback.
 *
 * The transcript is learner-supplied, so it is capped in both turn count and
 * per-turn length — an unbounded array here would become an unbounded prompt.
 */

const requestSchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["USER", "ASSISTANT"]),
        text: z.string().trim().max(4000),
      }),
    )
    .min(1, "That conversation was empty.")
    // A long unbroken call can run to several hundred turns now that sessions
    // are no longer cut off after a few minutes.
    .max(1000, "That conversation is too long to save in one go."),
  durationSec: z.number().int().min(0).max(21600),
  scenarioId: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/voice/complete" }, async (session) => {
    limitByUser(session.userId, "analysis");

    const input = await parseJsonBody(request, requestSchema);
    const scenario = input.scenarioId ? getVoiceScenario(input.scenarioId) : undefined;

    const result = await saveVoiceSession({
      userId: session.userId,
      turns: input.turns,
      durationSec: input.durationSec,
      scenarioId: input.scenarioId,
      // Resolved server-side from the id, so the stored title can't be spoofed.
      scenarioLabel: scenario && scenario.id !== "free-chat" ? scenario.label : undefined,
    });

    return apiSuccess(result);
  });
}
