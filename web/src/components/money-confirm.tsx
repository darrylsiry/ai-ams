"use client";
import { useFormStatus } from "react-dom";
import { fullBalance, parseAmount, receiptConfirm, type OpenInvoice } from "@/lib/receipt-confirm";
import { money } from "@/lib/format";

/** The form's amount if everything on the form is valid and it is above zero; otherwise shows why and returns null. */
function validAmount(form: HTMLFormElement) {
  const input = form.elements.namedItem("amount") as HTMLInputElement;
  input.setCustomValidity("");
  if (!form.reportValidity()) return null;
  const amount = parseAmount(input.value);
  if (amount > 0) return amount;
  input.setCustomValidity("Enter an amount above zero.");
  form.reportValidity();
  return null;
}

/** Submit, but the confirmation is worded from what is on the form when it's clicked (UX-029). */
function ConfirmButton({ children, className, ask }: { children: React.ReactNode; className?: string; ask: (form: HTMLFormElement, amount: number) => string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} onClick={(e) => {
      const form = e.currentTarget.form!;
      const amount = validAmount(form);
      if (amount === null || !window.confirm(ask(form, amount))) e.preventDefault();
    }}>{pending ? "Working…" : children}</button>
  );
}

const tickedIn = (form: HTMLFormElement) => new FormData(form).getAll("invoice_ids").map(Number);

export function PostReceiptButton({ client, invoices, className }: { client: string; invoices: OpenInvoice[]; className?: string }) {
  return <ConfirmButton className={className} ask={(form, amount) => { const f = new FormData(form); return receiptConfirm({ amount, method: String(f.get("method")), reference: String(f.get("reference") ?? "").trim(), client, invoices, ticked: tickedIn(form) }); }}>Post receipt</ConfirmButton>;
}

export function SweepButton({ className }: { className?: string }) {
  return <ConfirmButton className={className} ask={(_, amount) => `Sweep ${money(amount, true)} from trust to operating?`}>Sweep</ConfirmButton>;
}

export function UseFullBalance({ invoices }: { invoices: OpenInvoice[] }) {
  return <button type="button" title="Fills in the balance of the ticked invoices, or of all of them when none is ticked" className="text-indigo-600 hover:underline" onClick={(e) => {
    const form = e.currentTarget.form!;
    (form.elements.namedItem("amount") as HTMLInputElement).value = fullBalance(invoices, tickedIn(form)).toFixed(2);
  }}>Use full balance</button>;
}
