import Link from "next/link";
import { notFound } from "next/navigation";
import { addInterestAction, policyNumberAction, cancelAction, issueTxAction, linkItemsAction, markIssuedAction, policyCheckAction, confirmNonpayAction, reinstateAction, removeInterestAction, renewAction, renewalStageAction, saveCoverageAction } from "../actions";
import { renewAllAction } from "../../certificates/actions";
import { EndorseForm } from "./endorse-form";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { TaskLine } from "@/components/tasks";
import { Card, Empty, Field, Flash, KV, PageHeader, Pill, Status, Table, Tabs, cls } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { one, q } from "@/lib/db";
import { addDays, daysBetween, money, plural, pct, todayISO, when, whenShort } from "@/lib/format";
import { itemDetails } from "@/lib/redact";
import { NOT_RENEWABLE, compareTerms, prepareRenewal, renewalFollowUp, renewalWindowDays } from "@/lib/policies";
import { CANCEL_REASONS, lobLabel, RENEWAL_STAGE_LABEL, RENEWAL_STAGES } from "@/lib/ref";
import { can, currentUser } from "@/lib/user";
import { listTasks } from "@/lib/work";

export const metadata = { title: "Policy" };

type P = { id: number; policy_number: string; client_id: number; client_name: string; client_kind: string; carrier_id: number; carrier: string; carrier_portal: string | null; wholesaler: string | null; lob: string;
  business_type: string; description: string | null; status: string; effective_date: string; expiration_date: string; term_months: number; bill_mode: string; premium: string; commission_pct: string;
  is_admitted: boolean; payment_plan: string; finance_company: string | null; new_renewal: string; prior_policy_id: number | null; renewal_policy_id: number | null; producer: string | null; am: string | null;
  renewal_stage: string; remarket_reason: string | null; cancel_date: string | null; cancel_reason: string | null; cancel_method: string | null; return_premium: string | null; binder_number: string | null;
  binder_expires: string | null; issued_at: Date | null; policy_checked_at: Date | null; prior_number: string | null; renewal_number: string | null; opportunity_id: number | null };

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; action?: string; task?: string; msg?: string; error?: string; cov?: string }> }) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  const p = await one<P>(`SELECT p.*, c.name AS client_name, c.kind AS client_kind, ca.name AS carrier, ca.portal_url AS carrier_portal, w.name AS wholesaler, f.name AS finance_company,
      pr.full_name AS producer, am.full_name AS am, pp.policy_number AS prior_number, rp.policy_number AS renewal_number
    FROM policies p JOIN clients c ON c.id = p.client_id JOIN carriers ca ON ca.id = p.carrier_id LEFT JOIN carriers w ON w.id = p.wholesaler_id LEFT JOIN finance_companies f ON f.id = p.finance_company_id
    LEFT JOIN users pr ON pr.id = p.producer_id LEFT JOIN users am ON am.id = p.account_manager_id LEFT JOIN policies pp ON pp.id = p.prior_policy_id LEFT JOIN policies rp ON rp.id = p.renewal_policy_id
    WHERE p.id = $1`, [id]);
  if (!p) notFound();
  const user = await currentUser();
  const write = can(user, "write");
  const tab = sp.tab ?? "overview";
  const today = todayISO();
  const left = daysBetween(today, p.expiration_date);
  const [lines, txs, counts] = await Promise.all([
    q<{ lob: string; premium: string }>("SELECT lob, premium FROM policy_lines WHERE policy_id = $1", [id]),
    q<{ id: number; kind: string; status: string; effective_date: string; description: string; premium_change: string; created_at: Date; by: string | null }>(
      "SELECT t.id, t.kind, t.status, t.effective_date, t.description, t.premium_change, t.created_at, u.full_name AS by FROM policy_transactions t LEFT JOIN users u ON u.id = t.created_by_id WHERE t.policy_id = $1 ORDER BY t.effective_date DESC, t.id DESC", [id]),
    one<{ covs: number; items: number; ints: number; docs: number; certs: number; tasks: number }>(`SELECT (SELECT count(*)::int FROM coverages WHERE policy_id = $1) covs, (SELECT count(*)::int FROM policy_items WHERE policy_id = $1) items,
      (SELECT count(*)::int FROM additional_interests WHERE policy_id = $1) ints, (SELECT count(*)::int FROM documents WHERE policy_id = $1 AND active) docs,
      (SELECT count(*)::int FROM certificate_policies WHERE policy_id = $1) certs, (SELECT count(*)::int FROM activities WHERE policy_id = $1 AND status IN ('open','waiting')) tasks`, [id]),
  ]);
  const inForce = ["active", "bound", "pending_cancel"].includes(p.status);
  const taskQ = sp.task ? `&task=${sp.task}` : "";
  const tabs = [["overview", "Overview"], ["coverages", `Coverages`, counts!.covs], ["schedule", "Schedule", counts!.items], ["interests", "Interests", counts!.ints], ["renewal", "Renewal"], ["check", "Policy check"],
    ["documents", "Documents", counts!.docs], ["activity", "Activity", counts!.tasks]].map(([k, l, c]) => ({ key: k as string, label: l as string, count: c as number | undefined, href: `/policies/${id}?tab=${k}${taskQ}` }));

  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/clients", label: "Clients" }, { href: `/clients/${p.client_id}`, label: p.client_name }]}
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{p.policy_number}</span><Status s={p.status} />{!p.is_admitted && <Pill tone="violet">non-admitted</Pill>}</span>}
        subtitle={<>{lobLabel(p.lob)}{lines.length > 1 ? ` package (${lines.map((l) => lobLabel(l.lob)).join(", ")})` : ""} · {p.carrier}{p.wholesaler ? ` via ${p.wholesaler}` : ""} · {p.effective_date} → {p.expiration_date}{inForce && <span className={left <= 30 ? "text-rose-600" : ""}> ({left >= 0 ? `${left} days left` : "expired"})</span>}</>}
        actions={write && !inForce && p.status === "cancelled" ? <Link href={`/policies/${id}?action=reinstate${taskQ}`} className={cls.btn}>Reinstate</Link> : write && inForce && <>
          <Link href={`/policies/${id}?action=endorse${taskQ}`} className={cls.btn}>Endorse</Link>
          {p.status === "pending_cancel" ? <Link href={`/policies/${id}?action=reinstate${taskQ}`} className={cls.btn}>Reinstate</Link> : <Link href={`/policies/${id}?action=cancel${taskQ}`} className={cls.btn}>Cancel</Link>}
          {!p.renewal_policy_id && <Link href={`/policies/${id}?tab=renewal`} className={cls.btn}>Renew</Link>}
          {p.client_kind === "business" && <Link href={`/certificates/new?client=${p.client_id}&policy=${id}`} className={cls.btn}>Certificate</Link>}
          {p.lob === "PA" && <a href={`/documents/render?kind=id_card&policy=${id}`} className={cls.btn}>ID cards</a>}
          <a href={`/documents/render?kind=dec_page&policy=${id}`} className={cls.btnPrimary}>Dec page PDF</a>
        </>} />

      {sp.action === "endorse" && write && inForce && (
        <Card title="Endorse this policy" className="mb-5 border-indigo-200 ring-2 ring-indigo-100" pad>
          <EndorseForm id={id} task={sp.task} today={today} min={p.effective_date} max={p.expiration_date} agency={p.bill_mode === "agency"} />
        </Card>
      )}
      {sp.action === "nonpay" && write && p.status === "pending_cancel" && (
        <Card title="Non-pay notice on file" className="mb-5 border-amber-200 ring-2 ring-amber-100" pad>
          <p className="mb-4 text-sm text-slate-700">Cancels <b>{p.cancel_date}</b> at 12:01 AM unless paid. Most notices end with payment, so check that first.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <form action={reinstateAction} className="space-y-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={sp.task ?? ""} />
              <input name="note" aria-label="Note" placeholder="e.g. Payment received by carrier 10/30, no lapse" className={cls.input} /><Submit className={cls.btnGreen}>Payment confirmed: reinstate</Submit></form>
            <form action={confirmNonpayAction} className="space-y-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={sp.task ?? ""} />
              {p.cancel_date && p.cancel_date > today ? <><p className="text-sm text-slate-500">The carrier can&apos;t have cancelled yet. This opens on {p.cancel_date}.</p><button disabled className={`${cls.btn} opacity-50`}>Carrier cancelled it</button></>
                : <><p className="text-sm text-slate-500">Records the cancellation dated {p.cancel_date}, for non-payment.</p><Submit className={cls.btnDanger} confirm={`Cancel ${p.policy_number} effective ${p.cancel_date}? Coverage ends that day.`}>Carrier cancelled it</Submit></>}</form>
          </div>
        </Card>
      )}
      {sp.action === "nonpay" && write && (p.status === "active" || p.status === "bound") && (
        <Card title="Record non-pay notice" className="mb-5 border-amber-200 ring-2 ring-amber-100" pad>
          <form action={cancelAction} className="grid gap-3 sm:grid-cols-4"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={sp.task ?? ""} /><input type="hidden" name="pending" value="on" /><input type="hidden" name="reason" value="Non-payment" /><input type="hidden" name="from_nonpay" value="1" />
            <Field label="Date on the notice"><input type="date" name="cancel_date" required min={today} className={cls.input} /></Field>
            <Field label="Method"><select name="method" className={cls.input}><option>Pro rata</option><option>Short rate</option><option>Flat</option></select></Field>
            <Field label="Return premium if it goes through" className="sm:col-span-2"><input name="return_premium" inputMode="decimal" defaultValue={proRataReturn(Number(p.premium), today, p.effective_date, p.expiration_date).toFixed(2)} className={cls.input} /><span className="mt-1 block text-[11px] text-slate-500">Pro rata from today. Change it to match the notice; 0 for none.</span></Field>
            <p className="text-sm text-slate-600 sm:col-span-3">Coverage stays in force until that date. If it&apos;s paid, reinstate it from the policy.</p>
            <div className="flex justify-end gap-2"><Link href={`/policies/${id}`} className={cls.btn}>Close</Link><Submit className={cls.btnPrimary}>Record notice</Submit></div>
          </form>
        </Card>
      )}
      {sp.action === "nonpay" && p.status === "cancelled" && (
        <Card title="Already cancelled" className="mb-5" pad><p className="text-sm text-slate-700">This policy was cancelled{p.cancel_date ? ` on ${p.cancel_date}` : ""}. If the carrier accepted payment, use Reinstate above.</p></Card>
      )}
      {sp.action === "cancel" && write && inForce && (
        <Card title="Cancel this policy" className="mb-5 border-rose-200 ring-2 ring-rose-100" pad>
          <form action={cancelAction} className="grid gap-3 sm:grid-cols-4"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={sp.task ?? ""} />
            <Field label="Cancellation date"><input type="date" name="cancel_date" required defaultValue={today} className={cls.input} /></Field>
            <Field label="Reason"><select name="reason" className={cls.input}>{CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            <Field label="Method"><select name="method" className={cls.input}><option>Pro rata</option><option>Short rate</option><option>Flat</option></select></Field>
            <Field label="Return premium"><input name="return_premium" inputMode="decimal" defaultValue={proRataReturn(Number(p.premium), today, p.effective_date, p.expiration_date).toFixed(2)} className={cls.input} /><span className="mt-1 block text-[11px] text-slate-500">Pro rata from today. Change it if the date or method differ; 0 for none.</span></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="pending" /> This is a notice of cancellation (non-pay) — it cancels on the date unless paid</label>
            <div className="flex justify-end gap-2"><Link href={`/policies/${id}`} className={cls.btn}>Close</Link><Submit className={cls.btnDanger} confirm={`Record this for ${p.policy_number}? Without the notice box ticked, coverage ends on the date above.`}>Record</Submit></div>
          </form>
        </Card>
      )}
      {sp.action === "reinstate" && write && (p.status === "pending_cancel" || p.status === "cancelled") && (
        <Card title="Reinstate" className="mb-5" pad>
          <form action={reinstateAction} className="flex gap-2"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={sp.task ?? ""} />
            <input name="note" placeholder="e.g. Payment received by carrier 10/30, no lapse" className={cls.input} /><Submit className={cls.btnGreen}>Reinstate</Submit></form>
        </Card>
      )}

      <Tabs tabs={tabs} current={tab} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            {p.status === "bound" && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Bound under binder {p.binder_number ?? ""}{p.binder_expires ? `, expires ${p.binder_expires}` : ""}. Waiting for the carrier&apos;s policy.
                {write && <form action={markIssuedAction} className="ml-auto flex items-center gap-2"><input type="hidden" name="id" value={id} />{p.policy_number.startsWith("PENDING-") && <input name="new_number" required aria-label="Carrier's policy number" placeholder="Carrier's policy number" className="rounded border border-amber-300 bg-white px-2 py-1 text-xs" />}<Submit className={cls.btnSm}>Carrier policy received</Submit></form>}
              </div>
            )}
            {p.status === "pending_cancel" && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">Pending cancellation for {p.cancel_reason?.toLowerCase()} on <b>{p.cancel_date}</b>. Contact the insured; reinstate when payment is confirmed.</div>}
            <Card title="Summary" pad>
              <KV cols={3} items={[
                ["Client", <Link key="c" href={`/clients/${p.client_id}`} className={cls.link}>{p.client_name}</Link>], ["Carrier", p.carrier], ["Line", lobLabel(p.lob)],
                ["Premium", money(p.premium, true)], ["Commission", `${pct(p.commission_pct)} · ${money(Number(p.premium) * Number(p.commission_pct) / 100)}`], ["Billing", `${p.bill_mode === "agency" ? "Agency bill" : "Direct bill"} · ${p.payment_plan}`],
                ["Business", p.new_renewal === "new" ? "New business" : p.new_renewal === "rewrite" ? "Rewrite" : "Renewal"], ["Producer", p.producer], ["Account manager", p.am],
                ["Finance company", p.finance_company ?? "—"], ["Issued", p.issued_at ? whenShort(p.issued_at) : "Not yet"], ["Policy checked", p.policy_checked_at ? whenShort(p.policy_checked_at) : <Pill key="pc" tone="amber">not yet</Pill>],
                ...(p.prior_policy_id ? [["Prior term", <Link key="pr" href={`/policies/${p.prior_policy_id}`} className={cls.link}>{p.prior_number}</Link>] as [string, React.ReactNode]] : []),
                ...(p.renewal_policy_id ? [["Renewed as", <Link key="rn" href={`/policies/${p.renewal_policy_id}`} className={cls.link}>{p.renewal_number}</Link>] as [string, React.ReactNode]] : []),
                ...(p.cancel_date ? [["Cancellation", `${p.cancel_date} · ${p.cancel_reason} · ${p.cancel_method}${p.return_premium ? ` · return ${money(p.return_premium)}` : ""}`] as [string, string]] : []),
              ]} />
              {p.description && <p className="mt-3 text-sm text-slate-600">{p.description}</p>}
              {write && inForce && !p.policy_number.startsWith("PENDING-") && <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-500">Correct policy number</summary><form action={policyNumberAction} className="mt-2 flex items-center gap-2"><input type="hidden" name="id" value={id} /><input name="new_number" required defaultValue={p.policy_number} aria-label="Policy number" className={cls.inputInline} /><Submit className={cls.btnSm} confirm="Change the policy number? Certificates and documents print the new one from now on.">Save number</Submit></form></details>}
            </Card>
            <Card title="Transactions">
              <Table head={["Effective", "Type", "Description", { label: "Premium", num: true }, "Status", ""]}>
                {txs.map((t) => <tr key={t.id}>
                  <td className={`${cls.td} text-xs tabular-nums`}>{t.effective_date}</td><td className={`${cls.td} text-xs`}>{t.kind.replace("_", " ")}</td>
                  <td className={cls.td}>{t.description}<div className="text-[11px] text-slate-400">{t.by} · {whenShort(t.created_at)}</div></td>
                  <td className={cls.num}>{Number(t.premium_change) ? money(t.premium_change, true) : "—"}</td><td className={cls.td}><Status s={t.status} /></td>
                  <td className={`${cls.td} text-right`}>{t.status === "pending" && write && <span className="flex justify-end gap-1">
                    <form action={issueTxAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="tx_id" value={t.id} /><input type="hidden" name="issued" value="1" />{t.kind === "cancellation" ? <Submit className={cls.btnSm} confirm="Finalize this cancellation now?">Cancel now</Submit> : <Submit className={cls.btnSm}>Issued</Submit>}</form>
                    {t.kind !== "cancellation" && <form action={issueTxAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="tx_id" value={t.id} /><input type="hidden" name="issued" value="0" /><Submit className={cls.btnSm}>Not issued</Submit></form>}</span>}</td>
                </tr>)}
              </Table>
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Carrier" pad>
              <div className="text-sm font-medium">{p.carrier}</div>
              {p.carrier_portal && <a href={p.carrier_portal} target="_blank" rel="noreferrer" className={`${cls.link} text-sm`}>Agent portal ↗</a>}
              <div className="mt-3 flex flex-wrap gap-2"><NotInMvp id="CON-19" label="Sign in to portal" /><NotInMvp id="CON-18" label="Billing inquiry" /></div>
            </Card>
            <PolicyCerts id={id} />
          </div>
        </div>
      )}

      {tab === "coverages" && <CoveragesTab id={id} write={write} editId={Number(sp.cov) || null} />}
      {tab === "schedule" && <ScheduleTab id={id} clientId={p.client_id} write={write} pii={can(user, "pii")} />}
      {tab === "interests" && <InterestsTab id={id} write={write} />}
      {tab === "renewal" && <RenewalTab p={p} write={write} />}
      {tab === "check" && (
        <Card title="Policy check (POL-20)" pad>
          <p className="mb-3 text-sm text-slate-600">Compare the carrier&apos;s issued policy with what was bound: named insured, address, dates, limits, deductibles, forms, interests and schedules. {p.policy_checked_at ? <b>Last checked {when(p.policy_checked_at)}.</b> : <b className="text-amber-700">Not checked yet.</b>}</p>
          {write && <form action={policyCheckAction} className="space-y-3"><input type="hidden" name="id" value={id} />
            <Field label={`Carrier policy PDF — ${aiEnabled() ? "Claude compares it with this record and lists every discrepancy" : "AI comparison needs ANTHROPIC_API_KEY"}`}><input type="file" name="file" accept="application/pdf" className="text-sm" /></Field>
            <Field label="Or record your manual check"><textarea name="result" rows={2} placeholder="e.g. Checked dec page: all matches except mailing address — correction requested" className={cls.input} /></Field>
            <Submit className={cls.btnPrimary} pending={aiEnabled() ? "Claude is reading the policy…" : "Saving…"}>Record check</Submit>
          </form>}
          <CheckHistory id={id} />
        </Card>
      )}
      {tab === "documents" && <PolicyDocs id={id} />}
      {tab === "activity" && <PolicyActivity id={id} />}
    </div>
  );
}

