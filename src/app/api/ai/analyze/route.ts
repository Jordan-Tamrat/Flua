import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { analyzeRequestSchema } from "@/lib/validation/api";
import { analyzeGrammar } from "@/server/services/grammar-service";

/** Ad-hoc grammar analysis of a piece of text. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/analyze" }, async (session) => {
    limitByUser(session.userId, "analysis");

    const input = await parseJsonBody(request, analyzeRequestSchema);

    const analysis = await analyzeGrammar({
      userId: session.userId,
      text: input.text,
      source: input.source,
      conversationId: input.conversationId,
      signal: request.signal,
    });

    return apiSuccess(analysis);
  });
}
