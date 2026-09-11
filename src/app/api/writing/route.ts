import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseSearchParams } from "@/lib/api/response";
import { writingListSchema } from "@/lib/validation/api";
import { listSubmissions } from "@/server/services/writing-service";

export async function GET(request: Request) {
  return handleAuthedRoute({ endpoint: "GET /api/writing" }, async (session) => {
    limitByUser(session.userId, "standard");

    const query = parseSearchParams(request, writingListSchema);
    const result = await listSubmissions(session.userId, query.limit, query.offset);

    return apiSuccess(result);
  });
}
