# AI providers

How Flua talks to AI vendors, how it fails over between them, and how to add a new one.

## The rule

**Nothing outside `src/lib/ai/providers/` knows which vendor is being used.** Feature code
asks the `AIService` for a *task*; the service resolves a provider and model. When a vendor
changes its API, exactly one file changes.

## Configured providers

| Provider | Capabilities | Role | Env var |
| --- | --- | --- | --- |
| **Gemini** | TEXT, STREAMING, STRUCTURED_OUTPUT, VISION | Primary | `GEMINI_API_KEY` |
| **Groq** | TEXT, STREAMING, STRUCTURED_OUTPUT, **SPEECH_TO_TEXT** | Secondary | `GROQ_API_KEY` |
| **OpenRouter** | TEXT, STREAMING, STRUCTURED_OUTPUT | Tertiary | `OPENROUTER_API_KEY` |

Groq is the only source of speech-to-text, which is why Speaking mode is explicitly marked
unavailable without it rather than silently failing.

## Getting keys

### Gemini

1. <https://aistudio.google.com/apikey> → create an API key
2. `GEMINI_API_KEY="…"`

Free tier in Google AI Studio, with per-minute and per-day request limits.

### Groq

1. <https://console.groq.com/keys> → create an API key
2. `GROQ_API_KEY="…"`

Free tier is rate-limited per minute and per day. Inference is very fast, and Whisper
transcription is included.

### OpenRouter

1. <https://openrouter.ai/keys> → create an API key
2. `OPENROUTER_API_KEY="…"`

Flua uses `:free` model routes. These are capacity-shared, so 429s are routine — which is
exactly why OpenRouter sits last in the chain, as a backstop rather than a workhorse.

> **On free tiers.** All three offer them, and Flua is built to stay inside them. They are
> not unlimited and change without notice. Check each provider's dashboard for current
> limits, and watch `/admin` for your real usage.

## The model registry

`src/lib/ai/registry.ts` is the **only** file containing model identifiers.

```ts
{
  provider: "gemini",
  modelId: "gemini-2.0-flash",
  label: "Gemini 2.0 Flash",
  capabilities: ["TEXT", "STREAMING", "STRUCTURED_OUTPUT", "VISION"],
  costTier: "standard",
  contextTokens: 1_000_000,
  priority: 10,
}
```

Registered models:

| Provider | Model | Tier | Used for |
| --- | --- | --- | --- |
| gemini | `gemini-3.5-flash-lite` | standard + light | Everything (see below) |
| gemini | `gemini-3.5-flash` | premium | Registered, but no task routes here |
| groq | `openai/gpt-oss-120b` | standard | Conversation, analysis |
| groq | `openai/gpt-oss-20b` | light | Drills, summaries |
| groq | `whisper-large-v3-turbo` | light | Transcription |
| openrouter | `liquid/lfm-2.5-2.6b:free` | standard | Fallback |
| openrouter | `google/gemma-4-31b-it:free` | light | Last-resort fallback |

All verified against live keys.

### Why Flash Lite, not Flash

Counter-intuitively, the *smaller* Gemini model is the primary. The free-tier quotas
decide it:

| Model | RPM | Requests/day |
| --- | --- | --- |
| `gemini-3.5-flash` | 5 | **20** |
| `gemini-3.5-flash-lite` | 15 | **500** |

One conversation plus its feedback and memory extraction is roughly eight requests, so
Flash alone would be exhausted after two sessions.

Quality is not the tradeoff it looks like. Flash Lite returns complete, natural replies
and accurate structured analysis. Flash *thinks* before answering — in testing it spent
380 reasoning tokens and still produced a truncated reply, because Flua's short tutoring
turns cap `maxOutputTokens` low. Flash stays registered at `premium` for future use, but
no task routes to it.

Selection prefers the task's cost tier, then lowest `priority`. If a provider has no model
with the required capability, `selectModelForTask` returns `null` and the provider is
skipped entirely.

> **Model IDs go stale.** Providers retire models on their own schedule — a request for a
> withdrawn model comes back as a 404, which Flua classifies as `model_unsupported` and
> fails over. If every provider 404s, the fix is to update this registry, and nothing else.
> The Gemini entries above are verified working; the Groq and OpenRouter entries have not
> been exercised against a live key, and OpenRouter rotates its `:free` catalogue
> especially often — check <https://openrouter.ai/models?q=free> if one 404s.

### Thinking models

Some models spend output tokens on internal reasoning *before* producing visible text. With
a small `maxOutputTokens` the entire budget can go to reasoning, and the reply arrives
truncated or empty — with a `MAX_TOKENS` finish reason and no error.

`ModelDefinition.thinkingBudget` handles this. Flua's tutoring calls want short,
conversational replies rather than extended reasoning, so thinking is disabled where the
model supports it:

