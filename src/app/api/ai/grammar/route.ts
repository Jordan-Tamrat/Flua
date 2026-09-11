import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { grammarExerciseRequestSchema } from "@/lib/validation/api";
import { generateExercises } from "@/server/services/grammar-service";

/** Generates a set of practice questions for a grammar category. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/grammar" }, async (session) => {
    limitByUser(session.userId, "generation");

    const input = await parseJsonBody(request, grammarExerciseRequestSchema);
    const exercises = await generateExercises(session.userId, input.category, request.signal);

    return apiSuccess(exercises);
  });
}
