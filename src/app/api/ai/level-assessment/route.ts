import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { PLACEMENT_QUESTIONS, PLACEMENT_WRITING_PROMPT } from "@/lib/learning/placement-test";
import { placementSubmitSchema } from "@/lib/validation/api";
import { runPlacementAssessment } from "@/server/services/assessment-service";

/**
 * Placement assessment.
 *
 * GET serves the fixed question set — no AI, so it works before any provider is
 * configured. POST scores the answers and asks a model to read the writing
 * sample.
 */

export async function GET() {
  // Authenticated, but the question set is the same for everyone — the session
  // is only needed to keep the endpoint private.
  return handleAuthedRoute({ endpoint: "GET /api/ai/level-assessment" }, async () =>
    apiSuccess({
      // correctIndex is deliberately withheld so answers can't be read from
      // the network response.
      questions: PLACEMENT_QUESTIONS.map((question) => ({
        id: question.id,
        section: question.section,
        prompt: question.prompt,
        options: question.options,
      })),
      writingPrompt: PLACEMENT_WRITING_PROMPT,
    }),
  );
}

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/level-assessment" }, async (session) => {
    limitByUser(session.userId, "analysis");

    const input = await parseJsonBody(request, placementSubmitSchema);

    const assessment = await runPlacementAssessment({
      userId: session.userId,
      answers: input.answers,
      writingSample: input.writingSample,
      signal: request.signal,
    });

    return apiSuccess(assessment);
  });
}
