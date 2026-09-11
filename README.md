# Flua — Personal AI English Tutor

Flua is an AI-powered English learning application. It behaves like a **conversation
partner** when you're talking, and like a **teacher** when you ask to be taught — and it
remembers what you find difficult, so tomorrow's practice targets today's mistakes.

It is built to run on **free AI provider tiers**, and to keep running when one of them
fails: every AI request goes through an internal service that can fail over between
Gemini, Groq and OpenRouter without a line of feature code changing.

---

## Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [AI provider setup](#ai-provider-setup)
- [How failover works](#how-failover-works)
- [Adding a new provider](#adding-a-new-provider)
- [Database](#database)
- [Project structure](#project-structure)
- [Security](#security)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

---

## What it does

| Mode | What it's for |
| --- | --- |
| **Talk** ⭐ | **Live voice conversation.** Press call once and speak — no button to hold. Flua replies out loud, you can interrupt it mid-sentence, and a transcript builds alongside. This is the core of the product. |
| **Chat** | The same conversation, typed, for when speaking aloud isn't practical. |
| **Teacher** | Ask "explain the present perfect" and get a structured lesson: plain explanation → rule → examples → common mistake → practice. |
| **Grammar** | 23 topics with lessons and drills. Your weakest areas are sorted to the top. |
| **Vocabulary** | Look up words, save them, and review them on an SM-2 spaced-repetition schedule. |
| **Writing** | Journal entries, emails, essays. Every correction is shown *with its reason*, and the natural rewrite comes last. |
| **Daily practice** | A plan generated from your own statistics — no AI call needed to decide what you should study. |
| **Progress** | Trends rather than false precision: "improving", "needs practice", not fake decimals. |

The core loop the app is built around:

```
Open app → see today's goal → press Call → speak out loud
  → Flua replies in voice, you interrupt freely → end the call
  → feedback appears → weaknesses recorded → tomorrow's practice adapts
```

### How live voice works

```
Browser  ──── microphone PCM ────►  Gemini Live API
   ▲                                      │
   │        short-lived grant             │  speech + transcripts
   │                                      ▼
Your server ◄──── transcript on completion ────
```

The server mints a **single-use, short-lived, capability-constrained token**; the browser
opens the WebSocket to Google directly with it. That means one network hop (low latency)
and your real `GEMINI_API_KEY` never reaches the client.

The tutor's system prompt, model and response modality are **locked into the token** at
mint time, so a learner cannot alter Flua's behaviour from the browser — the
prompt-injection boundary holds in voice exactly as it does in text.

Audio is never persisted. Only the transcript is saved, at the end of the call, which is
what lets spoken practice feed the same corrections → stats → daily-plan loop as typing.

---

## Architecture

The central rule: **nothing outside `src/lib/ai/providers/` knows which AI vendor is
being used.**

```
  UI (React)
     ↓  fetch
  Route handler          authenticate → rate limit → validate → delegate
     ↓
  Service                business logic, database, prompt assembly
     ↓
  AIService              retries, failover, usage tracking
     ↓
  ProviderManager        picks (provider, model) for the task
     ↓
  Provider adapter       Gemini │ Groq │ OpenRouter
```

Layers, and what each is allowed to do:

| Layer | Path | Responsibility |
| --- | --- | --- |
| UI | `src/app/**/page.tsx`, `src/features/**` | Rendering and interaction only. No business logic. |
| API | `src/app/api/**/route.ts` | Four steps: authenticate, rate limit, validate, call a service. Thin by design. |
| Services | `src/server/services/**` | All business logic, transactions and database access. |
| AI abstraction | `src/lib/ai/**` | Provider-agnostic contract, routing, failover, telemetry. |
| Prompts | `src/lib/ai/prompts/**` | The tutor's behaviour. Never inlined into route handlers. |
| Validation | `src/lib/validation/**`, `src/lib/ai/schemas.ts` | Zod schemas for every request and every AI response. |
| Data | `prisma/schema.prisma`, `src/lib/db/` | Schema and the client singleton. |

Further reading: [`docs/architecture.md`](docs/architecture.md),
[`docs/ai-providers.md`](docs/ai-providers.md), [`docs/database.md`](docs/database.md),
[`docs/prompts.md`](docs/prompts.md), [`docs/deployment.md`](docs/deployment.md).

---

## Requirements

- **Node.js 20+** (developed on 24.x)
- **PostgreSQL 14+** — local, Docker, or a hosted provider (Neon, Supabase, Railway…)
- At least one AI provider API key — all have free tiers. The app runs without any,
  and tells you what to configure.

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
#    Then edit .env — see "Environment variables" below.
#    Generate AUTH_SECRET with:  openssl rand -base64 32

# 3. Create the database schema
npm run db:migrate

# 4. (Optional) Seed a demo account with realistic history
npm run db:seed

# 5. Start
npm run dev
```

Open <http://localhost:3000>.

If you seeded, sign in with:

```
Email:    demo@flua.app
Password: demo-password-123
```

That account is a development fixture. It exists so the dashboard, progress charts and
vocabulary review have real data to render rather than empty states.

### Getting a database

The quickest route is a free hosted Postgres. On [Neon](https://neon.tech):

1. Create a project — it provisions a Postgres instance immediately.
2. Copy the connection string from the dashboard.
3. Put it in `.env`:

```
DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

`sslmode=require` is not optional for hosted providers — the connection is refused
without it.

Neon also offers a **pooled** connection string (its host contains `-pooler`). Use the
pooled one for serverless deployments, where many short-lived function instances would
otherwise exhaust the direct connection limit. For local development and for running
migrations, the direct string is correct.

Supabase, Railway and any other PostgreSQL 14+ instance work the same way.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier |
| `npm run db:migrate` | Apply migrations (development) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |

---

## Environment variables

Only the first two are required. **Every AI key is optional** — Flua boots, runs, and
explains what's missing rather than crashing.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string. |
| `AUTH_SECRET` | **Yes** | Signs session JWTs. Must be ≥ 32 characters. |
| `GEMINI_API_KEY` | No | Google Gemini. Text, streaming, structured output. |
| `GROQ_API_KEY` | No | Groq. Text, streaming, **and Whisper speech-to-text**. |
| `OPENROUTER_API_KEY` | No | OpenRouter. Last-resort text fallback. |
| `PRIMARY_AI_PROVIDER` | No | Default `gemini`. |
| `SECONDARY_AI_PROVIDER` | No | Default `groq`. |
| `TERTIARY_AI_PROVIDER` | No | Default `openrouter`. |
| `AI_REQUEST_TIMEOUT_MS` | No | Per-provider timeout. Default `45000`. |
| `AI_MAX_ATTEMPTS_PER_PROVIDER` | No | Attempts before failing over. Default `2`. |
| `ADMIN_EMAILS` | No | Comma-separated emails allowed into `/admin`. Empty means nobody. |
| `LOG_LEVEL` | No | `debug` \| `info` \| `warn` \| `error`. |
| `NEXT_PUBLIC_APP_URL` | No | Used for password-reset links and provider attribution. |

Configuration is validated at startup by `src/lib/config/env.ts`. If something required is
missing, the app tells you exactly which variable and why — it doesn't fail with a stack
trace.

---

## AI provider setup

You need **at least one**. Speaking mode additionally needs a provider with
speech-to-text, which today means Groq.

### Google Gemini — recommended primary

1. Go to <https://aistudio.google.com/apikey>
2. Create an API key
3. Set `GEMINI_API_KEY`

Model used: `gemini-3.5-flash-lite` for everything. The free tier allows 500 requests/day
against Flash's 20, and it returns complete replies where Flash spends its output budget
on internal reasoning. `gemini-3.5-flash` stays registered at the `premium` tier but no
task routes to it — see [`docs/ai-providers.md`](docs/ai-providers.md).

### Groq — recommended secondary, required for Speaking

1. Go to <https://console.groq.com/keys>
2. Create an API key
3. Set `GROQ_API_KEY`

Models used: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `whisper-large-v3-turbo`
for transcription. Groq is very fast, and is currently the only configured source of
speech-to-text — Speaking mode is unavailable without it.

### OpenRouter — optional tertiary

1. Go to <https://openrouter.ai/keys>
2. Create an API key
3. Set `OPENROUTER_API_KEY`

Uses `:free` model routes. These are capacity-shared, so rate limiting is common — which
is exactly why it sits last in the chain.

### About free tiers

All three providers offer free tiers, and Flua is designed to stay inside them: it uses
light models for cheap tasks, summarizes old conversation turns instead of resending
them, and answers from the database whenever an AI call isn't genuinely needed.

**Free tiers are not unlimited and can change without notice.** Check each provider's
current limits on their own dashboard. `/admin` shows your actual request counts,
token usage, latency and failover events.

### Running with only one provider

Everything works. With just `GEMINI_API_KEY` set:

- Conversation, Teacher, Grammar, Vocabulary, Writing, Progress — all work
- Speaking is **marked unavailable** with an explanation, rather than presented as a
  button that fails

---

## How failover works

Failure classification lives in `src/lib/errors.ts`. **Not every error triggers a
failover** — that distinction is the point.

| Failure | Retry same provider? | Try next provider? |
| --- | --- | --- |
| Rate limit (429) | Yes, with backoff | Yes |
| Quota exhausted | No | Yes |
| Timeout | Yes | Yes |
| Network error | Yes | Yes |
| Server error (5xx) | Yes | Yes |
| Bad API key (401/403) | No | Yes |
| Model unsupported (404) | No | Yes |
| **Invalid request (400)** | **No** | **No** — our bug; another provider fails identically |
| **Content filtered** | **No** | **No** — the content is the problem |
| **Malformed JSON** | **No** | **No** — surfaced as a controlled error |

The sequence for a text request:

```
Gemini  ─ attempt 1 ─ 429 rate limit
        └ attempt 2 ─ (after backoff) 429 again
                        ↓ fail over
Groq    ─ attempt 1 ─ success ✓
```

If everything fails, the user gets a plain, friendly message. No stack traces, no
provider names, no "please try again in 4.2 seconds".

Additional guarantees:

- **Capability routing.** A provider is only tried if it declares the required capability
  *and* has a registered model for the task. Speech-to-text is never sent to a
  text-only provider.
- **Streaming failover.** The first chunk is awaited internally, so a provider that fails
  before producing any output fails over invisibly. Once tokens are on the wire, failover
  is impossible — the partial reply is kept rather than discarded.
- **Bounded retries.** Exponential backoff with jitter, capped attempts. Never infinite.
- **Everything is recorded.** Provider, model, tokens, latency, success, failover, error
  kind — visible in `/admin`.

---

## Adding a new provider

No conversation, grammar, writing or vocabulary code changes. Five steps:

1. **Write the adapter** in `src/lib/ai/providers/anthropic.ts`, implementing the
   `AIProvider` interface from `src/lib/ai/types.ts`. Use the helpers in
   `providers/shared.ts` for error classification and JSON extraction.
2. **Add the key** to the schema in `src/lib/config/env.ts`.
3. **Register it** in `buildProviders()` in `src/lib/ai/provider-manager.ts`, and add its
   id to `PROVIDER_IDS` in `types.ts`.
4. **Declare its models** in `MODEL_REGISTRY` in `src/lib/ai/registry.ts`, with their
   capabilities and cost tier.
5. **Set the env var** and put it in the provider order.

That's it. The new provider immediately participates in routing and failover.
Worked example: [`docs/ai-providers.md`](docs/ai-providers.md).

---

## Database

PostgreSQL via Prisma 7. Full documentation: [`docs/database.md`](docs/database.md).

Core tables: `User`, `Profile`, `LearningGoal`, `Conversation`, `ConversationMessage`,
`GrammarMistake`, `GrammarTopicStat`, `VocabularyItem`, `VocabularyReview`,
`PracticeSession`, `PracticeActivity`, `WritingSubmission`, `SpeakingSession`,
`LearnerMemory`, `ProgressSnapshot`, `AIUsage`, `AIProviderEvent`, `PasswordResetToken`.

Notes:

- Every learner-owned row cascades from `User`, so deleting an account is complete.
- Soft deletion (`deletedAt`) only where a learner would expect to recover something:
  conversations, vocabulary, writing.
- `GrammarTopicStat` is a rolling aggregate, so the dashboard never scans the full
  mistake history.
- `VocabularyItem` stores complete SM-2 state (`easeFactor`, `intervalDays`,
  `repetitions`), so the scheduler can be replaced without a migration.

> **Prisma 7 note.** The connection URL is no longer read from `schema.prisma`. The CLI
> reads it from `prisma.config.ts`; the runtime client builds a `@prisma/adapter-pg`
> adapter in `src/lib/db/client.ts`.

---

## Project structure

```
src/
├── app/
│   ├── (auth)/              login, register, forgot/reset password
│   ├── (dashboard)/         the signed-in app
│   ├── api/                 route handlers
│   ├── onboarding/
│   └── layout.tsx, page.tsx, error.tsx, not-found.tsx
├── components/
│   ├── ui/                  design-system primitives
│   └── layout/              sidebar, mobile nav, theme toggle
├── features/                per-feature UI (conversation, grammar, …)
├── lib/
│   ├── ai/
│   │   ├── providers/       gemini.ts, groq.ts, openrouter.ts, shared.ts
│   │   ├── prompts/         one module per mode
│   │   ├── ai-service.ts    failover engine
│   │   ├── provider-manager.ts
│   │   ├── registry.ts      THE only place model IDs appear
│   │   ├── schemas.ts       Zod schemas for AI output
│   │   └── types.ts         the provider contract
│   ├── api/                 response envelope, guards
│   ├── auth/                sessions, password hashing
│   ├── learning/            grammar taxonomy, SM-2, placement test
│   ├── speech/              TTS abstraction, recorder hook
│   ├── validation/          request schemas
│   ├── config/env.ts        validated environment
│   ├── rate-limit/
│   ├── errors.ts
│   └── logger.ts
├── server/services/         all business logic
└── middleware.ts
```

---

## Security

- **API keys never reach the browser.** All AI calls go through server-side route
  handlers. No `NEXT_PUBLIC_` AI variables exist.
- **Passwords** are bcrypt-hashed (cost 12) and never logged. Login spends the same time
  on an unknown email as a known one, so account enumeration by timing doesn't work.
- **Sessions** are signed JWTs in `httpOnly`, `sameSite=lax`, `secure`-in-production
  cookies.
- **Authorization on every resource.** Loading another user's conversation returns *not
  found*, never *forbidden* — confirming existence would itself leak information.
- **Prompt injection** is structurally defended: system instructions, learner context and
  learner content occupy separate, labelled regions, learner text is wrapped in tags it
  cannot escape, and the model is explicitly told that tagged content is data.
- **Every input validated** with Zod, including length caps that bound prompt size.
- **Every AI response validated** with Zod before it touches the database.
- **Rate limiting** per user, per endpoint class, with tighter budgets for expensive calls.
- **Audio uploads** are MIME-checked, size-capped at 10 MB, and never persisted — only
  the transcript is stored.
- **Logs redact** keys, passwords, tokens and learner conversation content.
- **Errors are safe.** Stack traces never reach a response.

---

## Deployment

Full guide: [`docs/deployment.md`](docs/deployment.md).

Summary for Vercel:

1. Push the repository and import it.
2. Set every environment variable from the table above in the Vercel dashboard.
3. Use a pooled connection string for a serverless deployment (Neon and Supabase both
   provide one).
4. Run `npm run db:migrate:deploy` against the production database.
5. Deploy. `npm run build` runs `prisma generate` automatically.

Platform caveats worth knowing before you pick a host:

- **Streaming** works on Vercel's Node runtime; some platforms buffer responses, which
  breaks the progressive chat display.
- **Rate limiting is in-process.** Each serverless instance keeps its own counters, so
  effective limits scale with instance count. For strict global limits, back the
  interface in `src/lib/rate-limit/` with Redis.
- **Transcription** takes time. `/api/ai/speaking/transcribe` sets `maxDuration = 60`;
  check your platform's function timeout.

---

## Troubleshooting

**"Flua is not configured correctly"**
Required environment variables are missing. The server console lists exactly which ones.

**`Can't reach database server`**
`DATABASE_URL` is wrong or Postgres isn't running. Check with
`psql "$DATABASE_URL" -c "SELECT 1"`, or `docker ps` if you're using the container above.

**"No AI provider is configured"**
No API key is set. Add at least one; see [AI provider setup](#ai-provider-setup).

**Speaking mode says it's unavailable**
No configured provider supports speech-to-text. Add `GROQ_API_KEY`.

**Microphone doesn't work**
Browsers only allow microphone access over HTTPS or on `localhost`. Check the site
permissions in your browser settings.

**`/admin` returns 404**
Your email isn't in `ADMIN_EMAILS`. This is deliberate — a 403 would confirm the page
exists.

**AI responses fail immediately**
Open `/admin` and look at recent provider events. The classified error kind (`auth`,
`rate_limit`, `quota_exceeded`…) tells you whether it's a key problem or a limit.

**`AI_CAPABILITY_UNSUPPORTED` with a provider configured**
Usually a retired model. Providers withdraw models on their own schedule, and the request
comes back as a 404 that Flua classifies as `model_unsupported`. The server log names the
model and often the replacement. Update `src/lib/ai/registry.ts` — that's the only file
model IDs appear in.

**`AI_PROVIDER_UNAVAILABLE` intermittently**
Usually a genuine provider-side 503 ("high demand"). Flua retries with backoff and then
fails over — so the practical fix is configuring a second provider key, which turns an
outage into an invisible failover.

---

## Known limitations

Stated plainly, because pretending otherwise would be worse:

- **No automated test suite.** Testing frameworks were intentionally excluded at the
  project owner's request; verification is manual, alongside `npm run lint`,
  `npm run typecheck` and `npm run build`.
- **OpenRouter's free routes are unreliable by nature.** They share an upstream pool and
  return 429 frequently — which is precisely why OpenRouter is the *tertiary* provider.
  Treat it as a backstop, not a workhorse. Its `:free` catalogue also rotates, so a model
  id that works today may 404 later; the fix is a one-line registry update.
- **Password reset has no email transport.** The token flow is fully implemented and
  secure (hashed, single-use, expiring), but no mail provider is wired up. In development
  the link is shown on screen; in production the endpoint explains that email isn't
  configured. It does not pretend to have sent anything.
- **Rate limiting is per-instance.** See the deployment note above.
- **Live voice needs Gemini.** Voice conversation uses the Gemini Live API; Groq and
  OpenRouter have no equivalent, so there is no failover for voice. If Gemini is
  unavailable, the Talk page says so and the rest of the app carries on working.
- **Written feedback can't assess pronunciation.** The post-call feedback is generated
  from the transcript, so it covers grammar and word choice only. The prompt explicitly
  forbids it from commenting on how something sounded.
- **Level estimates are informal.** Flua's CEFR estimate is a guide for pitching lessons,
  with a stored confidence value shown in the UI. It is not an accredited assessment, and
  the app never claims it is.
- **Text-to-speech uses the browser's built-in voices**, which vary in quality by platform.
  The `TTSProvider` interface exists for adding a cloud voice later.
