import { requireAdmin } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import { getAdminOverview } from "@/server/services/admin-service";

/** Provider status, usage and recent failures. Restricted to ADMIN_EMAILS. */
export async function GET() {
  return handleAuthedRoute({ endpoint: "GET /api/admin/overview" }, async () => {
    // The admin check runs inside the wrapper so a non-admin gets a clean 403
    // envelope rather than an uncaught error.
    await requireAdmin();

    const overview = await getAdminOverview();
    return apiSuccess(overview);
  });
}
