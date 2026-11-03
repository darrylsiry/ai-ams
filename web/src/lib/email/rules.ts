// Deterministic email classification: the fallback when no ANTHROPIC_API_KEY is configured, and
// the safety net when the AI call fails or declines. Pure module for node:test.

import { addDays } from "../format";

export type Classification = {
  activity_code: string;
  subject: string;
  summary: string;
  priority: "urgent" | "high" | "normal" | "low";
  due_in_days: number | null;      // null: use the activity code's default
  policy_number: string | null;
  requested_change: string | null;
  auto_reply: boolean;
  confidence: number;
};

type Rule = { code: string; patterns: RegExp[]; weight?: number; verb: string };

// Order matters only for ties: the first rule with the best score wins.
const RULES: Rule[] = [
  { code: "NONPAY", verb: "Resolve non-pay cancellation", weight: 3, patterns: [/non-?payment/i, /notice of (pending )?cancellation.*(premium|payment)/i, /past due.*cancel/i, /cancel.*for non-?pay/i] },
  { code: "UW-CANC", verb: "Respond to carrier notice", weight: 3, patterns: [/non-?renewal/i, /will not (be )?renew/i, /notice of cancellation/i, /conditional renewal/i] },
  { code: "CLAIM-FNOL", verb: "Report claim", weight: 2, patterns: [/\b(accident|collision|rear[- ]ended|was hit|fender bender)\b/i, /\b(stolen|theft|break[- ]?in|vandal)/i, /\b(water damage|pipe burst|leak(ing)?|flood(ed|ing)?|fire|smoke damage|hail|tree fell|roof damage)\b/i, /\b(injur(ed|y)|slip(ped)? and fell|fell on)\b/i, /file (a )?claim/i, /first notice of loss|fnol/i] },
  { code: "CLAIM-FU", verb: "Follow up on claim", patterns: [/claim (number|#|status)/i, /\badjust(er|or)\b/i, /status of (my|the|our) claim/i] },
  { code: "CERT-REQ", verb: "Issue certificate", weight: 2, patterns: [/certificate of insurance/i, /\bCOI\b/, /\bcert(ificate)?s? (holder|request|needed)/i, /additional insured/i, /waiver of subrogation/i, /primary (and|&) non-?contributory/i, /need (a|an|the) cert/i] },
  { code: "ID-CARD", verb: "Send auto ID cards", weight: 2, patterns: [/\bid cards?\b/i, /insurance cards?/i, /proof of (auto )?insurance/i] },
  { code: "CANC-REQ", verb: "Process cancellation request", weight: 2, patterns: [/please cancel/i, /\bcancel(l?ing)? (my |our |the |this )?(policy|insurance|coverage)\b/i, /\bneed to cancel\b/i, /want to cancel/i, /cancellation request/i, /sold (the|my|our) (house|home|car|truck|vehicle|boat|business)/i] },
  { code: "END-REQ", verb: "Process policy change", patterns: [/\badd(ing)? (a |my |our )?(vehicle|car|truck|driver|van|trailer|location|building)/i, /\b(remove|delete|replace) (a |my |our |the )?(vehicle|car|truck|driver)/i, /\bnew (car|vehicle|truck|address|location)\b/i, /(bought|purchased|traded in) (a|my|our)/i, /change (of|my|our) address|moved to|new address/i, /endorse(ment)?/i, /(increase|raise|lower|change) (my |our |the )?(limit|deductible|coverage)/i, /(lienholder|loss payee|mortgagee) (change|update)/i, /new (lender|mortgage company)/i, /\bVIN\b/] },
  { code: "BILL-INQ", verb: "Answer billing question", patterns: [/\b(invoice|bill(ing)?|statement)\b/i, /\bpayment\b/i, /\b(balance|amount due|autopay|auto-pay|refund|overcharged|charged twice)\b/i] },
  { code: "REN-REVIEW", verb: "Review renewal", patterns: [/\brenewal\b/i, /\brenew(ing)?\b/i, /premium (went up|increase|is higher)/i, /rate increase/i] },
  { code: "AUDIT", verb: "Handle premium audit", weight: 2, patterns: [/\baudit(or)?\b/i, /payroll (report|records)/i] },
  { code: "LOSS-RUN", verb: "Request loss runs", weight: 2, patterns: [/loss runs?/i, /loss history/i] },
  { code: "DOC-REQ", verb: "Send requested document", patterns: [/dec(laration)?s? page/i, /declarations/i, /copy of (my|our|the) policy/i, /send (me|us) (a copy|the policy)/i] },
  { code: "INSPECT", verb: "Handle inspection recommendations", weight: 2, patterns: [/inspection/i, /recommendations?/i, /loss control survey/i] },
  { code: "QUOTE", verb: "Prepare quote", patterns: [/\bquote\b/i, /looking for (insurance|coverage)/i, /need (insurance|coverage) for/i, /how much (would|to) (insure|cover)/i] },
];

const AUTO_REPLY = [/out of (the )?office/i, /auto(matic)?[- ]?reply/i, /away from (my|the) (desk|office)/i, /delivery status notification/i, /undeliverable/i];
const URGENT = [/\b(urgent|asap|immediately|right away|emergency)\b/i, /\b(today|this morning|by end of day|eod)\b/i, /closing (is )?(tomorrow|today|friday|monday)/i, /(can't|cannot) (start|begin) (the )?(job|work)/i, /job ?site/i];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Days until a deadline the sender named ("today", "tomorrow", "by Friday"), else null. */
export function deadlineDays(text: string, today: string): number | null {
  if (/\b(today|asap|immediately|this morning|by end of day|eod)\b/i.test(text)) return 0;
  if (/\btomorrow\b/i.test(text)) return 1;
  const m = /\bby (this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(text);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase());
    const now = new Date(`${today}T12:00:00Z`).getUTCDay();
    let d = (target - now + 7) % 7;
    if (d === 0) d = 7;
    if (m[1]?.toLowerCase().trim() === "next") d += 7;
    return d;
  }
  return null;
}

/** Policy-number-shaped tokens: letters/digits with at least four digits, 6-24 chars. */
export function policyNumberCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]\b/gi)) {
    const t = m[0].toUpperCase();
    if ((t.match(/\d/g) ?? []).length >= 4 && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !/^\d{3}-\d{3}-\d{4}$/.test(t)) out.add(t);
  }
  return [...out];
}

