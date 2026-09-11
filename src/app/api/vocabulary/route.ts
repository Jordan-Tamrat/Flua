import { limitByUser } from "@/lib/api/guards";
import {
  apiSuccess,
  handleAuthedRoute,
  parseJsonBody,
  parseSearchParams,
} from "@/lib/api/response";
import { vocabularyListSchema, vocabularySaveSchema } from "@/lib/validation/api";
import { listVocabulary, saveWord } from "@/server/services/vocabulary-service";

export async function GET(request: Request) {
  return handleAuthedRoute({ endpoint: "GET /api/vocabulary" }, async (session) => {
    limitByUser(session.userId, "standard");

    const query = parseSearchParams(request, vocabularyListSchema);

    const result = await listVocabulary(session.userId, {
      status: query.status,
      dueOnly: query.due === "1",
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return apiSuccess(result);
  });
}

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/vocabulary" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, vocabularySaveSchema);
    const item = await saveWord(session.userId, input);

    return apiSuccess({ item }, { status: 201 });
  });
}
