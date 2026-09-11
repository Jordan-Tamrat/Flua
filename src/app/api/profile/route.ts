import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute, parseJsonBody } from "@/lib/api/response";
import { settingsSchema } from "@/lib/validation/api";
import { getProfile, updateSettings } from "@/server/services/profile-service";

export async function GET() {
  return handleAuthedRoute({ endpoint: "GET /api/profile" }, async (session) => {
    limitByUser(session.userId, "standard");
    const profile = await getProfile(session.userId);
    return apiSuccess({ profile });
  });
}

export async function PATCH(request: Request) {
  return handleAuthedRoute({ endpoint: "PATCH /api/profile" }, async (session) => {
    limitByUser(session.userId, "standard");

    const input = await parseJsonBody(request, settingsSchema);
    const profile = await updateSettings(session.userId, input);

    return apiSuccess({ profile });
  });
}
