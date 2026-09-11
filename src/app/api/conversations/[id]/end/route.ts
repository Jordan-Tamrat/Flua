import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import { endConversation } from "@/server/services/conversation-service";
import { generateSessionFeedback } from "@/server/services/feedback-service";
import { recordProgressSnapshot } from "@/server/services/progress-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Ends a session and produces its feedback.
 *
 * This is the moment the learning loop closes: the session is marked complete,
 * feedback is generated, the mistakes it found are recorded, and today's
 * progress snapshot is refreshed so tomorrow's plan reflects all of it.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "POST /api/conversations/[id]/end" }, async (session) => {
    limitByUser(session.userId, "analysis");

    await endConversation(id, session.userId);
    const feedback = await generateSessionFeedback(session.userId, id);

    void recordProgressSnapshot(session.userId);

    return apiSuccess({ feedback });
  });
}
