# Deployment

Flua is a standard Next.js 16 application with a PostgreSQL database. It deploys anywhere
Next.js runs, but platforms differ in ways that matter here — particularly around
streaming and function timeouts.

## Before you start

- A PostgreSQL 14+ database (Neon, Supabase, Railway, RDS…)
- At least one AI provider API key
- A generated `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

Use a **different** secret in production from development. Rotating it invalidates every
session, which is the intended behaviour if a secret leaks.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Use the **pooled** string for serverless |
| `AUTH_SECRET` | **Yes** | ≥ 32 chars, unique per environment |
| `NEXT_PUBLIC_APP_URL` | Recommended | Your real domain, e.g. `https://flua.example.com` |
| `GEMINI_API_KEY` | No | At least one provider is needed for AI features |
| `GROQ_API_KEY` | No | **Required for Speaking mode** |
| `OPENROUTER_API_KEY` | No | Tertiary fallback |
| `PRIMARY_AI_PROVIDER` | No | Default `gemini` |
| `SECONDARY_AI_PROVIDER` | No | Default `groq` |
| `TERTIARY_AI_PROVIDER` | No | Default `openrouter` |
| `AI_REQUEST_TIMEOUT_MS` | No | Keep **below** your platform's function timeout |
| `AI_MAX_ATTEMPTS_PER_PROVIDER` | No | Default `2` |
| `ADMIN_EMAILS` | No | Comma-separated. Empty means nobody can open `/admin` |
| `LOG_LEVEL` | No | `info` or `warn` in production |

`NODE_ENV=production` is set by the platform; it's what makes session cookies `Secure`.

Set these as **secrets** in your platform's dashboard, never in a committed file. `.env*`
is git-ignored.

## Deploying to Vercel

1. Push the repository to GitHub and import it into Vercel.
2. Add every environment variable above under **Settings → Environment Variables**.
3. Leave the build command as the default — `npm run build` already runs
   `prisma generate` first.
4. Apply migrations against the production database:

```bash
DATABASE_URL="<production direct url>" npm run db:migrate:deploy
```

Use the **direct** (non-pooled) URL for migrations — they need a session-level connection.
Run this before or immediately after the first deploy; migrations are deliberately not part
of the build, so a schema change can't be applied by an accidental redeploy.

5. Deploy.

Vercel notes:

- Streaming works on the Node runtime, which these route handlers use.
- `/api/ai/speaking/transcribe` sets `maxDuration = 60`. Hobby-plan functions cap at 60s;
  transcription of a long recording can approach that.
- Set `AI_REQUEST_TIMEOUT_MS` below your function timeout, or the platform will kill the
  request before the app's own timeout produces a friendly error.

## Other platforms

**Railway / Render / Fly.io** — run as a long-lived Node process:

```bash
npm ci && npm run build
npm run start
```

These suit Flua well: a persistent process means the in-memory rate limiter behaves as a
single coherent budget, which it does not on serverless.

**Docker** — no Dockerfile is included, but a standard Node 20 image with
`npm ci`, `npm run build`, `npm run start` works. Set `output: "standalone"` in
`next.config.ts` for a smaller image.

**Platform caveats worth checking before committing:**

| Feature | What to verify |
| --- | --- |
| Streaming | Some platforms buffer responses, which breaks progressive chat rendering. The app sets `X-Accel-Buffering: no` for nginx-style proxies. |
| Function timeout | Must exceed `AI_REQUEST_TIMEOUT_MS`, and comfortably exceed it for transcription. |
| Body size limit | Audio uploads are capped at 10 MB by the app; the platform limit must be higher. |
| Rate limiting | In-process. See below. |

Not every host supports every feature identically — test streaming and transcription on
your chosen platform before relying on them.

## Database

Use the **pooled** connection string for serverless. Neon and Supabase both provide one
(Neon's contains `-pooler`). Without pooling, many short-lived function instances exhaust
the connection limit.

Migrations need the **direct** string.

```bash
# Deploy migrations
DATABASE_URL="<direct url>" npm run db:migrate:deploy
```

Never run `db:push` or `db:seed` against production — the first bypasses migration history,
the second creates a demo account with a published password.

## Rate limiting

The limiter in `src/lib/rate-limit/` keeps counters **in process memory**. This is a
deliberate MVP tradeoff, and it has a real consequence:

> On serverless, each instance keeps its own counters. With N warm instances, a user's
> effective limit is up to N times the configured value.

Provider quotas are the backstop, so this is safe rather than merely tolerable. If you need
strict global limits, back the same interface with Redis — `checkRateLimit` is the only
function to reimplement.

## Post-deploy checks

```bash
curl https://your-domain.com/api/health
```

```json
{
  "status": "ok",
  "checks": { "config": true, "database": true, "aiProviderConfigured": true }
}
```

`status` is `degraded` when the database is fine but no AI provider is configured — the app
genuinely still runs in that state, so the probe doesn't fail.

Then verify by hand:

- [ ] Register an account and complete onboarding
- [ ] Start a conversation and confirm the reply **streams** rather than appearing at once
- [ ] End the session and confirm feedback generates
- [ ] Save a vocabulary word and review it
- [ ] Submit a piece of writing
- [ ] Record in Speaking mode (needs `GROQ_API_KEY`)
- [ ] Open `/admin` with an `ADMIN_EMAILS` address and check provider status
- [ ] Confirm `/admin` 404s for a non-admin account

## Operating it

**`/admin`** shows provider configuration, 24-hour request counts, failure and failover
counts, token usage, latency, and recent provider events. Since Flua targets free tiers,
this is where you notice a quota running out.

**Logs** are single-line JSON. API keys, passwords, tokens and learner conversation content
are redacted by the logger. Each request carries a `requestId`, echoed in the
`X-Request-Id` response header — that's how you connect a user's error report to a log line.

**Rotating a secret:** changing `AUTH_SECRET` signs everyone out. Changing an AI key takes
effect on the next process start; until then the old client instance persists.

## Troubleshooting production

**"Flua is not configured correctly"** — a required variable is missing. The startup log
names it.

**Streaming arrives all at once** — a proxy is buffering. Check your platform's streaming
support.

**Transcription times out** — the function timeout is below what transcription needs. Raise
it, or lower `AI_REQUEST_TIMEOUT_MS` so the app fails gracefully first.

**"Too many connections"** — use the pooled connection string.

**`/admin` 404s for you** — your email isn't in `ADMIN_EMAILS`. This is intentional; a 403
would confirm the page exists.

**AI failing after working previously** — check `/admin` events. `quota_exceeded` means a
free tier ran out; adding a second provider key restores service via failover.
