export { when, whenDate, whenShort, iso, DISPLAY_TIME_ZONE } from "./time";

export const money = (v: unknown, cents = false) => {
  const n = Number(v ?? 0);
  return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
};
export const num = (v: unknown) => Number(v ?? 0).toLocaleString("en-US");
export const pct = (v: unknown, d = 1) => `${Number(v ?? 0).toFixed(d)}%`;

/** Today's date as YYYY-MM-DD in the display time zone (the agency's working day). */
/** January 1 of the agency's current year. */
export const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;

export function todayISO(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: process.env.DISPLAY_TZ || "America/New_York" });
}
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Whole days from `a` to `b` (both YYYY-MM-DD or Date). */
export function daysBetween(a: string | Date, b: string | Date): number {
  const d = (x: string | Date) => (typeof x === "string" ? new Date(`${x.slice(0, 10)}T12:00:00Z`) : new Date(`${x.toISOString().slice(0, 10)}T12:00:00Z`));
  return Math.round((d(b).getTime() - d(a).getTime()) / 86_400_000);
}
/** A pg date column (Date at UTC midnight or string) as YYYY-MM-DD. */
export function isoDate(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const plural = (n: number, w: string, p = `${w}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? w : p}`;
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
