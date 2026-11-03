// Failed sign-in counting (SEC-013). In memory is enough for one machine; a restart forgets, which
// only ever gives a guesser a fresh minute. Pure module for node:test.

const WINDOW_MS = 60_000;
const LIMIT = 5;

const g = globalThis as unknown as { __amsFailures?: Map<string, number[]> };
const failures = (g.__amsFailures ??= new Map<string, number[]>());

const recent = (key: string, now: number) => (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

/** True once `key` has used up its failed attempts for the minute. */
export function isThrottled(key: string, now = Date.now()): boolean {
  return recent(key, now).length >= LIMIT;
}

/** Failures counted for `key` this minute. */
export function failureCount(key: string, now = Date.now()): number {
  return recent(key, now).length;
}

export function noteFailure(key: string, now = Date.now()): void {
  if (failures.size > 10_000) failures.clear();   // a flood of addresses must not grow this forever
  failures.set(key, [...recent(key, now), now]);
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