async function PolicyCerts({ id }: { id: number }) {
  const certs = await q<{ id: number; cert_number: string; holder: string | null; status: string }>(
    "SELECT ce.id, ce.cert_number, oi.name AS holder, ce.status FROM certificate_policies cp JOIN certificates ce ON ce.id = cp.certificate_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id WHERE cp.policy_id = $1 AND ce.status = 'issued' ORDER BY ce.issued_at DESC LIMIT 8", [id]);
  return (
    <Card title={`Certificates · ${certs.length}`}>
      {certs.length === 0 ? <Empty>None issued on this policy.</Empty> : <ul className="divide-y divide-slate-100">{certs.map((c) => <li key={c.id} className="px-4 py-2 text-sm"><Link href={`/certificates/${c.id}`} className={cls.link}>{c.holder ?? c.cert_number}</Link><div className="font-mono text-[11px] text-slate-400">{c.cert_number}</div></li>)}</ul>}
    </Card>
  );
}

async function CoveragesTab({ id, write, editId }: { id: number; write: boolean; editId: number | null }) {
  const covs = await q<{ id: number; lob: string; description: string; limit_text: string | null; deductible_text: string | null; premium: string | null }>("SELECT * FROM coverages WHERE policy_id = $1 ORDER BY lob, id", [id]);
  const forms = await q<{ form_number: string; edition: string | null; description: string | null }>("SELECT form_number, edition, description FROM policy_forms WHERE policy_id = $1", [id]);
  const edit = covs.find((c) => c.id === editId);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <Table head={["Line", "Coverage", "Limit", "Deductible", { label: "Premium", num: true }, ""]} empty="No coverages recorded.">
            {covs.map((c) => <tr key={c.id}><td className={`${cls.td} text-xs`}>{lobLabel(c.lob)}</td><td className={cls.td}>{c.description}</td><td className={cls.td}>{c.limit_text ?? "—"}</td><td className={cls.td}>{c.deductible_text ?? "—"}</td><td className={cls.num}>{c.premium ? money(c.premium) : "—"}</td>
              <td className={`${cls.td} text-right`}>{write && <Link href={`/policies/${id}?tab=coverages&cov=${c.id}`} className={cls.btnSm}>Edit</Link>}</td></tr>)}
          </Table>
        </Card>
        <Card title="Forms and endorsements">
          <Table head={["Form", "Edition", "Description"]} empty="No forms recorded.">{forms.map((f, i) => <tr key={i}><td className={`${cls.td} font-mono text-xs`}>{f.form_number}</td><td className={`${cls.td} text-xs`}>{f.edition}</td><td className={cls.td}>{f.description}</td></tr>)}</Table>
        </Card>
      </div>
      {write && <Card title={edit ? "Edit coverage" : "Add coverage"} pad>
        <form action={saveCoverageAction} className="space-y-3" key={edit?.id ?? "new"}><input type="hidden" name="id" value={id} />{edit && <input type="hidden" name="cov_id" value={edit.id} />}
          <Field label="Coverage"><input name="description" required defaultValue={edit?.description} className={cls.input} /></Field>
          <Field label="Limit"><input name="limit_text" defaultValue={edit?.limit_text ?? ""} className={cls.input} /></Field>
          <Field label="Deductible"><input name="deductible_text" defaultValue={edit?.deductible_text ?? ""} className={cls.input} /></Field>
          <Submit className={cls.btnPrimary}>Save</Submit>
          <p className="text-[11px] text-slate-500">Changing coverage on an in-force policy is an endorsement: record it from the Endorse button too.</p>
        </form>
      </Card>}
    </div>
  );
}

