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

        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">Communication confidence</span>
          <Badge variant={feedback.confidenceScore >= 70 ? "success" : "secondary"}>
            {Math.round(feedback.confidenceScore)}/100
          </Badge>
        </div>

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
              <div key={index} className="text-sm">
                <p className="text-muted-foreground">{phrase.phrase}</p>
                <p className="font-medium">{phrase.note}</p>
              </div>
            ))}
          </section>
        ) : null}

        {feedback.vocabularyUsed.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Good word choices</h3>
            <div className="flex flex-wrap gap-1.5">
              {feedback.vocabularyUsed.map((word) => (
                <Badge key={word} variant="secondary">
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
              {feedback.recommendedFocus.map((slug) => (
                <Badge key={slug} variant="outline">
                  {getGrammarLabel(slug)}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
