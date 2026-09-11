import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { writingPromptSchema } from "@/lib/validation/api";
import { suggestWritingPrompt } from "@/server/services/writing-service";

/** Suggests something for the learner to write about. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/writing/prompt" }, async (session) => {
    limitByUser(session.userId, "generation");

    const input = await parseJsonBody(request, writingPromptSchema);
    const prompt = await suggestWritingPrompt(session.userId, input.kind, request.signal);

    return apiSuccess({ prompt });
  });
}
