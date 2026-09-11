import { ChevronRight, History } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

/**
 * Past voice conversations.
 *
 * Saving a session was previously invisible: the transcript and its feedback
 * went into the database and nothing in the interface ever pointed at them, so
 * "your practice has been saved" was a claim the learner had no way to check.
 * This is the link back to them.
 */

export interface PastVoiceSession {
  id: string;
  title: string;
  topic: string | null;
  messageCount: number;
  endedAt: string | null;
  updatedAt: string;
}

export function PastSessions({ sessions }: { sessions: readonly PastVoiceSession[] }) {
  if (sessions.length === 0) return null;

  return (
    <section className="w-full space-y-2">
      <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <History className="size-3.5" aria-hidden />
        Your past conversations
      </h2>

      <ul className="space-y-1.5">
        {sessions.map((item) => (
          <li key={item.id}>
            <Link
              href={`/conversation/${item.id}`}
              className="hover:bg-muted focus-visible:outline-ring flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.topic ?? item.title}</p>
                <p className="text-muted-foreground text-xs">
                  {new Date(item.endedAt ?? item.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="muted">{item.messageCount} turns</Badge>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
