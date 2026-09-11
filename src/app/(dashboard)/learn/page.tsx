import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardView } from "@/features/dashboard/dashboard-view";
import { getSession } from "@/lib/auth/session";
import { getDashboardData } from "@/server/services/progress-service";

export const metadata: Metadata = {
  title: "Today",
};

export default async function LearnPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await getDashboardData(session.userId);

  return <DashboardView data={data} />;
}
