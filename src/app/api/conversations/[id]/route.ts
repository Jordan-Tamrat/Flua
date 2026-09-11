import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import {
  getConversationMessages,
  getOwnedConversation,
  softDeleteConversation,
} from "@/server/services/conversation-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "GET /api/conversations/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");

    // Ownership is enforced inside the service, which throws a 404 rather
    // than a 403 so ids belonging to other users stay indistinguishable.
    const conversation = await getOwnedConversation(id, session.userId);
    const messages = await getConversationMessages(id, session.userId);

    return apiSuccess({ conversation, messages });
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  return handleAuthedRoute({ endpoint: "DELETE /api/conversations/[id]" }, async (session) => {
    limitByUser(session.userId, "standard");
    await softDeleteConversation(id, session.userId);
    return apiSuccess({ deleted: true });
  });
}
