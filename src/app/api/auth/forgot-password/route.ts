import { limitByIp } from "@/lib/api/guards";
import { apiSuccess, handleRoute, parseJsonBody } from "@/lib/api/response";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/server/services/auth-service";

export async function POST(request: Request) {
  return handleRoute({ endpoint: "POST /api/auth/forgot-password" }, async () => {
    limitByIp(request, "auth");

    const input = await parseJsonBody(request, forgotPasswordSchema);
    const result = await requestPasswordReset(input);

    // The response is identical whether or not the email is registered, so this
    // endpoint can't be used to discover which addresses have accounts.
    return apiSuccess({
      submitted: true,
      // Present in development only — there is no mail transport in the MVP.
      ...(result.devToken ? { devToken: result.devToken } : {}),
    });
  });
}
