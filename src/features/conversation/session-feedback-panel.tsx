import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionFeedback } from "@/lib/ai/schemas";
import { getGrammarLabel } from "@/lib/learning/grammar-taxonomy";

/**
 * Post-session feedback.
 *
 * Sections that are empty are omitted entirely — a "Corrections (0)" heading
 * reads as a scolding placeholder rather than good news.
 */
export function SessionFeedbackPanel({ feedback }: { feedback: SessionFeedback }) {
  return (
    <Card className="border-primary/30 bg-primary/5 animate-[slide-up_0.3s_cubic-bezier(0.16,1,0.3,1)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="text-primary size-4" aria-hidden />
          How that went
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed">{feedback.assessment}</p>

        {/* Scores. Only the ones the model actually returned are shown. */}
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <ScoreChip label="Confidence" value={feedback.confidenceScore} />
          <ScoreChip label="Grammar" value={feedback.grammarScore} />
          <ScoreChip label="Vocabulary" value={feedback.vocabularyScore} />
          <ScoreChip label="Fluency" value={feedback.fluencyScore} />
        </div>

        {feedback.errorPatterns.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Patterns to work on</h3>
            {feedback.errorPatterns.map((pattern, index) => (
              <div key={index} className="bg-background/60 space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">{getGrammarLabel(pattern.category)}</Badge>
                  <span className="text-muted-foreground text-xs">{pattern.occurrences}×</span>
                </div>
                <p className="text-sm font-medium">{pattern.description}</p>
                {pattern.examples.length > 0 ? (
                  <ul className="text-muted-foreground space-y-0.5 text-xs">
                    {pattern.examples.map((example, exampleIndex) => (
                      <li key={exampleIndex}>“{example}”</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs leading-relaxed">{pattern.rule}</p>
              </div>
            ))}
          </section>
        ) : null}

        {feedback.corrections.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Worth fixing</h3>
            {feedback.corrections.map((correction, index) => (
              <div key={index} className="border-border space-y-1 border-l-2 pl-3">
                <p className="text-muted-foreground text-sm line-through">{correction.original}</p>
                <p className="text-sm font-medium">{correction.corrected}</p>
                <p className="text-muted-foreground text-xs">{correction.explanation}</p>
                <Badge variant="muted">{getGrammarLabel(correction.category)}</Badge>
              </div>
            ))}
          </section>
        ) : null}

        {feedback.naturalPhrases.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">
              More natural ways to say it
            </h3>
            {feedback.naturalPhrases.map((phrase, index) => (
              <div key={index} className="space-y-0.5 text-sm">
                <p className="text-muted-foreground">{phrase.phrase}</p>
                {phrase.betterPhrase ? <p className="font-medium">{phrase.betterPhrase}</p> : null}
                <p
                  className={phrase.betterPhrase ? "text-muted-foreground text-xs" : "font-medium"}
                >
                  {phrase.note}
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {feedback.vocabularyUsed.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Good word choices</h3>
            <div className="flex flex-wrap gap-1.5">
              {feedback.vocabularyUsed.map((word, index) => (
                <Badge key={`${word}-${index}`} variant="secondary">
                  {word}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        {feedback.recommendedFocus.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Practise next</h3>
            <div className="flex flex-wrap gap-1.5">
              {/*
                Keyed by index rather than value: feedback saved before these
                lists were de-duplicated can still contain a repeated slug, and
                a duplicate key breaks rendering outright.
              */}
              {feedback.recommendedFocus.map((slug, index) => (
                <Badge key={`${slug}-${index}`} variant="outline">
                  {getGrammarLabel(slug)}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        {feedback.nextStep ? (
          <section className="border-primary/40 border-l-2 pl-3">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Next time</h3>
            <p className="mt-1 text-sm leading-relaxed">{feedback.nextStep}</p>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A single score, omitted entirely when the model didn't return one. */
function ScoreChip({ label, value }: { label: string; value?: number }) {
  if (typeof value !== "number") return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Badge variant={value >= 70 ? "success" : value >= 45 ? "secondary" : "warning"}>
        {Math.round(value)}/100
      </Badge>
    </div>
  );
}
