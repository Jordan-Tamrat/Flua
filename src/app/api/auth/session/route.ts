import { apiSuccess, handleRoute } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";

/** Lets the client check who is signed in without parsing the cookie itself. */
export async function GET() {
  return handleRoute({ endpoint: "GET /api/auth/session" }, async () => {
    const session = await getSession();

    if (!session) {
      return apiSuccess({ user: null });
    }

    return apiSuccess({
      user: { id: session.userId, email: session.email, name: session.name },
    });
  });
}
