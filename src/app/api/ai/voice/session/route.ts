import { z } from "zod";

import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { VOICE_SCENARIOS } from "@/lib/ai/prompts/voice";
import { createVoiceSession } from "@/lib/ai/voice/voice-service";
import { buildConversationContext } from "@/server/services/context-builder";

/**
 * Mints a short-lived credential for one live voice conversation.
 *
 * The learner's profile and the tutor's system prompt are assembled here and
 * locked into the token, so the browser receives a credential that can only do
 * one thing: hold a tutoring conversation as this learner.
 */

const requestSchema = z.object({
  scenarioId: z
    .string()
    .refine((value) => VOICE_SCENARIOS.some((scenario) => scenario.id === value), {
      message: "Unknown scenario.",
    })
    .optional(),
});

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/voice/session" }, async (session) => {
    // A live session is the most expensive thing a learner can start, so it is
    // limited more tightly than an ordinary AI call.
    limitByUser(session.userId, { limit: 10, windowSeconds: 300 });

    const input = await parseJsonBody(request, requestSchema);
    const context = await buildConversationContext(session.userId);

    const grant = await createVoiceSession({
      context,
      scenarioId: input.scenarioId,
    });

    return apiSuccess(grant);
  });
}
