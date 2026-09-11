import { limitByIp } from "@/lib/api/guards";
import { apiSuccess, handleRoute, parseJsonBody } from "@/lib/api/response";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPassword } from "@/server/services/auth-service";

export async function POST(request: Request) {
  return handleRoute({ endpoint: "POST /api/auth/reset-password" }, async () => {
    limitByIp(request, "auth");

    const input = await parseJsonBody(request, resetPasswordSchema);
    await resetPassword(input);

    return apiSuccess({ reset: true });
  });
}
