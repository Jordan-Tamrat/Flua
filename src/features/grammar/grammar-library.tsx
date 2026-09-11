import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { GRAMMAR_CATEGORIES } from "@/lib/learning/grammar-taxonomy";
import type { TopicTrend } from "@/server/services/progress-service";

/**
 * The grammar library.
 *
 * Topics the learner is weakest at are pulled to the top, so the page opens on
 * what matters rather than on an alphabetical list. Topics with no data show no
 * score at all — inventing one would be worse than saying nothing.
 */
export function GrammarLibrary({ stats }: { stats: TopicTrend[] }) {
  const statsBySlug = new Map(stats.map((stat) => [stat.category, stat]));

  const withData = GRAMMAR_CATEGORIES.filter((category) => {
    const stat = statsBySlug.get(category.slug);
    return stat?.hasEnoughData;
  }).sort((a, b) => {
    const aStat = statsBySlug.get(a.slug)?.accuracy ?? 100;
    const bStat = statsBySlug.get(b.slug)?.accuracy ?? 100;
    return aStat - bStat;
  });

  const withoutData = GRAMMAR_CATEGORIES.filter(
    (category) => !statsBySlug.get(category.slug)?.hasEnoughData,
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Grammar</h1>
        <p className="text-muted-foreground text-sm">
          Lessons and practice for each topic. Your weakest areas come first.
        </p>
      </header>

      {withData.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Based on your practice</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {withData.map((category) => (
              <TopicCard
                key={category.slug}
                slug={category.slug}
                label={category.label}
                summary={category.summary}
                level={category.level}
                stat={statsBySlug.get(category.slug)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          {withData.length > 0 ? "Everything else" : "All topics"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {withoutData.map((category) => (
            <TopicCard
              key={category.slug}
              slug={category.slug}
              label={category.label}
              summary={category.summary}
              level={category.level}
              stat={statsBySlug.get(category.slug)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

const TREND_ICON = {
  improving: TrendingUp,
  steady: Minus,
  declining: TrendingDown,
} as const;

function TopicCard({
  slug,
  label,
  summary,
  level,
  stat,
}: {
  slug: string;
  label: string;
  summary: string;
  level: string;
  stat?: TopicTrend;
}) {
  const TrendIcon = stat?.hasEnoughData ? TREND_ICON[stat.trend] : null;

  return (
    <Link
      href={`/grammar/${slug}`}
      className="focus-visible:outline-ring rounded-xl focus-visible:outline-2"
    >
      <Card className="hover:border-primary/40 h-full transition-colors">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm">{label}</CardTitle>
            <Badge variant="muted" className="shrink-0">
              {level}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">{summary}</p>

          {stat?.hasEnoughData ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{stat.attempts} attempts</span>
                <span className="flex items-center gap-1 font-medium">
                  {TrendIcon ? <TrendIcon className="size-3" aria-hidden /> : null}
                  {stat.accuracy}%
                </span>
              </div>
              <Progress
                value={stat.accuracy}
                className="h-1.5"
                aria-label={`${stat.accuracy}% accurate on ${label}`}
                indicatorClassName={stat.accuracy < 70 ? "bg-warning" : undefined}
              />
            </div>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              Not practised yet
              <ArrowRight className="size-3" aria-hidden />
            </span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