async function ScheduleTab({ id, clientId, write, pii }: { id: number; clientId: number; write: boolean; pii: boolean }) {
  const items = await q<{ id: number; kind: string; label: string; data: Record<string, unknown>; on: boolean }>(
    "SELECT i.id, i.kind, i.label, i.data, EXISTS (SELECT 1 FROM policy_items pi WHERE pi.policy_id = $1 AND pi.item_id = i.id) AS on FROM insured_items i WHERE i.client_id = $2 AND i.active ORDER BY i.kind, i.id", [id, clientId]);
  return (
    <Card title="Scheduled vehicles, drivers, locations and exposures" action={<Link href={`/clients/${clientId}?tab=schedules`} className={cls.link}>Edit the client&apos;s schedules</Link>}>
      {items.length === 0 ? <Empty>The client has no schedule items yet.</Empty> : (
        <form action={linkItemsAction}><input type="hidden" name="id" value={id} />
          <ul className="divide-y divide-slate-100">{items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-2 text-sm">
              <input type="checkbox" name="item_ids" value={i.id} defaultChecked={i.on} disabled={!write} className="mt-1" />
              <div><span className="mr-2 text-[11px] uppercase text-slate-400">{i.kind.replace("_", " ")}</span>{i.label}
                <div className="text-xs text-slate-500">{itemDetails(i.kind, i.data, pii).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
            </li>))}</ul>
          {write && <div className="border-t border-slate-100 px-4 py-2.5"><Submit className={cls.btn}>Save schedule for this policy</Submit></div>}
        </form>
      )}
    </Card>
  );
}

