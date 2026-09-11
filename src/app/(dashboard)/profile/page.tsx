import { Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getSession } from "@/lib/auth/session";
import { getProfile } from "@/server/services/profile-service";
import { getActiveMemories } from "@/server/services/memory-service";
import { getVocabularyStats } from "@/server/services/vocabulary-service";

export const metadata: Metadata = {
  title: "Profile",
};

const MEMORY_LABELS: Record<string, string> = {
  WEAKNESS: "Finds hard",
  STRENGTH: "Does well",
  PREFERENCE: "Prefers",
  GOAL: "Working toward",
  PERSONAL_FACT: "About you",
  RECURRING_ERROR: "Keeps happening",
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [user, memories, vocabStats] = await Promise.all([
    getProfile(session.userId),
    getActiveMemories(session.userId, 15),
    getVocabularyStats(session.userId),
  ]);

  const profile = user.profile!;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{user.name}</h1>
        <p className="text-muted-foreground text-sm">
          Learning since {user.createdAt.toLocaleDateString()}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where you are</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-3xl font-semibold tracking-tight">{profile.estimatedLevel}</span>
            <Badge variant="secondary">Target: {profile.targetLevel}</Badge>
          </div>

          <div className="space-y-1.5">
            <Progress
              value={profile.levelScore}
              aria-label={`Level score ${Math.round(profile.levelScore)} out of 100`}
            />
            <p className="text-muted-foreground text-xs">
              {profile.levelConfidence < 0.4
                ? "An early estimate — it sharpens as you practise."
                : `Confidence: ${Math.round(profile.levelConfidence * 100)}%. This is Flua's own estimate, not an official CEFR assessment.`}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2">
            <div>
              <p className="text-xl font-semibold">{profile.currentStreak}</p>
              <p className="text-muted-foreground text-xs">day streak</p>
            </div>
            <div>
              <p className="text-xl font-semibold">{vocabStats.total}</p>
              <p className="text-muted-foreground text-xs">words saved</p>
            </div>
            <div>
              <p className="text-xl font-semibold">{profile.dailyGoalMinutes}m</p>
              <p className="text-muted-foreground text-xs">daily goal</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {user.goals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your goals</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {user.goals.map((goal) => (
                <li key={goal.id} className="flex items-center gap-2 text-sm">
                  <Target className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  {goal.label}
                  {goal.isPrimary ? <Badge variant="muted">Main</Badge> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What Flua remembers</CardTitle>
          <CardDescription>
            A small set of notes that make lessons feel less generic. Nothing else from your
            conversations is kept long-term.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {memories.length > 0 ? (
            <ul className="space-y-2">
              {memories.map((memory) => (
                <li key={memory.id} className="flex items-start gap-2 text-sm">
                  <Badge variant="muted" className="mt-0.5 shrink-0">
                    {MEMORY_LABELS[memory.kind] ?? memory.kind}
                  </Badge>
                  <span>{memory.content}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nothing yet. After a few conversations, Flua will start noticing patterns worth
              remembering.
            </p>
          )}
        </CardContent>
      </Card>

      {profile.interests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Topics you like</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {profile.interests.map((interest) => (
                <Badge key={interest} variant="secondary">
                  {interest}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Button asChild variant="outline" className="w-full">
        <Link href="/settings">Change your settings</Link>
      </Button>
    </div>
  );
}
