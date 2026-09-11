import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import { deleteSubmission, getSubmission } from "@/server/services/writing-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "GET /api/writing/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");
    const submission = await getSubmission(session.userId, id);
    return apiSuccess({ submission });
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "DELETE /api/writing/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");
    await deleteSubmission(session.userId, id);
    return apiSuccess({ deleted: true });
  });
}
