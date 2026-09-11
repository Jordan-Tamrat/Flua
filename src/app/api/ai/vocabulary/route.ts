import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { ValidationError } from "@/lib/errors";
import {
  vocabularyLookupSchema,
  vocabularyQuizSchema,
  vocabularySuggestSchema,
} from "@/lib/validation/api";
import { generateQuiz, lookupWord, suggestWords } from "@/server/services/vocabulary-service";
import { z } from "zod";

/**
 * Vocabulary AI operations.
 *
 * The three actions share one route because they share a rate-limit budget and
 * an auth check; `action` selects which. Note that `lookup` frequently returns
 * without any AI call at all — a word already in the learner's collection is
 * served from the database.
 */

// `discriminatedUnion` needs object shapes rather than intersections, so each
// branch extends its base schema instead of being `.and()`-ed with it.
const requestSchema = z.discriminatedUnion("action", [
  vocabularyLookupSchema.extend({ action: z.literal("lookup") }),
  vocabularySuggestSchema.extend({ action: z.literal("suggest") }),
  vocabularyQuizSchema.extend({ action: z.literal("quiz") }),
]);

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/vocabulary" }, async (session) => {
    limitByUser(session.userId, "generation");

    const input = await parseJsonBody(request, requestSchema);

    switch (input.action) {
      case "lookup": {
        const result = await lookupWord(session.userId, input.word, request.signal);
        return apiSuccess(result);
      }
      case "suggest": {
        const words = await suggestWords(session.userId, input.topic, request.signal);
        return apiSuccess({ words });
      }
      case "quiz": {
        const quiz = await generateQuiz(session.userId, input.itemIds, request.signal);
        return apiSuccess(quiz);
      }
      default:
        throw new ValidationError("Unknown vocabulary action.");
    }
  });
}
