# Database

PostgreSQL via Prisma 7. Schema: [`prisma/schema.prisma`](../prisma/schema.prisma).

## Prisma 7 configuration

Prisma 7 removed the connection URL from `schema.prisma`. Two things now supply it:

- **The CLI** (`migrate`, `studio`, `db push`) reads `prisma.config.ts`.
- **The runtime client** builds a `@prisma/adapter-pg` driver adapter in
  `src/lib/db/client.ts`.

The datasource block therefore declares only the provider:

```prisma
datasource db {
  provider = "postgresql"
}
```

The generated client is written to `src/generated/prisma` (git-ignored, and excluded from
linting) rather than into `node_modules`.

The client is cached on `globalThis` in development, because Next.js re-evaluates modules
on every hot reload and would otherwise leak a connection pool each time.

## Design principles

**Cascade from `User`.** Every learner-owned table has a cascading foreign key, so deleting
an account removes everything it owns in one statement.

**Soft-delete only where recovery is expected.** `deletedAt` exists on `Conversation`,
`VocabularyItem` and `WritingSubmission` — content a learner might want back. Analytics
rows are hard-deleted with the user; keeping orphaned metrics for a deleted account would
be both useless and a privacy problem.

**Index for the queries that actually run.** Reads are dashboard-shaped — "everything for
this user, recently" — so indexes are composite on `(userId, …)`, which is also what makes
ownership filtering cheap.

**Aggregate what would otherwise be scanned.** `GrammarTopicStat` maintains rolling
per-category accuracy so the dashboard never aggregates the full mistake history.

## Tables

### Identity

**`User`** — email (unique), bcrypt hash, name, `lastLoginAt`.

**`PasswordResetToken`** — tokens stored as **SHA-256 digests**, so a database leak can't
be replayed into account takeover. Single-use (`usedAt`) and expiring (`expiresAt`).

**`Profile`** — one per user, created in the same transaction as the account so every
downstream read can assume it exists.

The important distinction here:

| Field | Meaning |
| --- | --- |
| `selfAssessedLevel` | What the learner said during onboarding |
| `estimatedLevel` | What the system concluded from evidence |
| `levelScore` | Continuous 0-100, so progress shows *between* bands ("B1 → B1+") |
| `levelConfidence` | 0-1, surfaced in the UI — an early estimate says so |

These are never conflated. Learners routinely mis-estimate themselves, and a system that
trusted the self-assessment would mis-pitch every lesson that followed.

**`LearningGoal`** — onboarding goals, one flagged `isPrimary`.

### Conversations

**`Conversation`** — mode, topic, and the fields that bound prompt size:

| Field | Purpose |
| --- | --- |
| `summary` | Rolling summary of turns outside the live window |
| `summarizedThrough` | Sequence number already folded into `summary` |
| `messageCount` | Denormalized so pagination needn't count rows |
| `feedback` | Session feedback, cached so reopening costs no AI call |

**`ConversationMessage`** — `@@unique([conversationId, sequence])` gives a stable ordinal
for summarization windows, independent of timestamps. Carries `provider`/`model`/`latencyMs`
for debugging a bad reply.

### Grammar

**`GrammarMistake`** — original text, correction, category slug, explanation, severity, and
the source (`conversation` | `writing` | `speaking` | `practice`). Conversation, writing and
speaking errors all land here, so a single weakness picture drives the daily plan.

**`GrammarTopicStat`** — `@@unique([userId, category])`. Rolling attempts, correct count,
accuracy, plus `previousAccuracy` snapshotted before each update. That one extra column is
what lets the UI show a trend arrow without keeping a time series per category.

### Vocabulary

**`VocabularyItem`** — `@@unique([userId, word])`, which makes saving idempotent and lets a
previously deleted word return with its review history intact.

Full SM-2 state is stored:

| Field | Meaning |
| --- | --- |
| `easeFactor` | Starts 2.5, floors at 1.3 |
| `intervalDays` | Days until next review |
| `repetitions` | Consecutive successes |
| `dueAt` | Indexed with `(userId, deletedAt, dueAt)` for the due query |

Storing the complete algorithm state — rather than just `dueAt` — means FSRS or another
scheduler can replace SM-2 without a migration.

**`VocabularyReview`** — one row per review. `responseMs` is a useful retention signal.

### Practice

**`PracticeSession`** — `@@unique([userId, planDate])` with `planDate` as a `DATE` at UTC
midnight, giving exactly one plan per learner per day and making concurrent creation safe:
a race loses on insert and re-reads the winner's row.

**`PracticeActivity`** — ordered activities with a JSON `payload` for drill content.

### Writing and speaking

**`WritingSubmission`** — content plus the full JSON `analysis`, with headline scores
copied into columns so the progress engine can read them without parsing JSON.

**`SpeakingSession`** — stores the **transcript only**. Audio is never persisted, which
keeps the privacy story simple and avoids needing a blob store.

### Memory

**`LearnerMemory`** — curated long-term facts, capped at 30 active per learner.

`reinforcementCount` increments when the same insight is observed again, which both raises
its prompt priority and avoids near-duplicate rows. Surplus memories are **retired**
(`retiredAt`) rather than deleted, so the decision is auditable.

### Progress and telemetry

**`ProgressSnapshot`** — `@@unique([userId, date])`, one row per day. Trend charts read this
small indexed table instead of aggregating history on every page view.

**`AIUsage`** — per-request telemetry: provider, model, tokens, latency, success, whether
failover fired, which providers were attempted, error kind.

**`AIProviderEvent`** — sanitized provider events. `message` never contains keys or learner
content.

## Migrations

```bash
npm run db:migrate           # development: create and apply
npm run db:migrate:deploy    # production: apply existing migrations only
npm run db:push              # prototyping only — no migration history
```

The initial migration is `prisma/migrations/20260909000000_init/migration.sql`, generated
with `prisma migrate diff` and covering all 18 tables, 12 enums and their indexes.

After changing `schema.prisma`:

```bash
npm run db:migrate -- --name describe_your_change
```

Then commit the generated SQL. **Never edit an applied migration** — write a new one.

## Seeding

```bash
npm run db:seed
```

Creates `demo@flua.app` / `demo-password-123` with two weeks of progress snapshots,
vocabulary at various review stages, realistic grammar mistakes with corrections, a
conversation, a writing submission, a speaking session and learner memories.

The point is that empty states are hard to design against — the seed makes every screen
render something real. It deletes and recreates the demo user, so it's safe to re-run.

The password is a development fixture, documented in the README, and never used in
production.

## Hosted Postgres

Any PostgreSQL 14+ instance works. For hosted providers:

```
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
```

`sslmode=require` is not optional — hosted providers refuse the connection without it.

**Pooling matters for serverless.** Neon and Supabase both offer a pooled connection
string alongside the direct one. Use the **pooled** string for serverless deployments,
where many short-lived instances would otherwise exhaust the direct connection limit; use
the **direct** string for migrations, which need a session-level connection.

## Common issues

**`Can't reach database server`** — wrong `DATABASE_URL`, or the database isn't running.
Test with `psql "$DATABASE_URL" -c "SELECT 1"`.

**`The datasource property url is no longer supported`** — a Prisma 6-style schema. The URL
belongs in `prisma.config.ts` now.

**`PrismaClient is not configured to run in this environment`** — the driver adapter is
missing. Check `src/lib/db/client.ts` constructs `PrismaPg`.

**Types out of date after a schema change** — run `npm run db:generate`.

**Too many connections** — use the pooled connection string.