async function InterestsTab({ id, write }: { id: number; write: boolean }) {
  const [ints, all] = await Promise.all([
    q<{ id: number; name: string; role: string; loan_number: string | null; kind: string }>("SELECT ai.id, oi.name, ai.role, ai.loan_number, oi.kind FROM additional_interests ai JOIN other_interests oi ON oi.id = ai.interest_id WHERE ai.policy_id = $1", [id]),
    q<{ id: number; name: string; kind: string }>("SELECT id, name, kind FROM other_interests ORDER BY name"),
  ]);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2"><Table head={["Interest", "Role", "Loan / reference", ""]} empty="No mortgagees, loss payees or additional insureds.">
        {ints.map((i) => <tr key={i.id}><td className={cls.td}>{i.name}</td><td className={cls.td}>{i.role}</td><td className={`${cls.td} font-mono text-xs`}>{i.loan_number ?? "—"}</td>
          <td className={`${cls.td} text-right`}>{write && <form action={removeInterestAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="ai_id" value={i.id} /><Submit className={cls.btnSm} confirm="Remove?">Remove</Submit></form>}</td></tr>)}
      </Table></Card>
      {write && <Card title="Add interest" pad>
        <form action={addInterestAction} className="space-y-3"><input type="hidden" name="id" value={id} />
          <Field label="Existing"><select name="interest_id" className={cls.input}><option value="">— new —</option>{all.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <Field label="…or new name"><input name="new_name" className={cls.input} /></Field>
          <Field label="Role"><select name="role" className={cls.input}><option>Mortgagee</option><option>Loss payee</option><option>Lienholder</option><option>Additional insured</option><option>Lender&apos;s loss payable</option></select></Field>
          <input type="hidden" name="kind" value="mortgagee" />
          <Field label="Loan number"><input name="loan_number" className={cls.input} /></Field>
          <Submit className={cls.btnPrimary}>Add</Submit>
        </form>
      </Card>}
    </div>
  );
}

/** The premium for the unused part of the term, by days: right for 6-month and leap-year terms alike (CR-020). */
function proRataReturn(premium: number, from: string, effective: string, expiration: string): number {
  const term = daysBetween(effective, expiration);
  return term > 0 ? Math.max(0, Math.round((premium * Math.max(0, daysBetween(from, expiration)) / term) * 100) / 100) : 0;
}

async function RenewalTab({ p, write }: { p: P; write: boolean }) {
  const today = todayISO();
  const carriers = await q<{ id: number; name: string; commission_renewal_pct: string }>("SELECT id, name, commission_renewal_pct FROM carriers WHERE kind <> 'wholesaler' AND active ORDER BY name");
  // A term with a prior is still a term to renew: its comparison sits above the renewal forms (CR-002).
  const priorCmp = p.prior_policy_id && !p.renewal_policy_id ? await compareTerms(p.prior_policy_id, p.id) : null;
  if (p.renewal_policy_id) {
    const cmp = await compareTerms(p.id, p.renewal_policy_id);
    return <Comparison cmp={cmp} priorId={p.renewal_policy_id} priorNumber={p.renewal_number} renewedTo />;
  }
  if (NOT_RENEWABLE.includes(p.status)) return <div className="space-y-5">{priorCmp && <Comparison cmp={priorCmp} priorId={p.prior_policy_id!} priorNumber={p.prior_number} />}<Card title="Renew this policy" pad><p className="text-sm text-slate-500">This policy is {p.status.replace("_", "-")}, so it can&apos;t be renewed. Write a new policy instead.</p></Card></div>;
  const draft = await prepareRenewal(p.id);
  const left = daysBetween(today, p.expiration_date);
  const lead = await renewalWindowDays();
  // A term that isn't due yet, typically one that just started, gets what comes next rather than another renewal form (UX-035).
  const notDue = left > lead;
  const after = notDue && p.prior_policy_id ? await renewalFollowUp(p.prior_policy_id, p.client_id) : null;
  const opens = new Date(`${addDays(p.expiration_date, -lead)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const renewForm = write ? (
          <form action={renewAction} className="grid gap-3 sm:grid-cols-3"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="draft_carrier_id" value={draft.carrierId} /><input type="hidden" name="draft_commission_pct" value={draft.commissionPct} />
            <Field label="Renewal policy number"><input name="policy_number" required defaultValue={draft.policyNumber.replace(/-(\d+)$/, (_m, n) => `-${String(Number(n) + 1).padStart(2, "0")}`)} className={cls.input} /></Field>
            <Field label="Effective"><input type="date" name="effective_date" required defaultValue={draft.effectiveDate} className={cls.input} /></Field>
            <Field label="Term"><select name="term_months" defaultValue={String(draft.termMonths)} className={cls.input}><option value="12">12 months</option><option value="6">6 months</option></select></Field>
            <Field label="Carrier" hint="Pick another carrier to record a rewrite"><select name="carrier_id" defaultValue={draft.carrierId} className={cls.input}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label={`Renewal premium (expiring ${money(draft.premium)})`}><input name="premium" required inputMode="decimal" defaultValue={draft.premium.toFixed(2)} className={cls.input} /></Field>
            <Field label="Commission %"><input name="commission_pct" inputMode="decimal" defaultValue={draft.commissionPct} className={cls.input} /></Field>
            <Field label="Billing"><select name="bill_mode" defaultValue={draft.billMode} className={cls.input}><option value="direct">Direct bill</option><option value="agency">Agency bill</option></select></Field>
            <div className="flex items-end sm:col-span-2"><Submit className={cls.btnPrimary}>Create renewal term</Submit></div>
            <p className="text-xs text-slate-500 sm:col-span-3">Copies coverages (premium scaled), schedules, interests and forms; links the terms; closes the open renewal tasks; creates a certificate-reissue task when certificates exist.</p>
          </form>
  ) : null;
  return (
    <div className="space-y-5">
    {priorCmp && <Comparison cmp={priorCmp} priorId={p.prior_policy_id!} priorNumber={p.prior_number} />}
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Renewal stage" pad>
        <ol className="space-y-1.5 text-sm">{RENEWAL_STAGES.slice(0, 6).map((s) => <li key={s} className={`flex items-center gap-2 ${s === p.renewal_stage ? "font-semibold text-indigo-700" : "text-slate-500"}`}><span className={`h-2 w-2 rounded-full ${s === p.renewal_stage ? "bg-indigo-600" : "bg-slate-300"}`} />{RENEWAL_STAGE_LABEL[s]}</li>)}</ol>
        <p className="mt-3 text-xs text-slate-500">Expires {p.expiration_date} ({left} days). {p.remarket_reason && `Note: ${p.remarket_reason}`}</p>
        {write && <form action={renewalStageAction} className="mt-3 space-y-2"><input type="hidden" name="id" value={p.id} />
          <select name="stage" defaultValue={p.renewal_stage} className={cls.input}>{RENEWAL_STAGES.filter((s) => s !== "renewed").map((s) => <option key={s} value={s}>{RENEWAL_STAGE_LABEL[s]}</option>)}</select>
          <input name="reason" placeholder="Reason (required for remarket, lost, non-renewal)" className={cls.input} />
          <Submit className={`${cls.btn} w-full`}>Update stage</Submit></form>}
      </Card>
      {notDue ? (
        <Card title={after ? "Next steps" : "Not due for renewal yet"} className="lg:col-span-2" pad>
          {after && <ul className="space-y-1 text-sm text-slate-700"><li>✔ Renewal term created</li>{after.tasks > 0 && <li>✔ {plural(after.tasks, "renewal task")} closed</li>}</ul>}
          {after && after.certificates > 0 && write && <form action={renewAllAction} className="mt-3"><input type="hidden" name="client_id" value={p.client_id} /><Submit className={cls.btnPrimary}>Reissue {plural(after.certificates, "certificate")} on this term</Submit></form>}
          <p className={`text-sm text-slate-500 ${after ? "mt-3" : ""}`}>Renewing this term opens {opens}.</p>
          {renewForm && <details className="mt-3 border-t border-slate-100 pt-3"><summary className="text-xs font-medium text-indigo-600">Renew early anyway</summary><div className="mt-3">{renewForm}</div></details>}
        </Card>
      ) : (
      <Card title="Renew this policy" className="lg:col-span-2" pad>
        {renewForm ?? <p className="text-sm text-slate-500">Read only.</p>}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3"><NotInMvp id="PLC-18" label="Re-quote in rater" /><NotInMvp id="PLC-46" label="Renewal proposal" /><NotInMvp id="CON-01" label="Renewal download" /></div>
      </Card>
      )}
    </div>
    </div>
  );
}

function Comparison({ cmp, priorId, priorNumber, renewedTo }: { cmp: Awaited<ReturnType<typeof compareTerms>>; priorId: number; priorNumber: string | null; renewedTo?: boolean }) {
  return (
    <Card title={renewedTo ? <>Renewed as <Link href={`/policies/${priorId}`} className={cls.link}>{priorNumber}</Link></> : <>Compared with expiring <Link href={`/policies/${priorId}`} className={cls.link}>{priorNumber}</Link></>} pad>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div><div className="text-xs text-slate-500">Expiring premium</div><div className="text-lg font-semibold tabular-nums">{money(cmp.premiumBefore)}</div></div>
        <div className="text-slate-300">→</div>
        <div><div className="text-xs text-slate-500">Renewal premium</div><div className="text-lg font-semibold tabular-nums">{money(cmp.premiumAfter)}</div></div>
        <div className={`rounded-md px-3 py-1.5 text-sm font-semibold ${cmp.flagged ? "bg-rose-50 text-rose-700" : cmp.change > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{cmp.change >= 0 ? "+" : ""}{money(cmp.change)} ({cmp.changePct >= 0 ? "+" : ""}{cmp.changePct.toFixed(1)}%)</div>
        {cmp.flagged && <Pill tone="red">Over remarket threshold</Pill>}
      </div>
      <Table head={["Coverage", renewedTo ? "This term" : "Expiring", renewedTo ? "Renewal" : "This term", ""]}>
        {cmp.coverages.map((c, i) => <tr key={i} className={c.changed ? "bg-amber-50/60" : ""}><td className={cls.td}>{c.description}</td><td className={`${cls.td} text-xs`}>{c.before}</td><td className={`${cls.td} text-xs`}>{c.after}</td><td className={cls.td}>{c.changed && <Pill tone="amber">changed</Pill>}</td></tr>)}
      </Table>
    </Card>
  );
}

async function CheckHistory({ id }: { id: number }) {
  const rows = await q<{ id: number; actor: string; summary: string; occurred_at: Date }>("SELECT id, actor, summary, occurred_at FROM audit_events WHERE entity_type = 'policy' AND entity_id = $1 AND action IN ('policy.checked','policy.check_recorded') ORDER BY id DESC", [String(id)]);
  return rows.length ? <ul className="mt-4 space-y-2 border-t border-slate-100 pt-3">{rows.map((r) => <li key={r.id} className="text-sm"><span className="text-xs text-slate-500">{r.actor} · {whenShort(r.occurred_at)}</span><p className="text-slate-700">{r.summary}</p></li>)}</ul> : null;
}

async function PolicyDocs({ id }: { id: number }) {
  const docs = await q<{ id: number; title: string; folder: string; created_at: Date }>("SELECT id, title, folder, created_at FROM documents WHERE policy_id = $1 AND active ORDER BY created_at DESC", [id]);
  return <Card><Table head={["Document", "Folder", "Added"]} empty="No documents on this policy.">{docs.map((d) => <tr key={d.id}><td className={cls.td}><a href={`/documents/${d.id}`} className={cls.link}>{d.title}</a></td><td className={`${cls.td} text-xs`}>{d.folder}</td><td className={`${cls.td} text-xs`}>{whenShort(d.created_at)}</td></tr>)}</Table></Card>;
}

async function PolicyActivity({ id }: { id: number }) {
  const tasks = await listTasks({ policyId: id, limit: 100 });
  return <Card>{tasks.length === 0 ? <Empty>No work on this policy.</Empty> : <ul className="divide-y divide-slate-100">{tasks.map((t) => <TaskLine key={t.id} t={t} showOwner showReasons={false} actions={t.status === "open" || t.status === "waiting"} />)}</ul>}</Card>;
}

