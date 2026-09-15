/**
 * Live-session settings that BOTH the server and the browser must declare.
 *
 * The server bakes these into the ephemeral token's constraints, and the browser
 * repeats them when it opens the socket. That duplication is deliberate: a
 * config supplied at connect time can take the place of the constrained one
 * rather than merging with it, so anything declared on only one side can be
 * silently dropped. Keeping the values here means the two copies cannot drift
 * apart — which has already caused one real bug, where the language pin lived
 * only in the token and transcription quietly fell back to auto-detection.
 *
 * This module is imported by client code, so it must stay free of `server-only`
 * and of anything secret.
 */

/**
 * Language the learner's microphone is transcribed as.
 *
 * Left unset, the API auto-detects per utterance, and accented English is
 * regularly guessed as a different language — the transcript comes back as
 * another script entirely. That transcript is what end-of-session feedback
 * reads, so a bad guess doesn't just look wrong, it corrupts the feedback.
 *
 * Only the learner's input is pinned. The tutor's own speech stays on
 * auto-detect so she can say a word in another language when asked.
 */
export const VOICE_INPUT_LANGUAGE_CODES = ["en-US"];

/**
 * Terms the general speech model reliably mangles, biasing recognition toward
 * what learners of this app actually say. Kept short: every phrase is a small
 * nudge, and a long list dilutes all of them.
 */
export const VOICE_TRANSCRIPTION_VOCABULARY = [
  "Flua",
  "TypeScript",
  "JavaScript",
  "Next.js",
  "React",
  "Node.js",
  "Python",
  "Django",
  "Lighthouse",
  "CEFR",
];

/**
 * Context compression thresholds. These stop the context window filling; they
 * do not extend the provider's own limit on how long a session may run.
 */
export const VOICE_COMPRESSION_TRIGGER_TOKENS = "16000";
export const VOICE_COMPRESSION_TARGET_TOKENS = "8000";
