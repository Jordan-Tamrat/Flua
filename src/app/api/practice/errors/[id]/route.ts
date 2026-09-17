import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { errorDrillAttemptSchema } from "@/lib/validation/api";
import { dismissErrorDrill, recordErrorDrillResult } from "@/server/services/error-drill-service";
import { recordPracticeDay } from "@/server/services/progress-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Grades one attempt at fixing the learner's own sentence.
 *
 * Grading is server-side so the expected answer is never sent to the browser
 * before the learner has tried. No AI involved — the correction was stored
 * alongside the mistake, so this is a string comparison.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "POST /api/practice/errors/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, errorDrillAttemptSchema);

    if (input.action === "dismiss") {
      await dismissErrorDrill(session.userId, id);
      return apiSuccess({ dismissed: true });
    }

    const result = await recordErrorDrillResult(session.userId, id, input.answer, input.responseMs);

    void recordPracticeDay(session.userId);

    return apiSuccess(result);
  });
}
