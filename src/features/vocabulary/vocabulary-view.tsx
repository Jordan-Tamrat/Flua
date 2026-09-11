"use client";

import { BookmarkPlus, Loader2, Search, Trash2, Volume2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { ReviewSession } from "@/features/vocabulary/review-session";
import type { VocabularyEntry } from "@/lib/ai/schemas";
import { ApiError, apiDelete, apiPost } from "@/lib/api/client";
import { isSpeechSynthesisSupported, speak } from "@/lib/speech/text-to-speech";

/**
 * The vocabulary screen.
 *
 * Lookup is the entry point rather than a separate page, because the natural
 * flow is "I met a word → what does it mean? → keep it". Words already saved
 * return instantly from the database with no AI call.
 */

export interface VocabularyItem {
  id: string;
  word: string;
  definition: string;
  partOfSpeech: string | null;
  exampleSentence: string | null;
  synonyms: string[];
  difficulty: string;
  status: string;
  dueAt: string;
  reviewCount: number;
  successCount: number;
}

interface VocabularyViewProps {
  initialItems: VocabularyItem[];
  total: number;
  dueCount: number;
  startInReview: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  LEARNING: "Learning",
  FAMILIAR: "Familiar",
  MASTERED: "Known",
};

export function VocabularyView({
  initialItems,
  total,
  dueCount,
  startInReview,
}: VocabularyViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<VocabularyEntry | null>(null);
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [isLooking, setIsLooking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(startInReview && dueCount > 0);

  const filter = searchParams.get("status") ?? "all";

  async function handleLookup() {
    const word = query.trim();
    if (word.length === 0) return;

    setIsLooking(true);
    setError(null);
    setLookup(null);

    try {
      const result = await apiPost<{
        entry: VocabularyEntry;
        alreadySaved: boolean;
      }>("/api/ai/vocabulary", { action: "lookup", word });

      setLookup(result.entry);
      setAlreadySaved(result.alreadySaved);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't look that word up.");
    } finally {
      setIsLooking(false);
    }
  }

  async function handleSave() {
    if (!lookup) return;
    setIsSaving(true);

    try {
      const result = await apiPost<{ item: VocabularyItem }>("/api/vocabulary", {
        word: lookup.word,
        definition: lookup.definition,
        partOfSpeech: lookup.partOfSpeech,
        exampleSentence: lookup.exampleSentence,
        synonyms: lookup.synonyms,
        antonyms: lookup.antonyms,
        difficulty: lookup.difficulty,
      });

      setItems((current) => [
        { ...result.item, reviewCount: 0, successCount: 0, synonyms: lookup.synonyms },
        ...current.filter((item) => item.word !== result.item.word),
      ]);

      setLookup(null);
      setQuery("");
      toast({ title: `Saved "${result.item.word}"`, variant: "success" });
      router.refresh();
    } catch (caught) {
      toast({
        title: "Couldn't save that word",
        description: caught instanceof ApiError ? caught.message : "Please try again.",
        variant: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string, word: string) {
    // Optimistic: the row disappears immediately and is restored if the
    // request fails, which keeps the list feeling responsive.
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));

    try {
      await apiDelete(`/api/vocabulary/${id}`);
      toast({ title: `Removed "${word}"` });
      router.refresh();
    } catch {
      setItems(previous);
      toast({ title: "Couldn't remove that word", variant: "error" });
    }
  }

  function handleFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.delete("due");
    router.push(`/vocabulary?${params.toString()}`);
  }

  if (reviewing) {
    return (
      <ReviewSession
        onFinish={() => {
          setReviewing(false);
          router.push("/vocabulary");
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Vocabulary</h1>
        <p className="text-muted-foreground text-sm">
          {total} word{total === 1 ? "" : "s"} saved
          {dueCount > 0 ? ` · ${dueCount} due for review` : ""}
        </p>
      </header>

      {dueCount > 0 ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium">
                {dueCount} word{dueCount === 1 ? "" : "s"} ready to review
              </p>
              <p className="text-muted-foreground text-sm">
                Reviewing now is when they actually stick.
              </p>
            </div>
            <Button onClick={() => setReviewing(true)} className="shrink-0">
              Review
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Lookup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Look up a word</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <label htmlFor="word-lookup" className="sr-only">
              Word to look up
            </label>
            <Input
              id="word-lookup"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a word you met…"
              maxLength={80}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleLookup();
                }
              }}
            />
            <Button onClick={handleLookup} disabled={isLooking || query.trim().length === 0}>
              {isLooking ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Search className="size-4" aria-hidden />
              )}
              Look up
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {lookup ? (
            <div className="border-border animate-[slide-up_0.2s_ease-out] space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{lookup.word}</p>
                  {lookup.partOfSpeech ? (
                    <p className="text-muted-foreground text-xs italic">{lookup.partOfSpeech}</p>
                  ) : null}
                </div>
                <Badge variant="muted">{lookup.difficulty}</Badge>
              </div>

              <p className="text-sm">{lookup.definition}</p>

              {lookup.exampleSentence ? (
                <p className="border-primary/40 border-l-2 pl-3 text-sm italic">
                  {lookup.exampleSentence}
                </p>
              ) : null}

              {lookup.synonyms.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">Similar:</span>
                  {lookup.synonyms.map((synonym) => (
                    <Badge key={synonym} variant="secondary">
                      {synonym}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {alreadySaved ? (
                <p className="text-muted-foreground text-xs">This is already in your list.</p>
              ) : (
                <Button onClick={handleSave} disabled={isSaving} size="sm">
                  {isSaving ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <BookmarkPlus className="size-4" aria-hidden />
                  )}
                  Save this word
                </Button>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* List */}
      <section className="space-y-3">
        <Tabs value={filter} onValueChange={handleFilter}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="NEW">New</TabsTrigger>
            <TabsTrigger value="LEARNING">Learning</TabsTrigger>
            <TabsTrigger value="FAMILIAR">Familiar</TabsTrigger>
            <TabsTrigger value="MASTERED">Known</TabsTrigger>
          </TabsList>
        </Tabs>

        {items.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground p-8 text-center text-sm">
              No words here yet. Look one up above, or save words from a conversation.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.word}</span>
                        {item.partOfSpeech ? (
                          <span className="text-muted-foreground text-xs italic">
                            {item.partOfSpeech}
                          </span>
                        ) : null}
                        <Badge variant="muted">{STATUS_LABELS[item.status] ?? item.status}</Badge>
                      </div>

                      <p className="text-muted-foreground text-sm">{item.definition}</p>

                      {item.exampleSentence ? (
                        <p className="text-muted-foreground text-xs italic">
                          {item.exampleSentence}
                        </p>
                      ) : null}

                      {item.reviewCount > 0 ? (
                        <p className="text-muted-foreground text-xs">
                          {item.successCount}/{item.reviewCount} correct
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 gap-1">
                      {isSpeechSynthesisSupported() ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => speak(item.word)}
                          aria-label={`Hear "${item.word}" pronounced`}
                        >
                          <Volume2 className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(item.id, item.word)}
                        aria-label={`Remove "${item.word}"`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
