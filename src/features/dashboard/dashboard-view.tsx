import {
  ArrowRight,
  BookOpen,
  Flame,
  MessageCircle,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { DashboardData, TopicTrend } from "@/server/services/progress-service";

/**
 * The dashboard.
 *
 * A deliberate choice runs through this screen: show a learner where they are
 * and what to do next, without inventing precision. Trends are arrows rather
 * than decimals, and a topic with too little data says so instead of showing a
 * meaningless percentage.
 */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const TREND_PRESENTATION = {
  improving: { icon: TrendingUp, label: "Improving", className: "text-success" },
  steady: { icon: Minus, label: "Steady", className: "text-muted-foreground" },
  declining: { icon: TrendingDown, label: "Slipping", className: "text-warning" },
} as const;

function TrendRow({ topic }: { topic: TopicTrend }) {
  const presentation = TREND_PRESENTATION[topic.trend];
  const Icon = presentation.icon;

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{topic.label}</span>
      <span className={`flex items-center gap-1.5 text-xs font-medium ${presentation.className}`}>
        <Icon className="size-3.5" aria-hidden />
        {topic.accuracy}%
        <span className="sr-only"> accurate, {presentation.label.toLowerCase()}</span>
      </span>
    </li>
  );
}

export function DashboardView({ data }: { data: DashboardData }) {
  const hasAnyData =
    data.conversationsCompleted > 0 || data.vocabularyLearned > 0 || data.weaknesses.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {greeting()}, {data.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          {hasAnyData
            ? "Here's where you are today."
            : "Let's find out where you're starting from."}
        </p>
      </header>

      {/* Level and daily goal */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Your English
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight">{data.levelDisplay}</span>
              <span className="text-muted-foreground text-sm">
                working toward {data.targetLevel}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {data.levelConfidence < 0.4
                ? "An early estimate — it'll sharpen as you practise."
                : "Estimated from your recent work. Not an official assessment."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Today&apos;s goal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-semibold tracking-tight">
                {data.minutesToday}
                <span className="text-muted-foreground text-base font-normal">
                  {" "}
                  / {data.dailyGoalMinutes} min
                </span>
              </span>
              {data.currentStreak > 0 ? (
                <Badge variant="warning" className="gap-1">
                  <Flame className="size-3" aria-hidden />
                  {data.currentStreak}
                </Badge>
              ) : null}
            </div>
            <Progress
              value={data.goalProgressPercent}
              aria-label={`${data.goalProgressPercent}% of today's goal`}
            />
          </CardContent>
        </Card>
      </div>

      {/* What to do next */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{data.recommendedActivity.title}</p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {data.recommendedActivity.description}
              </p>
            </div>
          </div>
          <Button asChild className="shrink-0">
            <Link href={data.recommendedActivity.href}>
              Start
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Counters */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Conversations" value={data.conversationsCompleted} />
        <StatCard label="Words learned" value={data.vocabularyLearned} />
        <StatCard label="Words due" value={data.vocabularyDue} href="/vocabulary?due=1" />
        <StatCard label="Best streak" value={`${data.longestStreak}d`} />
      </div>

      {/* Focus areas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Worth working on</CardTitle>
          </CardHeader>
          <CardContent>
            {data.weaknesses.length > 0 ? (
              <ul className="divide-border divide-y">
                {data.weaknesses.map((topic) => (
                  <TrendRow key={topic.category} topic={topic} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nothing stands out yet. Have a few conversations and patterns will show up here.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Going well</CardTitle>
          </CardHeader>
          <CardContent>
            {data.strengths.length > 0 ? (
              <ul className="divide-border divide-y">
                {data.strengths.map((topic) => (
                  <TrendRow key={topic.category} topic={topic} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                Not enough practice yet to call anything a strength.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent corrections */}
      {data.recentMistakes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent corrections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.recentMistakes.map((mistake) => (
              <div key={mistake.id} className="border-border space-y-1 border-l-2 pl-4">
                <p className="text-muted-foreground text-sm line-through">{mistake.originalText}</p>
                <p className="text-sm font-medium">{mistake.correctedText}</p>
                <p className="text-muted-foreground text-xs">{mistake.explanation}</p>
                <Badge variant="muted" className="mt-1">
                  {mistake.label}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button asChild variant="outline" className="h-auto justify-start p-4">
          <Link href="/conversation">
            <MessageCircle className="size-4" aria-hidden />
            <span className="text-left">
              <span className="block font-medium">Start a conversation</span>
              <span className="text-muted-foreground block text-xs">
                The fastest way to make progress
              </span>
            </span>
          </Link>
        </Button>

        <Button asChild variant="outline" className="h-auto justify-start p-4">
          <Link href="/grammar">
            <BookOpen className="size-4" aria-hidden />
            <span className="text-left">
              <span className="block font-medium">Browse grammar</span>
              <span className="text-muted-foreground block text-xs">
                Lessons and practice by topic
              </span>
            </span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href?: string;
}) {
  const content = (
    <Card className={href ? "hover:border-primary/40 transition-colors" : undefined}>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{label}</p>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="focus-visible:outline-ring rounded-xl focus-visible:outline-2">
      {content}
    </Link>
  ) : (
    content
  );
}
