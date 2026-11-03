// What a receipt will do, worded for its confirmation before it posts (UX-029). No server imports: the form runs this in the browser.
import { money } from "./format";

export type OpenInvoice = { id: number; number: string; balance: number };

const cents = (n: number) => Math.round(n * 100) / 100;
const METHOD: Record<string, string> = { check: "check", ach: "ACH", card: "card", wire: "wire", cash: "cash" };

/** The amount as the server action reads it: 0 when it isn't a number. */
export const parseAmount = (v: unknown) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;

/** The balance of the ticked invoices, or of every open one when none is ticked. */
export function fullBalance(invoices: OpenInvoice[], ticked: number[]) {
  return cents(invoices.filter((i) => !ticked.length || ticked.includes(i.id)).reduce((s, i) => s + i.balance, 0));
}

/** Follows createReceipt: the ticked invoices (or all), oldest first, until the money runs out; anything over becomes a credit. */
export function receiptConfirm({ amount, method, reference, client, invoices, ticked }: { amount: number; method: string; reference?: string; client: string; invoices: OpenInvoice[]; ticked: number[] }) {
  let left = cents(amount);
  const reached: string[] = [];
  for (const i of invoices) {
    if (left <= 0) break;
    if ((ticked.length && !ticked.includes(i.id)) || i.balance <= 0) continue;
    reached.push(i.number);
    left = cents(left - Math.min(i.balance, left));
  }
  const paid = `${money(amount, true)} ${METHOD[method] ?? method}${reference ? ` #${reference}` : ""} from ${client} to trust`;
  const names = reached.length > 6 ? `${reached.slice(0, 6).join(", ")} and ${reached.length - 6} more` : reached.length > 1 ? `${reached.slice(0, -1).join(", ")} and ${reached.at(-1)}` : reached[0];
  if (!reached.length) return `Post ${paid}? Nothing is open to apply it to, so all of it becomes a credit on the account.`;
  return `Post ${paid}, applied ${reached.length > 1 ? "oldest first " : ""}to ${names}?${left > 0 ? ` The ${money(left, true)} over what's owed becomes a credit on the account.` : ""}`;
}
