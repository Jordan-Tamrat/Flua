import { limitByUser } from "@/lib/api/guards";
import {
  apiSuccess,
  handleAuthedRoute,
  parseJsonBody,
  parseSearchParams,
} from "@/lib/api/response";
import { createConversationSchema, listConversationsSchema } from "@/lib/validation/api";
import {
  createConversation,
  generateOpeningMessage,
  listConversations,
} from "@/server/services/conversation-service";

export async function GET(request: Request) {
  return handleAuthedRoute({ endpoint: "GET /api/conversations" }, async (session) => {
    limitByUser(session.userId, "standard");

    const query = parseSearchParams(request, listConversationsSchema);
    const conversations = await listConversations(session.userId, query);

    return apiSuccess({ conversations });
  });
}

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/conversations" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, createConversationSchema);
    const conversation = await createConversation(session.userId, input);

    let opening: string | null = null;

    if (input.generateOpening && input.mode === "CONVERSATION") {
      // A missing provider must not block creating the conversation — the
      // learner can still type first and see the error then.
      try {
        opening = await generateOpeningMessage(session.userId, conversation.id);
      } catch {
        opening = null;
      }
    }

    return apiSuccess({ conversation, opening }, { status: 201 });
  });
}