function summarize(text: string, max = 400): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > 120 ? cut.slice(0, stop + 1) : `${cut}…`);
}

/** Classify by keyword rules. `clientName` makes the generated subject specific. */
export function classifyByRules(subject: string, body: string, today: string, clientName?: string | null): Classification {
  const text = `${subject}\n${body}`;
  if (AUTO_REPLY.some((r) => r.test(subject))) {
    return { activity_code: "EMAIL-IN", subject: `Auto-reply: ${subject}`.slice(0, 90), summary: summarize(body), priority: "low", due_in_days: null,
      policy_number: null, requested_change: null, auto_reply: true, confidence: 0.9 };
  }
  let best: Rule | null = null, bestScore = 0;
  for (const r of RULES) {
    const hits = r.patterns.filter((p) => p.test(text)).length;
    const subjHits = r.patterns.filter((p) => p.test(subject)).length;
    const s = hits ? hits * (r.weight ?? 1) + subjHits * 2 : 0;
    if (s > bestScore) { best = r; bestScore = s; }
  }
  const code = best?.code ?? "EMAIL-IN";
  const urgent = URGENT.some((r) => r.test(text));
  const days = deadlineDays(text, today);
  const who = clientName ? ` for ${clientName}` : "";
  const cleanSubject = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return {
    activity_code: code,
    subject: (best ? `${best.verb}${who}` : `Review email${who}: ${cleanSubject}`).slice(0, 90),
    summary: summarize(body) || cleanSubject,
    priority: urgent ? (code === "EMAIL-IN" ? "high" : "urgent") : (best?.weight ?? 1) >= 3 ? "urgent" : "normal",
    due_in_days: days,
    policy_number: policyNumberCandidates(text)[0] ?? null,
    requested_change: code === "END-REQ" ? summarize(body, 160) : null,
    auto_reply: false,
    confidence: best ? Math.min(0.5 + bestScore * 0.1, 0.85) : 0.3,
  };
}

/** Due date for a classification: the sender's deadline, else the activity code's default. */
export function dueDateFor(c: Classification, defaultDays: number, today: string): string {
  return addDays(today, c.due_in_days ?? defaultDays);
}
