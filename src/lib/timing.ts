/**
 * Wall-clock helpers.
 *
 * `Date.now()` is impure, so React's compiler rightly objects to it appearing
 * anywhere it might run during render. Routing timing through these named
 * helpers keeps the intent obvious at call sites ("start a stopwatch", "read
 * elapsed time") and confines the impure call to one place.
 */

/** A running stopwatch, started at construction. */
export interface Stopwatch {
  /** Milliseconds since the stopwatch was started or last reset. */
  elapsedMs(): number;
  /** Restarts from now. */
  reset(): void;
}

export function createStopwatch(): Stopwatch {
  let startedAt = Date.now();

  return {
    elapsedMs: () => Date.now() - startedAt,
    reset: () => {
      startedAt = Date.now();
    },
  };
}
