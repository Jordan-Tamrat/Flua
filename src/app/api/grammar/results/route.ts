import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { grammarResultsSchema } from "@/lib/validation/api";
import { recordDrillResults } from "@/server/services/grammar-service";
import { nudgeLevelScore } from "@/server/services/assessment-service";
import { recordPracticeDay } from "@/server/services/progress-service";

/**
 * Records how a learner did on a drill.
 *
 * This feeds the same per-category statistics as live corrections, so drill
 * performance and conversation performance shape the same weakness picture.
 */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/grammar/results" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, grammarResultsSchema);

    await recordDrillResults(session.userId, input.category, {
      correct: input.correct,
      total: input.total,
    });

    const accuracy = Math.round((input.correct / input.total) * 100);
    await nudgeLevelScore(session.userId, accuracy);
    void recordPracticeDay(session.userId);

    return apiSuccess({ recorded: true, accuracy });
  });
}
