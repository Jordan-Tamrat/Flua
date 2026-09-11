import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProgressView } from "@/features/progress/progress-view";
import { getSession } from "@/lib/auth/session";
import { getProgressOverview } from "@/server/services/progress-service";

export const metadata: Metadata = {
  title: "Progress",
};

export default async function ProgressPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const overview = await getProgressOverview(session.userId, 30);

  return <ProgressView overview={overview} />;
}
