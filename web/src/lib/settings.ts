import { db, one, type Queryable } from "./db";

// Workflow thresholds an agency can tune without a deploy (CR-025). Each caller passes today's value
// as the fallback, so a database that has never saved one behaves the same.

export async function getSetting<T>(key: string, fallback: T, on: Queryable = db): Promise<T> {
  const row = await one<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key], on);
  return row?.value ?? fallback;
}

export const DEFAULTS = {
  email_auto_action_confidence: 0.75,
  commission_variance: { dollars: 1, pct: 1 },
  automation_windows: { binder_days: 3, pending_cancel_days: 5, invoice_past_due_days: 10, claim_stale_days: 14 },
  // Whole PDFs can't be filtered, so these two stay off until an agency settles what may go to Anthropic (SEC-022).
  ai_assists: { email: true, policy_check: false, statement: false, account_qa: true, assistant: true },
};
