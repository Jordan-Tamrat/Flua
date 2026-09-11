import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { writingSubmitSchema } from "@/lib/validation/api";
import { analyzeSubmission, createSubmission } from "@/server/services/writing-service";
import { recordPracticeDay } from "@/server/services/progress-service";

/**
 * Submits a piece of writing and analyses it.
 *
 * Saving and analysing are one call because a submission without feedback isn't
 * useful to the learner — but the row is created first, so a provider failure
 * never loses their work.
 */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/writing" }, async (session) => {
    limitByUser(session.userId, "analysis");

    const input = await parseJsonBody(request, writingSubmitSchema);

    const submission = await createSubmission(session.userId, input);
    const analysis = await analyzeSubmission(session.userId, submission.id, request.signal);

    void recordPracticeDay(session.userId);

    return apiSuccess({ submission, analysis });
  });
}
