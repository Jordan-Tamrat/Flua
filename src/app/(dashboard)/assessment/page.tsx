import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PlacementTest } from "@/features/assessment/placement-test";
import { getSession } from "@/lib/auth/session";
import { PLACEMENT_QUESTIONS, PLACEMENT_WRITING_PROMPT } from "@/lib/learning/placement-test";

export const metadata: Metadata = {
  title: "Level assessment",
};

export default async function AssessmentPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <PlacementTest
      writingPrompt={PLACEMENT_WRITING_PROMPT}
      // `correctIndex` is stripped here: the answers must not reach the client.
      questions={PLACEMENT_QUESTIONS.map((question) => ({
        id: question.id,
        section: question.section,
        prompt: question.prompt,
        options: [...question.options],
      }))}
    />
  );
}
