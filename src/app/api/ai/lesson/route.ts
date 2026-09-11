import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { grammarLessonRequestSchema } from "@/lib/validation/api";
import { generateLesson } from "@/server/services/grammar-service";

/** Generates a structured lesson for a grammar category. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/lesson" }, async (session) => {
    limitByUser(session.userId, "generation");

    const input = await parseJsonBody(request, grammarLessonRequestSchema);
    const lesson = await generateLesson(session.userId, input.category, request.signal);

    return apiSuccess(lesson);
  });
}
