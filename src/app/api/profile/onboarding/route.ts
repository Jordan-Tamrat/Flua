import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { onboardingSchema } from "@/lib/validation/api";
import { completeOnboarding } from "@/server/services/profile-service";

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/profile/onboarding" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, onboardingSchema);
    const profile = await completeOnboarding(session.userId, input);

    return apiSuccess({ profile });
  });
}
