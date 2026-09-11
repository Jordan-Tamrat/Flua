import { apiSuccess, handleRoute } from "@/lib/api/response";
import { clearSessionCookie } from "@/lib/auth/session";

export async function POST() {
  return handleRoute({ endpoint: "POST /api/auth/logout" }, async () => {
    await clearSessionCookie();
    return apiSuccess({ signedOut: true });
  });
}
