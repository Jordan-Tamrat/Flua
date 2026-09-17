import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import { getDueErrorDrills } from "@/server/services/error-drill-service";

/**
 * The learner's own mistakes that are due to be retested.
 *
 * No AI call: the queue is a date comparison and the answers are already stored.
 */
export async function GET() {
  return handleAuthedRoute({ endpoint: "GET /api/practice/errors" }, async (session) => {
    const items = await getDueErrorDrills(session.userId);
    return apiSuccess({ items });
  });
}
