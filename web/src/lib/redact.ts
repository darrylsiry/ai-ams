// Keeping personal identifiers out of places that outlive their need. Pure module for node:test.

const PII_KEYS = new Set(["dob", "date_of_birth", "drivers_license", "license", "license_number", "identifier", "year", "fein", "ssn"]);
const ITEM_PII_KEYS = new Set(["dob", "date_of_birth", "drivers_license", "license", "license_number", "ssn"]);
export const HIDDEN = "••••";

/**
 * A schedule item's details as they may be shown (SEC-023). On a driver the free-form "identifier" and
 * "year" fields hold a license number and a date of birth; on a vehicle they are a VIN and a model year.
 */
export function itemDetails(kind: string, data: Record<string, unknown>, pii: boolean): [string, unknown][] {
  const hide = (k: string) => !pii && (ITEM_PII_KEYS.has(k) || (kind === "driver" && (k === "identifier" || k === "year")));
  return Object.entries(data).filter(([, v]) => v !== null && v !== "").map(([k, v]) => [k.replace(/_/g, " "), hide(k) ? HIDDEN : v]);
}

/** A copy with the identifier columns masked, however deep: audit rows are append-only and forever (SEC-002). */
export function maskPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map(maskPii) as T;
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, PII_KEYS.has(k) ? (v == null ? v : "[changed]") : maskPii(v)])) as T;
}

/** Identifier-shaped text removed before a prompt leaves the agency (SEC-022). Whole PDFs can't be filtered this way. */
export function scrubText(text: string): string {
  return text
    .replace(/\b\d{3}[-\s.]\d{2}[-\s.]\d{4}\b/g, "[SSN removed]")
    .replace(/\b(SSN|social(?:\s+security)?(?:\s+(?:number|no\.?))?)(\s*(?:is|:|#|-|=)?\s*)\d{9}\b/gi, "$1 [removed]")
    .replace(/\b(FEIN|EIN|TIN|tax\s+id)(?:\s+(?:number|no\.?))?(\s*(?:is|:|#|-|=)?\s*)\d{2}[-\s]?\d{7}\b/gi, "$1 [removed]")
    .replace(/\b\d{2}-\d{7}\b/g, "[FEIN removed]")
    .replace(/\b(DOB|date of birth|birth ?date|born)\b(?:\s+(?:is|on))?\s*[:#-]?\s*(?:[\d/.-]{6,10}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/gi, "$1 [removed]")
    // Only a value with a digit in it: "drivers license renewal is due" says nothing identifying.
    .replace(/\b(driver'?s?\s+licen[sc]e|licen[sc]e|DL)\b(?:\s+(?:number|no\.?|is))*\s*[:#-]?\s*(?:[A-Z]{2}\s+)?(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,}/gi, "$1 [removed]");
}
