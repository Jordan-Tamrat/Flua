import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { activityUpdateSchema } from "@/lib/validation/api";
import { updateActivityStatus } from "@/server/services/practice-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "PATCH /api/practice/activities/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, activityUpdateSchema);
    const activity = await updateActivityStatus(session.userId, id, input.status, input.score);

    return apiSuccess({ activity });
  });
}
