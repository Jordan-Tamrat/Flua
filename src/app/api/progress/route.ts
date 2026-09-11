import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseSearchParams } from "@/lib/api/response";
import { progressQuerySchema } from "@/lib/validation/api";
import { getProgressOverview } from "@/server/services/progress-service";

export async function GET(request: Request) {
  return handleAuthedRoute({ endpoint: "GET /api/progress" }, async (session) => {
    limitByUser(session.userId, "standard");

    const query = parseSearchParams(request, progressQuerySchema);
    const overview = await getProgressOverview(session.userId, query.days);

    return apiSuccess(overview);
  });
}
