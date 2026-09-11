import { apiSuccess, handleRoute, parseJsonBody } from "@/lib/api/response";
import { limitByIp } from "@/lib/api/guards";
import { setSessionCookie } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation/auth";
import { authenticateUser } from "@/server/services/auth-service";

export async function POST(request: Request) {
  return handleRoute({ endpoint: "POST /api/auth/login" }, async () => {
    // Limited per IP so a stolen-password list can't be tried quickly.
    limitByIp(request, "auth");

    const input = await parseJsonBody(request, loginSchema);
    const session = await authenticateUser(input);

    await setSessionCookie(session);

    return apiSuccess({ user: { id: session.userId, email: session.email, name: session.name } });
  });
}
