import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProgressOverview } from "@/server/services/progress-service";

/**
 * The progress page.
 *
 * The guiding rule from the spec — "display trends, not fake precision" — shows
 * up everywhere here: topics show a direction, the chart is a simple sparkline
 * rather than a false-authority dashboard, and any series without enough points
 * says so instead of drawing a line through two dots.
 */

const TREND_PRESENTATION = {
  improving: { icon: TrendingUp, label: "Improving", className: "text-success" },
  steady: { icon: Minus, label: "Steady", className: "text-muted-foreground" },
  declining: { icon: TrendingDown, label: "Needs practice", className: "text-warning" },
} as const;

/** Minimum points before a line is worth drawing. */
const MIN_POINTS_FOR_CHART = 3;

export function ProgressView({ overview }: { overview: ProgressOverview }) {
  const { totals, topics, snapshots } = overview;

  const withData = topics.filter((topic) => topic.hasEnoughData);
  const weakest = withData.filter((topic) => topic.accuracy < 70);
  const strongest = withData.filter((topic) => topic.accuracy >= 85);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="text-muted-foreground text-sm">
          How things are going. Directions matter more than exact numbers here.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Practice time" value={`${totals.totalMinutes}m`} />
        <Stat label="Conversations" value={totals.totalConversations} />
        <Stat label="Words saved" value={totals.totalWords} />
        <Stat
          label="Recall rate"
          value={totals.totalReviews > 0 ? `${totals.retentionRate}%` : "—"}
          hint={totals.totalReviews > 0 ? `${totals.totalReviews} reviews` : "No reviews yet"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Current streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight">
              {totals.currentStreak}
              <span className="text-muted-foreground text-base font-normal"> days</span>
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Your best is {totals.longestStreak} day{totals.longestStreak === 1 ? "" : "s"}.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Level over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshots.length >= MIN_POINTS_FOR_CHART ? (
              <Sparkline
                values={snapshots.map((snapshot) => snapshot.levelScore)}
                label="Level score over time"
              />
            ) : (
              <p className="text-muted-foreground py-2 text-sm">
                Not enough days recorded yet to show a trend.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {snapshots.length >= MIN_POINTS_FOR_CHART ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Daily practice</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              values={snapshots.map((snapshot) => ({
                label: new Date(snapshot.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                }),
                value: snapshot.minutesPracticed,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Needs practice</CardTitle>
          </CardHeader>
          <CardContent>
            {weakest.length > 0 ? (
              <ul className="space-y-3">
                {weakest.slice(0, 6).map((topic) => (
                  <TopicRow key={topic.category} topic={topic} />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                {withData.length === 0
                  ? "Nothing tracked yet. Have a conversation or try some grammar practice."
                  : "Nothing is falling behind at the moment."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Going well</CardTitle>
          </CardHeader>
          <CardContent>
            {strongest.length > 0 ? (
              <ul className="space-y-3">
                {strongest.slice(0, 6).map((topic) => (
                  <TopicRow key={topic.category} topic={topic} />
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

      {overview.writingScores.length >= 2 || overview.speakingScores.length >= 2 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {overview.writingScores.length >= 2 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Writing scores</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  values={overview.writingScores.map((entry) => entry.score)}
                  label="Writing scores over time"
                />
              </CardContent>
            </Card>
          ) : null}

          {overview.speakingScores.length >= 2 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Speaking fluency</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline
                  values={overview.speakingScores.map((entry) => entry.score)}
                  label="Speaking fluency over time"
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TopicRow({ topic }: { topic: ProgressOverview["topics"][number] }) {
  const presentation = TREND_PRESENTATION[topic.trend];
  const Icon = presentation.icon;

  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{topic.label}</span>
        <span
          className={`flex shrink-0 items-center gap-1 text-xs font-medium ${presentation.className}`}
        >
          <Icon className="size-3.5" aria-hidden />
          {presentation.label}
        </span>
      </div>
      <Progress
        value={topic.accuracy}
        className="h-1.5"
        aria-label={`${topic.label}: ${topic.accuracy}% accurate over ${topic.attempts} attempts`}
        indicatorClassName={topic.accuracy < 70 ? "bg-warning" : undefined}
      />
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{label}</p>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs opacity-70">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * A minimal inline sparkline.
 *
 * Hand-drawn SVG rather than a charting library: this is one polyline, and a
 * dependency for it would be hard to justify in a project that is explicitly
 * meant to stay small.
 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;

  const width = 300;
  const height = 60;
  const padding = 4;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero, so give it a nominal range.
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full"
      role="img"
      aria-label={`${label}. From ${Math.round(values[0]!)} to ${Math.round(values.at(-1)!)}.`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Simple vertical bars for daily practice minutes. */
function BarChart({ values }: { values: Array<{ label: string; value: number }> }) {
  const max = Math.max(...values.map((entry) => entry.value), 1);
  // Long ranges get crowded, so only the most recent stretch is drawn.
  const visible = values.slice(-30);

  return (
    <div className="space-y-2">
      <div className="flex h-24 items-end gap-1" role="img" aria-label="Minutes practised per day">
        {visible.map((entry, index) => (
          <div
            key={index}
            className="bg-primary/70 hover:bg-primary min-h-0.5 flex-1 rounded-t-sm transition-colors"
            style={{ height: `${(entry.value / max) * 100}%` }}
            title={`${entry.label}: ${entry.value} minutes`}
          />
        ))}
      </div>
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{visible[0]?.label}</span>
        <span>{visible.at(-1)?.label}</span>
      </div>
    </div>
  );
}
