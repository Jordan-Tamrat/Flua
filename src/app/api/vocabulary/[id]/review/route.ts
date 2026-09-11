import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { vocabularyReviewSchema } from "@/lib/validation/api";
import { reviewWord } from "@/server/services/vocabulary-service";
import { recordPracticeDay } from "@/server/services/progress-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Records a spaced-repetition review. No AI involved — the schedule is arithmetic. */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "POST /api/vocabulary/[id]/review" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, vocabularyReviewSchema);
    const item = await reviewWord(session.userId, id, input.outcome, input.responseMs);

    void recordPracticeDay(session.userId);

    return apiSuccess({ item });
  });
}
