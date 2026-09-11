import { apiSuccess, handleRoute, parseJsonBody } from "@/lib/api/response";
import { limitByIp } from "@/lib/api/guards";
import { setSessionCookie } from "@/lib/auth/session";
import { registerSchema } from "@/lib/validation/auth";
import { registerUser } from "@/server/services/auth-service";

export async function POST(request: Request) {
  return handleRoute({ endpoint: "POST /api/auth/register" }, async () => {
    limitByIp(request, "auth");

    const input = await parseJsonBody(request, registerSchema);
    const session = await registerUser(input);

    await setSessionCookie(session);

    return apiSuccess({ user: { id: session.userId, email: session.email, name: session.name } });
  });
}
