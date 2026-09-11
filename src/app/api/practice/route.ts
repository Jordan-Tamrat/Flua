import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { practiceTimeSchema } from "@/lib/validation/api";
import { addPracticeSeconds, getOrCreateTodaysPlan } from "@/server/services/practice-service";
import { recordPracticeDay } from "@/server/services/progress-service";

/** Today's practice plan. Built from the learner's own statistics, no AI call. */
export async function GET() {
  return handleAuthedRoute({ endpoint: "GET /api/practice" }, async (session) => {
    limitByUser(session.userId, "standard");
    const plan = await getOrCreateTodaysPlan(session.userId);
    return apiSuccess({ plan });
  });
}

/** Adds practice time to today's session. */
export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/practice" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, practiceTimeSchema);

    await getOrCreateTodaysPlan(session.userId);
    await addPracticeSeconds(session.userId, input.seconds);
    const streak = await recordPracticeDay(session.userId);

    return apiSuccess({ recorded: true, ...streak });
  });
}
