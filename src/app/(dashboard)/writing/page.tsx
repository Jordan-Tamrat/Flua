import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WritingView } from "@/features/writing/writing-view";
import { getSession } from "@/lib/auth/session";
import { listSubmissions } from "@/server/services/writing-service";

export const metadata: Metadata = {
  title: "Writing",
};

export default async function WritingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { items } = await listSubmissions(session.userId, 10, 0);

  return (
    <WritingView
      recent={items.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        wordCount: item.wordCount,
        overallScore: item.overallScore,
        createdAt: item.createdAt.toISOString(),
      }))}
    />
  );
}
