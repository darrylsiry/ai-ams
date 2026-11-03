/** "?a=1&b=2" from the current search params with overrides; empty and undefined values drop out, as do flash messages. */
export function qs(current: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): string {
  const merged: Record<string, string | undefined> = { ...current, msg: undefined, error: undefined, ...overrides };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "?";
}
