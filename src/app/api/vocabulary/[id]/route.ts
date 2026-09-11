import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { vocabularyUpdateSchema } from "@/lib/validation/api";
import { deleteWord, updateWord } from "@/server/services/vocabulary-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "PATCH /api/vocabulary/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, vocabularyUpdateSchema);
    const item = await updateWord(session.userId, id, input);

    return apiSuccess({ item });
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "DELETE /api/vocabulary/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");
    await deleteWord(session.userId, id);
    return apiSuccess({ deleted: true });
  });
}
