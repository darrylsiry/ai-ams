import { denied } from "@/components/gate";
import { codeAction, runAutomationAction, settingsAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { DEFAULTS, getSetting } from "@/lib/settings";
import { can, currentUser } from "@/lib/user";
import type { ActivityCode } from "@/lib/work";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const deny = await denied("admin", "settings", "administrator");
  if (deny) return deny;
  const sp = await searchParams;
  const u = await currentUser();
  const admin = can(u, "admin");
  const [agency, lead, remarket, last, codes] = await Promise.all([
    one<{ value: { name: string; address: string; phone: string; license: string } }>("SELECT value FROM settings WHERE key = 'agency'"),
    one<{ value: { personal: number; commercial_small: number; commercial_large: number; large_premium: number } }>("SELECT value FROM settings WHERE key = 'renewal_lead_days'"),
    one<{ value: number }>("SELECT value FROM settings WHERE key = 'remarket_threshold_pct'"),
    one<{ value: { ranOn: string; created: Record<string, number>; expired: number } }>("SELECT value FROM settings WHERE key = 'automation_last_result'"),
    // Inactive codes too, or a code switched off here could never be switched back on (UX-021).
    q<ActivityCode & { active: boolean }>("SELECT * FROM activity_codes ORDER BY category, label"),
  ]);
  const [confidence, variance, windows, waiting, assists] = await Promise.all([
    getSetting("email_auto_action_confidence", DEFAULTS.email_auto_action_confidence), getSetting("commission_variance", DEFAULTS.commission_variance),
    getSetting("automation_windows", DEFAULTS.automation_windows), getSetting("waiting_followup_days", { client: 3, carrier: 5, internal: 2, other: 3 }), getSetting("ai_assists", DEFAULTS.ai_assists),
  ]);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="Settings &amp; automation" subtitle={admin ? undefined : "Read only: settings need the administrator role."} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Agency and renewals" pad>
          <form action={settingsAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Agency name"><input name="agency_name" defaultValue={agency?.value.name} disabled={!admin} className={cls.input} /></Field>
            <Field label="Phone"><input name="agency_phone" defaultValue={agency?.value.phone} disabled={!admin} className={cls.input} /></Field>
            <Field label="Address" className="sm:col-span-2"><input name="agency_address" defaultValue={agency?.value.address} disabled={!admin} className={cls.input} /></Field>
            <Field label="Agency license"><input name="agency_license" defaultValue={agency?.value.license} disabled={!admin} className={cls.input} /></Field>
            <Field label="Remarket threshold (renewal increase %)"><input name="remarket" defaultValue={remarket?.value ?? 10} disabled={!admin} className={cls.input} /></Field>
            <Field label="Renewal lead days: personal"><input name="lead_personal" defaultValue={lead?.value.personal} disabled={!admin} className={cls.input} /></Field>
            <Field label="Renewal lead days: commercial"><input name="lead_commercial" defaultValue={lead?.value.commercial_small} disabled={!admin} className={cls.input} /></Field>
            <Field label="Lead days: large accounts"><input name="lead_large" defaultValue={lead?.value.commercial_large} disabled={!admin} className={cls.input} /></Field>
            <Field label="Large account premium ($)"><input name="large_premium" defaultValue={lead?.value.large_premium} disabled={!admin} className={cls.input} /></Field>
            <div className="border-t border-slate-100 pt-3 text-xs font-medium uppercase tracking-wide text-slate-500 sm:col-span-2">Thresholds</div>
            <Field label="Email auto-action confidence (0 to 1)"><input name="email_confidence" defaultValue={confidence} disabled={!admin} className={cls.input} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Commission variance ($)"><input name="variance_dollars" defaultValue={variance.dollars} disabled={!admin} className={cls.input} /></Field><Field label="or %"><input name="variance_pct" defaultValue={variance.pct} disabled={!admin} className={cls.input} /></Field></div>
            <Field label="Binder warning (days before)"><input name="binder_days" defaultValue={windows.binder_days} disabled={!admin} className={cls.input} /></Field>
            <Field label="Pending cancellation task (days before)"><input name="pending_cancel_days" defaultValue={windows.pending_cancel_days} disabled={!admin} className={cls.input} /></Field>
            <Field label="Past-due invoice task (days after due)"><input name="invoice_past_due_days" defaultValue={windows.invoice_past_due_days} disabled={!admin} className={cls.input} /></Field>
            <Field label="Stale claim follow-up (days)"><input name="claim_stale_days" defaultValue={windows.claim_stale_days} disabled={!admin} className={cls.input} /></Field>
            <div className="grid grid-cols-4 gap-2 sm:col-span-2">{(["client", "carrier", "internal", "other"] as const).map((k) => <Field key={k} label={`Chase ${k} (days)`}><input name={`wait_${k}`} defaultValue={waiting[k]} disabled={!admin} className={cls.input} /></Field>)}</div>
            <div className="border-t border-slate-100 pt-3 sm:col-span-2"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">Claude assists</div><p className="mt-1 text-xs text-slate-500">Each sends client data to Anthropic when an API key is set. Turn off any you don&apos;t want; the app falls back to its rules or manual entry.</p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">{([["ai_email", "email", "Email triage"], ["ai_policy_check", "policy_check", "Policy checking (whole PDFs)"], ["ai_statement", "statement", "Commission statements"], ["ai_account_qa", "account_qa", "Account Q&A"], ["ai_assistant", "assistant", "AI Assistant"]] as const).map(([name, key, label]) => <label key={name} className="flex items-center gap-2"><input type="checkbox" name={name} defaultChecked={assists[key] !== false} disabled={!admin} /> {label}</label>)}</div></div>
            {admin && <div className="sm:col-span-2"><Submit className={cls.btnPrimary}>Save settings</Submit></div>}
          </form>
        </Card>
        <Card title="Daily automation" pad>
          <p className="text-sm text-slate-600">Creates renewal reviews at each lead time, flags renewals a week out, binders about to lapse, pending cancellations, past-due agency invoices, expiring licenses and stale claims. Runs on the first page view each day and from <span className="font-mono">POST /api/cron/daily</span>.</p>
          <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">Last run: <b>{last?.value.ranOn ?? "never"}</b>{last && <> · {Object.entries(last.value.created).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "nothing new"} · {last.value.expired} term(s) expired</>}</div>
          {admin && <form action={runAutomationAction} className="mt-3"><Submit className={cls.btn}>Run now</Submit></form>}
        </Card>
      </div>
      <Card title="Activity codes and service standards" className="mt-5">
        <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
          <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Code", "Type", "Category", "Default priority", "Due in (days)", "Service standard (hours)", "Active", ""].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{codes.map((c) => { const form = `code-${c.code}`, off = c.active ? "" : "opacity-60"; return <tr key={c.code} className={c.active ? "" : "bg-slate-50"}><td className={`${cls.td} font-mono text-xs ${off}`}>{c.code}</td><td className={`${cls.td} ${off}`}>{c.label}{!c.active && <span className="ml-1.5 text-xs">(inactive)</span>}</td><td className={`${cls.td} text-xs ${off}`}>{c.category}</td>
            <td className={cls.td}><select form={form} name="default_priority" aria-label={`Default priority for ${c.code}`} defaultValue={c.default_priority} disabled={!admin} className="rounded border border-slate-300 px-1 py-0.5 text-xs"><option>urgent</option><option>high</option><option>normal</option><option>low</option></select></td>
            <td className={cls.td}><input form={form} name="default_due_days" aria-label={`Due in days for ${c.code}`} defaultValue={c.default_due_days} disabled={!admin} className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs" /></td>
            <td className={cls.td}><input form={form} name="sla_hours" aria-label={`Service standard hours for ${c.code}`} defaultValue={c.sla_hours ?? ""} disabled={!admin} className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs" /></td>
            <td className={cls.td}><input form={form} type="checkbox" name="active" aria-label={`${c.code} active`} defaultChecked={c.active} disabled={!admin} /></td>
            <td className={cls.td}><form id={form} action={codeAction}><input type="hidden" name="code" value={c.code} />{admin && <Submit className={cls.btnSm}>Save</Submit>}</form></td></tr>; })}</tbody>
        </table></div>
      </Card>
    </div>
  );
}
