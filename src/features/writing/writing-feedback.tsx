"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { WritingAnalysis } from "@/lib/ai/schemas";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";

/**
 * Writing feedback.
 *
 * The ordering here is the pedagogy: scores, then each correction with its
 * reason, and only then the natural rewrite — behind a toggle, so it can't be
 * skimmed instead of the explanations.
 */

const SEVERITY_VARIANT = {
  MINOR: "muted",
  MODERATE: "warning",
  MAJOR: "destructive",
} as const;

export function WritingFeedback({
  analysis,
  original,
}: {
  analysis: WritingAnalysis;
  original: string;
}) {
  const [showNatural, setShowNatural] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How that reads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm leading-relaxed">{analysis.summary}</p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ScoreBar label="Overall" value={analysis.overallScore} />
            <ScoreBar label="Grammar" value={analysis.grammarScore} />
            <ScoreBar label="Vocabulary" value={analysis.vocabularyScore} />
            <ScoreBar label="Flow" value={analysis.coherenceScore} />
          </div>

          <p className="text-muted-foreground text-xs">
            Scored against what&apos;s reasonable at your level, not against a native writer.
          </p>
        </CardContent>
      </Card>

      {analysis.corrections.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {analysis.corrections.length} thing
              {analysis.corrections.length === 1 ? "" : "s"} to fix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {analysis.corrections.map((correction, index) => (
              <div key={index} className="border-border space-y-2 border-l-2 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">{getGrammarLabel(correction.category)}</Badge>
                  <Badge variant={SEVERITY_VARIANT[correction.severity]}>
                    {correction.severity === "MINOR"
                      ? "Minor"
                      : correction.severity === "MODERATE"
                        ? "Worth fixing"
                        : "Changes the meaning"}
                  </Badge>
                </div>

                <p className="text-muted-foreground text-sm line-through">{correction.original}</p>
                <p className="text-sm font-medium">{correction.corrected}</p>
                <p className="text-muted-foreground text-sm">{correction.explanation}</p>

                {correction.example ? (
                  <p className="text-muted-foreground border-primary/40 border-l-2 pl-3 text-xs italic">
                    {correction.example}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm">
              No grammar problems worth flagging in this one. Have a look at the natural version
              below to see where the phrasing could be tightened.
            </p>
          </CardContent>
        </Card>
      )}

      {analysis.strengths.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What worked</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {analysis.strengths.map((strength, index) => (
                <li key={index} className="text-sm">
                  {strength}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {analysis.suggestions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next time</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {analysis.suggestions.map((suggestion, index) => (
                <li key={index} className="text-sm">
                  {suggestion}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {analysis.naturalVersion ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A more natural version</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-xs">
              Same meaning, phrased the way a native speaker would. Compare it with yours — the
              differences are where the learning is.
            </p>

            {showNatural ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Yours
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{original}</p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    Natural
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {analysis.naturalVersion}
                  </p>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setShowNatural(true)}>
                Show side by side
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-sm font-semibold">{Math.round(value)}</span>
      </div>
      <Progress
        value={value}
        className="h-1.5"
        aria-label={`${label}: ${Math.round(value)} out of 100`}
        indicatorClassName={value < 60 ? "bg-warning" : undefined}
      />
    </div>
  );
}
