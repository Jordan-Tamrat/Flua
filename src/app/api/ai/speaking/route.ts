import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { speakingAnalyzeSchema } from "@/lib/validation/api";
import { analyzeSpeaking } from "@/server/services/speaking-service";
import { recordPracticeDay } from "@/server/services/progress-service";

/** Analyses a spoken turn from its transcript. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/speaking" }, async (session) => {
    limitByUser(session.userId, "analysis");

    const input = await parseJsonBody(request, speakingAnalyzeSchema);

    const result = await analyzeSpeaking({
      userId: session.userId,
      transcript: input.transcript,
      durationSec: input.durationSec,
      conversationId: input.conversationId,
      transcriptionProvider: input.transcriptionProvider,
      signal: request.signal,
    });

    void recordPracticeDay(session.userId);

    return apiSuccess(result);
  });
}