| Model | Setting | Why |
| --- | --- | --- |
| `gemini-3.5-flash` | `thinkingBudget: 0` | Thinks by default; would consume the reply budget |
| `gemini-3.5-flash-lite` | *unset* | Doesn't think by default, and **rejects an explicit `0`** as an invalid argument |

The distinction matters: omitting the field is not the same as sending zero. When adding a
thinking model, check both behaviours before setting the field.

## Failover

### Classification

`src/lib/errors.ts` classifies every failure into an `AIErrorKind`, and two sets decide
what happens:

| Kind | Retry same provider | Fail over | Rationale |
| --- | --- | --- | --- |
| `rate_limit` | ✅ backoff | ✅ | Transient |
| `quota_exceeded` | ❌ | ✅ | Won't recover soon; another provider might work |
| `timeout` | ✅ | ✅ | Transient |
| `network` | ✅ | ✅ | Transient |
| `server_error` | ✅ | ✅ | Transient |
| `auth` | ❌ | ✅ | Our key is bad; another provider's may not be |
| `auth` **detected in a 400 body** | ❌ | ✅ | See "Auth failures aren't always 401" below |
| `model_unsupported` | ❌ | ✅ | This provider can't; another may |
| `invalid_request` | ❌ | ❌ | **Our bug — every provider fails identically** |
| `content_filtered` | ❌ | ❌ | **The content is the problem** |
| `parse_error` | ❌ | ❌ | Surfaced as a controlled error |

The last three are the important ones. Failing over on a malformed request would multiply
one bug into three wasted requests against three free tiers.

Distinguishing `rate_limit` from `quota_exceeded` needs care: providers overload HTTP 429
for both. `classifyHttpStatus` inspects the response body for quota language
(`quota`, `insufficient`, `credit`, `billing`) to tell "slow down" from "you're out".

#### Auth failures aren't always 401

Gemini returns **HTTP 400 `INVALID_ARGUMENT`** for an invalid API key, not 401. Classified
on status alone that becomes `invalid_request`, which by design stops the whole route — so
a single bad key would take the app down even with two healthy providers configured. This
was a real bug, caught by testing failover with a deliberately broken key.

`classifyHttpStatus` therefore also checks the body for credential-specific phrasing
(`api key not valid`, `api_key_invalid`, `unauthenticated`, …) and classifies those as
`auth` regardless of status. The phrase list is deliberately narrow: matching too loosely
would fail over on our own malformed requests and burn every provider's quota to fail
three times.

### The sequence

```
Gemini  attempt 1 → 429 rate limit
        (backoff ~500ms + jitter)
        attempt 2 → 429 again
        ↓ fail over
Groq    attempt 1 → ✓ success
```

Attempts per provider come from `AI_MAX_ATTEMPTS_PER_PROVIDER` (default 2). Backoff is
exponential with jitter, capped at 4s — or the provider's `Retry-After` header when it
sends one, capped at 8s. Retries are never infinite.

If every provider fails, `AllProvidersFailedError` produces a friendly message. The user
never sees a provider name, a stack trace, or a retry countdown.

### Streaming

Failover is impossible once bytes have reached the browser. `AIService.streamText` pulls
the first chunk internally, so:

- **Failure before the first chunk** → transparent failover; the user sees nothing.
- **Failure mid-stream** → the partial text is kept and saved, and an error frame follows.
  Losing a half-written reply would be worse than showing it.

### Capability gating

A provider is only ever tried if it declares the required capability *and* has a model for
the task. Concretely: a transcription request is never sent to Gemini. With only Gemini
configured, Speaking mode reports itself unavailable rather than failing at request time.

## Telemetry

Every attempt is recorded.

`AIUsage` — user, provider, model, request type, capability, input/output tokens, latency,
success, whether failover triggered, which providers were attempted, error kind.

`AIProviderEvent` — sanitized provider-level events: successes after failover, rate limits,
quota exhaustion, auth errors, timeouts, parse failures, and total failures.

Both are visible at `/admin` (restricted to `ADMIN_EMAILS`). Telemetry writes are
fire-and-forget: losing a usage row is acceptable, failing a lesson because the metrics
table is unhappy is not.

---

## Live voice

Voice conversation is a different shape from the rest of the AI surface: a long-lived
bidirectional session rather than a request that returns. It therefore has its own
contract in `src/lib/ai/voice/types.ts` (`VoiceProvider`), with the same rule — only
`src/lib/ai/voice/providers/` names a vendor.

| | |
| --- | --- |
| Provider | `gemini-live` |
| Model | `gemini-2.5-flash-native-audio-latest` |
| API version | `v1alpha` (required for ephemeral tokens) |
| Audio in | 16 kHz mono PCM16 |
| Audio out | 24 kHz mono PCM16 |
| Free tier | Unlimited RPM/RPD at time of writing — far more generous than the text models |

### The token model

`POST /api/ai/voice/session` mints a credential with three properties that together make
it safe to hand to a browser:

- **Single-use** (`uses: 1`) — a replayed token is rejected.
- **Short-lived** — valid for 90 minutes, and the session must *start* within 2 minutes.
- **Constrained** (`liveConnectConstraints`) — the model, response modality and the
  tutor's system instruction are baked in. The client cannot swap the model or replace the
  prompt, so prompt injection is structurally impossible from the browser.

The browser then connects straight to Google. That keeps latency to one hop and means the
real `GEMINI_API_KEY` never leaves the server.

### Session length

Left alone, an audio session ends abruptly after roughly ten minutes: audio consumes
context tokens quickly, and once the window fills the server simply hangs up — mid-sentence,
from the learner's point of view.

`contextWindowCompression` removes that ceiling. A sliding window is declared in the token
constraints, so when the conversation reaches the trigger the oldest turns are dropped and
the session continues instead of ending. The cost is memory rather than time: past the
window the model no longer recalls how the conversation opened. For tutoring that is a fair
trade — the full transcript is held client-side and is what end-of-session feedback reads,
so nothing is lost from the learner's record.

### No failover

Neither Groq nor OpenRouter offers an equivalent bidirectional speech API, so voice has no
fallback chain. When Gemini is unconfigured or unavailable the Talk page says so plainly
and the rest of the app is unaffected. Adding a second voice provider means implementing
`VoiceProvider` and registering it in `voice-service.ts` — no UI or feature code changes.

## Adding a provider

A worked example: adding Anthropic. No conversation, grammar, writing or vocabulary code
changes.

### 1. Write the adapter

`src/lib/ai/providers/anthropic.ts`:

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { toProviderError, withTimeout, parseStructured } from "@/lib/ai/providers/shared";
import type { AIProvider, AICapability, /* … */ } from "@/lib/ai/types";

const PROVIDER_NAME = "anthropic";

const CAPABILITIES: ReadonlySet<AICapability> = new Set([
  "TEXT", "STREAMING", "STRUCTURED_OUTPUT", "VISION",
]);

export class AnthropicProvider implements AIProvider {
  constructor(private options: { apiKey: string | undefined; timeoutMs: number }) {}

  getProviderName() { return PROVIDER_NAME; }
  getCapabilities() { return { supports: CAPABILITIES }; }
  isConfigured() { return Boolean(this.options.apiKey); }

  async generateText(request) {
    const { signal, cleanup } = withTimeout(this.options.timeoutMs, request.signal);
    try {
      // …call the SDK, map the response to GenerateTextResult
    } catch (error) {
      throw toProviderError(PROVIDER_NAME, error, request.model);
    } finally {
      cleanup();
    }
  }

  // generateStructured, streamText, classify …
  // transcribeAudio is omitted — SPEECH_TO_TEXT isn't declared.
}
```

The helpers in `providers/shared.ts` do the heavy lifting: `toProviderError` classifies any
thrown value into the taxonomy, `withTimeout` composes an abort signal with a deadline, and
`parseStructured` extracts and validates JSON.

### 2. Add the environment variable

`src/lib/config/env.ts`:

```ts
const providerNameSchema = z.enum(["gemini", "groq", "openrouter", "anthropic"]);

const envSchema = z.object({
  // …
  ANTHROPIC_API_KEY: optionalSecret,
});
```

Use `optionalSecret` — a missing key must never prevent the app from booting.

### 3. Register it

`src/lib/ai/types.ts`:

```ts
export const PROVIDER_IDS = ["gemini", "groq", "openrouter", "anthropic"] as const;
```

`src/lib/ai/provider-manager.ts`:

```ts
providers.set("anthropic", new AnthropicProvider({
  apiKey: env.ANTHROPIC_API_KEY,
  timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
}));
```

### 4. Declare its models

`src/lib/ai/registry.ts`:

```ts
{
  provider: "anthropic",
  modelId: "claude-sonnet-5",
  label: "Claude Sonnet 5",
  capabilities: ["TEXT", "STREAMING", "STRUCTURED_OUTPUT", "VISION"],
  costTier: "standard",
  contextTokens: 200_000,
  priority: 10,
},
```

### 5. Configure

```
ANTHROPIC_API_KEY="sk-ant-…"
PRIMARY_AI_PROVIDER="anthropic"
```

Done. The new provider participates in routing, failover, retries and telemetry
immediately, and appears on `/admin`.

### Checklist

- [ ] Implements every non-optional `AIProvider` method
- [ ] `isConfigured()` returns false without a key — never throws
- [ ] All errors pass through `toProviderError` so they land in the taxonomy
- [ ] `withTimeout` wraps every call, with `cleanup()` in a `finally`
- [ ] Capabilities match reality — declaring `SPEECH_TO_TEXT` without implementing
      `transcribeAudio` is caught at runtime, but shouldn't happen
- [ ] Empty responses raise `content_filtered` rather than returning `""`
- [ ] No key material is logged
