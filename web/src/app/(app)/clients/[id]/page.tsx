import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addItemAction, askAction, deleteContactAction, removeItemAction, saveContactAction, setClientStatusAction } from "../actions";
import { noteAction } from "../../tasks/actions";
import { uploadDocumentAction } from "../../documents/actions";
import { applyCreditAction, refundAction } from "../../accounting/actions";
import { MergeForm } from "./merge-form";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { TaskLine } from "@/components/tasks";
import { Card, Empty, Field, Flash, KV, PageHeader, Pill, Stat, Status, Table, Tabs, cls } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { one, q } from "@/lib/db";
import { daysBetween, money, todayISO, whenDate, whenShort } from "@/lib/format";
import { HIDDEN, itemDetails } from "@/lib/redact";
import { DOC_FOLDERS, lobLabel, POLICY_STATUS_LABEL } from "@/lib/ref";
import { can, currentUser } from "@/lib/user";
import { hideConfidential, listTasks, type NoteViewer } from "@/lib/work";

export const metadata = { title: "Client" };

type Client = { id: number; code: string; name: string; kind: string; status: string; dba: string | null; industry: string | null; naics: string | null; annual_revenue: string | null; employees: number | null;
  years_in_business: number | null; website: string | null; email: string | null; phone: string | null; address1: string | null; address2: string | null; city: string | null; state: string | null; zip: string | null;
  source: string | null; household: string | null; tags: string[]; dob: string | null; drivers_license: string | null; fein: string | null; preferred_channel: string; do_not_call: boolean; email_opt_out: boolean;
  sms_consent_at: Date | null; client_since: string | null; inactive_reason: string | null; notes: string | null; am: string | null; producer: string | null; csr: string | null; branch: string | null; created_at: Date };

// A date of birth or license number shows nothing at all; only a FEIN keeps a hint (SEC-023).
const mask = (v: string | null, show: boolean, hint = false) => (!v ? "—" : show ? v : hint ? `${HIDDEN} ${v.slice(-4)}` : HIDDEN);

type SearchParams = Record<string, string | undefined>;

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  const c = await one<Client>(`SELECT c.*, am.full_name AS am, pr.full_name AS producer, cs.full_name AS csr, b.name AS branch FROM clients c
    LEFT JOIN users am ON am.id = c.account_manager_id LEFT JOIN users pr ON pr.id = c.producer_id LEFT JOIN users cs ON cs.id = c.csr_id LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = $1`, [id]);
  if (!c) notFound();
  const user = await currentUser();
  const pii = can(user, "pii");
  const tab = sp.tab ?? "overview";
  const today = todayISO();
  const [counts, policies] = await Promise.all([
    one<{ tasks: number; claims: number; certs: number; contacts: number; docs: number; emails: number; items: number; ar: string; invoices: number }>(
      `SELECT (SELECT count(*)::int FROM activities WHERE client_id = $1 AND status IN ('open','waiting')) AS tasks,
              (SELECT count(*)::int FROM claims WHERE client_id = $1) AS claims,
              (SELECT count(*)::int FROM certificates WHERE client_id = $1) AS certs,
              (SELECT count(*)::int FROM contacts WHERE client_id = $1) AS contacts,
              (SELECT count(*)::int FROM documents WHERE client_id = $1 AND active) AS docs,
              (SELECT count(*)::int FROM emails WHERE client_id = $1) AS emails,
              (SELECT count(*)::int FROM insured_items WHERE client_id = $1 AND active) AS items,
              (SELECT count(*)::int FROM invoices WHERE client_id = $1) AS invoices,
              (SELECT coalesce(sum(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0)),0)::text
                 FROM invoices i WHERE i.client_id = $1 AND i.status IN ('open','partial')) AS ar`, [id]),
    q<{ id: number; policy_number: string; lob: string; carrier: string; status: string; effective_date: string; expiration_date: string; premium: string; bill_mode: string; renewal_stage: string; new_renewal: string }>(
      `SELECT p.id, p.policy_number, p.lob, ca.name AS carrier, p.status, p.effective_date, p.expiration_date, p.premium, p.bill_mode, p.renewal_stage, p.new_renewal
         FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.client_id = $1 ORDER BY (p.status IN ('active','bound','pending_cancel')) DESC, p.expiration_date DESC`, [id]),
  ]);
  const inForce = policies.filter((p) => ["active", "bound", "pending_cancel"].includes(p.status));
  const premium = inForce.reduce((s, p) => s + Number(p.premium), 0);
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "policies", label: "Policies", count: policies.length }, { key: "activity", label: "Activity", count: counts!.tasks },
    { key: "contacts", label: "Contacts", count: counts!.contacts }, { key: "schedules", label: "Schedules", count: counts!.items }, { key: "certificates", label: "Certificates", count: counts!.certs },
    { key: "claims", label: "Claims", count: counts!.claims }, { key: "billing", label: "Billing", count: counts!.invoices }, { key: "documents", label: "Documents", count: counts!.docs }, { key: "emails", label: "Email", count: counts!.emails },
  ].map((t) => ({ ...t, href: `/clients/${id}?tab=${t.key}` }));

  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/clients", label: "Clients" }]}
        title={<span className="flex items-center gap-3">{c.name}<Status s={c.status} />{c.do_not_call && <Pill tone="red">Do not call</Pill>}</span>}
        subtitle={<>{c.code} · {c.kind === "individual" ? "Personal lines" : c.industry ?? "Commercial"} · {c.city}, {c.state}{c.client_since && <> · client since {whenDate(c.client_since)}</>}</>}
        actions={can(user, "write") && <>
          <Link href={`/sales/new?client=${id}`} className={cls.btn}>＋ Opportunity</Link>
          <Link href={`/tasks/new?client=${id}`} className={cls.btn}>＋ Task</Link>
          <Link href={`/policies/new?client=${id}`} className={cls.btn}>＋ Policy</Link>
          {c.kind === "business" && <Link href={`/certificates/new?client=${id}`} className={cls.btn}>Issue certificate</Link>}
          <Link href={`/claims/new?client=${id}`} className={cls.btn}>Record claim</Link>
          <Link href={`/clients/${id}/edit`} className={cls.btnPrimary}>Edit</Link>
        </>} />
      <Tabs tabs={tabs} current={tab} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="In-force premium" value={money(premium)} sub={`${inForce.length} policies`} />
              <Stat label="Open tasks" value={counts!.tasks} href={`/clients/${id}?tab=activity`} tone={counts!.tasks ? "amber" : "slate"} />
              <Stat label="Open balance" value={money(counts!.ar)} href={`/clients/${id}?tab=billing`} tone={Number(counts!.ar) > 0 ? "red" : "slate"} />
              <Stat label="Claims" value={counts!.claims} href={`/clients/${id}?tab=claims`} />
            </div>
            <Card title="In-force policies" action={<Link href={`/clients/${id}?tab=policies`} className={cls.link}>All policies</Link>}>
              {inForce.length === 0 ? <Empty>No policies in force.</Empty> : (
                <Table head={["Policy", "Line", "Carrier", "Term", { label: "Premium", num: true }, "Renewal"]}>
                  {inForce.map((p) => {
                    const left = daysBetween(today, p.expiration_date);
                    return <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className={cls.td}><Link href={`/policies/${p.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{p.policy_number}</Link> {p.status !== "active" && <Status s={p.status} />}</td>
                      <td className={cls.td}>{lobLabel(p.lob)}</td><td className={`${cls.td} text-xs`}>{p.carrier}</td>
                      <td className={`${cls.td} text-xs tabular-nums`}>{p.effective_date} → {p.expiration_date}</td>
                      <td className={cls.num}>{money(p.premium)}{p.bill_mode === "agency" && <div className="text-[11px] text-slate-400">agency bill</div>}</td>
                      <td className={cls.td}>{left <= 120 ? <span className="flex items-center gap-1"><span className={`text-xs tabular-nums ${left <= 30 ? "text-rose-600" : "text-slate-500"}`}>{left}d</span><Status s={p.renewal_stage} /></span> : <span className="text-xs text-slate-400">{left}d</span>}</td>
                    </tr>;
                  })}
                </Table>
              )}
            </Card>
            <OpenWork clientId={id} />
            <Card title="Ask about this account" pad>
              <form action={askAction} className="flex gap-2"><input type="hidden" name="id" value={id} />
                <input name="question" placeholder={c.kind === "business" ? "e.g. Does their GL have waiver of subrogation? When does the umbrella renew?" : "e.g. What are the auto deductibles? Is there a mortgagee on the home?"} className={cls.input} disabled={!aiEnabled()} />
                <Submit className={cls.btnPrimary} pending="Asking…">Ask</Submit>
              </form>
              {!aiEnabled() && <p className="mt-2 text-xs text-slate-500">Account Q&amp;A uses Claude: set ANTHROPIC_API_KEY to turn it on.</p>}
              <AiNotes clientId={id} />
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Details" pad action={<Link href={`/clients/${id}/edit`} className={cls.link}>Edit</Link>}>
              <KV cols={1} items={[
                ["Address", [c.address1, c.address2, `${c.city ?? ""}, ${c.state ?? ""} ${c.zip ?? ""}`].filter(Boolean).join(", ")],
                ["Phone", c.phone], ["Email", c.email ? <a key="e" href={`mailto:${c.email}`} className={cls.link}>{c.email}</a> : null],
                ...(c.website ? [["Website", c.website] as [string, string]] : []),
                ["Prefers", <span key="p">{c.preferred_channel}{c.email_opt_out && <Pill tone="amber">no marketing email</Pill>}{c.sms_consent_at && <Pill tone="green">SMS consent</Pill>}</span>],
                ["Account manager", c.am], ["Producer", c.producer], ["CSR", c.csr], ["Branch", c.branch],
                ...(c.kind === "business" ? [["NAICS · employees · revenue", `${c.naics ?? "—"} · ${c.employees ?? "—"} · ${c.annual_revenue ? money(c.annual_revenue) : "—"}`] as [string, string], ["FEIN", mask(c.fein, pii, true)] as [string, string]]
                  : [["Date of birth", mask(c.dob, pii)] as [string, string], ["Driver's license", mask(c.drivers_license, pii)] as [string, string]]),
                ["Source", c.source], ["Tags", c.tags.length ? <span key="t" className="flex flex-wrap gap-1">{c.tags.map((t) => <Pill key={t}>{t}</Pill>)}</span> : "—"],
              ]} />
              {!pii && <p className="mt-3 text-[11px] text-slate-400">Sensitive identifiers are masked for your role.</p>}
              {c.notes && <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{c.notes}</p>}
            </Card>
            <Card title="Client experience" pad>
              <div className="flex flex-wrap gap-2"><NotInMvp id="PRT-01" /><NotInMvp id="SAL-19" label="Add to drip campaign" /><NotInMvp id="SAL-29" /><NotInMvp id="SAL-26" label="Send NPS survey" /></div>
            </Card>
            {can(user, "write") && (
              <Card title="Account status" pad>
                <form action={setClientStatusAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                  {c.status === "inactive" ? <><p className="text-xs text-slate-500">Inactive: {c.inactive_reason}</p><input type="hidden" name="status" value="active" /><Submit className={cls.btnSm}>Reactivate</Submit></>
                    : <><input type="hidden" name="status" value="inactive" /><input name="reason" placeholder="Reason (e.g. moved out of state)" className={cls.input} /><Submit className={cls.btnSm} confirm="Inactivate this client?">Inactivate</Submit></>}
                </form>
                {can(user, "team") && <MergeForm id={id} name={c.name} code={c.code} />}
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "policies" && (
        <Card>
          <Table head={["Policy", "Line", "Carrier", "Status", "Term", { label: "Premium", num: true }, "Type", "Bill"]} empty="No policies yet.">
            {policies.map((p) => <tr key={p.id} className="hover:bg-slate-50/70">
              <td className={cls.td}><Link href={`/policies/${p.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{p.policy_number}</Link></td>
              <td className={cls.td}>{lobLabel(p.lob)}</td><td className={`${cls.td} text-xs`}>{p.carrier}</td><td className={cls.td}><Status s={p.status} /></td>
              <td className={`${cls.td} text-xs tabular-nums`}>{p.effective_date} → {p.expiration_date}</td><td className={cls.num}>{money(p.premium)}</td>
              <td className={`${cls.td} text-xs`}>{p.new_renewal}</td><td className={`${cls.td} text-xs`}>{p.bill_mode}</td>
            </tr>)}
          </Table>
          <p className="px-4 py-2 text-xs text-slate-400">{POLICY_STATUS_LABEL.expired} terms stay on file with their renewal chain.</p>
        </Card>
      )}

      {tab === "activity" && <ActivityTab clientId={id} canWrite={can(user, "write")} viewer={{ id: user.id, pii: can(user, "pii") }} sp={sp} />}
      {tab === "contacts" && <ContactsTab clientId={id} pii={pii} canWrite={can(user, "write")} editId={Number(sp.edit) || null} />}
      {tab === "schedules" && <SchedulesTab clientId={id} canWrite={can(user, "write")} pii={pii} />}
      {tab === "certificates" && <CertsTab clientId={id} sp={sp} />}
      {tab === "claims" && <ClaimsTab clientId={id} sp={sp} />}
      {tab === "billing" && <BillingTab clientId={id} clientName={c.name} canPost={can(user, "accounting")} />}
      {tab === "documents" && <DocsTab clientId={id} pii={pii} canWrite={can(user, "write") || can(user, "accounting")} policies={inForce} sp={sp} />}
      {tab === "emails" && <EmailsTab clientId={id} sp={sp} />}
    </div>
  );
}

async function OpenWork({ clientId }: { clientId: number }) {
  const tasks = await listTasks({ clientId, status: "active", limit: 12 });
  return (
    <Card title="Open work" action={<Link href={`/tasks/new?client=${clientId}`} className={cls.link}>＋ Task</Link>}>
      {tasks.length === 0 ? <Empty>No open tasks.</Empty> : <ul className="divide-y divide-slate-100">{tasks.map((t) => <TaskLine key={t.id} t={t} showOwner showReasons={false} />)}</ul>}
    </Card>
  );
}

async function AiNotes({ clientId }: { clientId: number }) {
  const notes = await q<{ id: number; body: string; created_at: Date; author: string | null }>(
    "SELECT n.id, n.body, n.created_at, u.full_name AS author FROM activity_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.client_id = $1 AND n.activity_id IS NULL AND n.body LIKE 'Asked Claude:%' ORDER BY n.id DESC LIMIT 3", [clientId]);
  return notes.length ? <ul className="mt-3 space-y-2">{notes.map((n) => <li key={n.id} className="rounded-md bg-indigo-50/60 px-3 py-2 text-sm text-slate-700"><div className="mb-1 text-[11px] text-slate-500">{n.author} · {whenShort(n.created_at)}</div><p className="whitespace-pre-wrap">{n.body.replace(/^Asked Claude: /, "Q: ")}</p></li>)}</ul> : null;
}

async function ActivityTab({ clientId, canWrite, viewer, sp }: { clientId: number; canWrite: boolean; viewer: NoteViewer; sp: SearchParams }) {
  const [tasks, allNotes] = await Promise.all([
    listTasks({ clientId, limit: 5000 }),
    q<{ id: number; body: string; kind: string; created_at: Date; author: string | null; author_id: number | null; activity_id: number | null; confidential: boolean }>(
      "SELECT n.id, n.body, n.kind, n.created_at, u.full_name AS author, n.author_id, n.activity_id, n.confidential FROM activity_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.client_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 5000", [clientId]),
  ]);
  const notes = hideConfidential(allNotes, viewer);
  const atTasks = paging(sp.page_tasks, tasks.length);
  const atNotes = paging(sp.page_notes, notes.length);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={`Tasks · ${tasks.length}`}>
        <ul className="divide-y divide-slate-100">{pageOf(tasks, atTasks).map((t) => <TaskLine key={t.id} t={t} showOwner showReasons={false} actions={t.status === "open" || t.status === "waiting"} />)}</ul>
        <Pager at={atTasks} href={(page) => qs(sp, { page_tasks: String(page) })} label="Client task pages" />
      </Card>
      <Card title="Notes and calls">
        {canWrite && (
          <form action={noteAction} className="space-y-2 border-b border-slate-100 p-4"><input type="hidden" name="client_id" value={clientId} />
            <textarea name="body" rows={2} placeholder="Log a call or add an account note" className={cls.input} />
            <div className="flex items-center gap-3 text-xs"><select name="kind" className="rounded border border-slate-300 px-2 py-1"><option value="call">Phone call</option><option value="note">Note</option><option value="email_out">Email sent</option></select>
              <label className="flex items-center gap-1"><input type="checkbox" name="confidential" /> Confidential</label><Submit className={`${cls.btnSm} ml-auto`}>Save</Submit></div>
          </form>
        )}
        {notes.length === 0 ? <Empty>No notes.</Empty> : <ul className="divide-y divide-slate-100">{pageOf(notes, atNotes).map((n) => (
          <li key={n.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-xs text-slate-500"><span className="font-medium text-slate-700">{n.author ?? "System"}</span><span>{whenShort(n.created_at)}</span><Pill tone={n.kind === "call" ? "blue" : "slate"}>{n.kind}</Pill>{n.confidential && <Pill tone="red">confidential</Pill>}{n.activity_id && <Link href={`/tasks/${n.activity_id}`} className={cls.link}>task</Link>}</div>
            <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{n.body}</p>
          </li>))}</ul>}
        <Pager at={atNotes} href={(page) => qs(sp, { page_notes: String(page) })} label="Client note pages" />
      </Card>
    </div>
  );
}

async function ContactsTab({ clientId, pii, canWrite, editId }: { clientId: number; pii: boolean; canWrite: boolean; editId: number | null }) {
  const contacts = await q<{ id: number; first_name: string; last_name: string; title: string | null; email: string | null; phone: string | null; mobile: string | null; is_primary: boolean; is_billing: boolean; dob: string | null; license_number: string | null }>(
    "SELECT * FROM contacts WHERE client_id = $1 ORDER BY is_primary DESC, last_name", [clientId]);
  const edit = contacts.find((x) => x.id === editId);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <Table head={["Name", "Title", "Email", "Phone", "Roles", ...(pii ? ["DOB / license"] : []), ""]} empty="No contacts.">
          {contacts.map((ct) => <tr key={ct.id}>
            <td className={`${cls.td} font-medium`}>{ct.first_name} {ct.last_name}</td><td className={`${cls.td} text-xs`}>{ct.title ?? "—"}</td>
            <td className={`${cls.td} text-xs`}>{ct.email ? <a href={`mailto:${ct.email}`} className={cls.link}>{ct.email}</a> : "—"}</td>
            <td className={`${cls.td} text-xs`}>{ct.phone ?? ct.mobile ?? "—"}</td>
            <td className={cls.td}><span className="flex gap-1">{ct.is_primary && <Pill tone="indigo">primary</Pill>}{ct.is_billing && <Pill>billing</Pill>}</span></td>
            {pii && <td className={`${cls.td} text-xs`}>{ct.dob ?? "—"} · {ct.license_number ?? "—"}</td>}
            <td className={`${cls.td} text-right`}>{canWrite && <span className="flex justify-end gap-1"><Link href={`/clients/${clientId}?tab=contacts&edit=${ct.id}`} className={cls.btnSm}>Edit</Link>
              <form action={deleteContactAction}><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="contact_id" value={ct.id} /><Submit className={cls.btnSm} confirm="Remove this contact?">Remove</Submit></form></span>}</td>
          </tr>)}
        </Table>
      </Card>
      {canWrite && (
        <Card title={edit ? `Edit ${edit.first_name} ${edit.last_name}` : "Add contact"} pad>
          <form action={saveContactAction} className="grid grid-cols-2 gap-3" key={edit?.id ?? "new"}>
            <input type="hidden" name="client_id" value={clientId} />{edit && <input type="hidden" name="contact_id" value={edit.id} />}
            <Field label="First"><input name="first_name" required defaultValue={edit?.first_name} className={cls.input} /></Field>
            <Field label="Last"><input name="last_name" required defaultValue={edit?.last_name} className={cls.input} /></Field>
            <Field label="Title" className="col-span-2"><input name="title" defaultValue={edit?.title ?? ""} className={cls.input} /></Field>
            <Field label="Email" className="col-span-2"><input name="email" type="email" defaultValue={edit?.email ?? ""} className={cls.input} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={edit?.phone ?? ""} className={cls.input} /></Field>
            <Field label="Mobile"><input name="mobile" defaultValue={edit?.mobile ?? ""} className={cls.input} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_primary" defaultChecked={edit?.is_primary} /> Primary</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_billing" defaultChecked={edit?.is_billing} /> Billing</label>
            <div className="col-span-2 flex gap-2"><Submit className={cls.btnPrimary}>Save contact</Submit>{edit && <Link href={`/clients/${clientId}?tab=contacts`} className={cls.btn}>Cancel</Link>}</div>
          </form>
        </Card>
      )}
    </div>
  );
}

async function SchedulesTab({ clientId, canWrite, pii }: { clientId: number; canWrite: boolean; pii: boolean }) {
  const items = await q<{ id: number; kind: string; label: string; data: Record<string, unknown>; policies: string | null }>(
    `SELECT i.id, i.kind, i.label, i.data, (SELECT string_agg(p.policy_number, ', ') FROM policy_items pi JOIN policies p ON p.id = pi.policy_id WHERE pi.item_id = i.id AND p.status IN ('active','bound','pending_cancel')) AS policies
       FROM insured_items i WHERE i.client_id = $1 AND i.active ORDER BY i.kind, i.id`, [clientId]);
  const kinds = [...new Set(items.map((i) => i.kind))];
  const LABEL: Record<string, string> = { vehicle: "Vehicles", driver: "Drivers", location: "Locations", dwelling: "Dwellings", class_code: "Class codes / exposures", watercraft: "Watercraft", equipment: "Equipment" };
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {kinds.length === 0 && <Card><Empty>No vehicles, drivers, locations or exposures on file.</Empty></Card>}
        {kinds.map((k) => (
          <Card key={k} title={`${LABEL[k] ?? k} · ${items.filter((i) => i.kind === k).length}`}>
            <ul className="divide-y divide-slate-100">{items.filter((i) => i.kind === k).map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><div className="font-medium text-slate-800">{i.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">{itemDetails(i.kind, i.data, pii).map(([key, v]) => <span key={key}>{key}: <span className="text-slate-700">{typeof v === "number" && v > 9999 ? money(v) : String(v)}</span></span>)}</div>
                  {i.policies && <div className="mt-0.5 text-[11px] text-slate-400">On {i.policies}</div>}</div>
                {canWrite && <form action={removeItemAction}><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="item_id" value={i.id} /><Submit className={cls.btnSm} confirm="Remove from the schedule?">Remove</Submit></form>}
              </li>))}</ul>
          </Card>
        ))}
      </div>
      {canWrite && (
        <Card title="Add to schedule" pad>
          <form action={addItemAction} className="space-y-3"><input type="hidden" name="client_id" value={clientId} />
            <Field label="Kind"><select name="kind" className={cls.input}>{Object.entries(LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Description" hint="e.g. 2026 Ford F-250, Jane Doe, 12 Main St"><input name="label" required className={cls.input} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="VIN / license / class code"><input name="d_identifier" className={cls.input} /></Field>
              <Field label="Year / DOB"><input name="d_year" className={cls.input} /></Field>
              <Field label="Value / payroll"><input name="d_value" className={cls.input} /></Field>
              <Field label="State"><input name="d_state" className={cls.input} /></Field>
            </div>
            <Field label="Notes"><input name="d_notes" className={cls.input} /></Field>
            <Submit className={cls.btnPrimary}>Add</Submit>
            <p className="text-[11px] text-slate-500">Adding to the schedule doesn&apos;t change a policy: endorse the policy to add coverage.</p>
          </form>
        </Card>
      )}
    </div>
  );
}

async function CertsTab({ clientId, sp }: { clientId: number; sp: SearchParams }) {
  const certs = await q<{ id: number; cert_number: string; holder: string | null; status: string; issued_at: Date | null; issued_by: string | null; additional_insured: boolean; waiver_of_subrogation: boolean; primary_noncontributory: boolean }>(
    `SELECT ce.id, ce.cert_number, oi.name AS holder, ce.status, ce.issued_at, u.full_name AS issued_by, ce.additional_insured, ce.waiver_of_subrogation, ce.primary_noncontributory
       FROM certificates ce LEFT JOIN other_interests oi ON oi.id = ce.holder_id LEFT JOIN users u ON u.id = ce.issued_by_id WHERE ce.client_id = $1 ORDER BY ce.issued_at DESC NULLS FIRST, ce.id DESC`, [clientId]);
  const at = paging(sp.page, certs.length);
  return (
    <Card action={<Link href={`/certificates/new?client=${clientId}`} className={cls.btnSm}>Issue certificate</Link>} title={`Certificates · ${certs.length}`}>
      <Table head={["Certificate", "Holder", "Wording", "Issued", "Status", ""]} empty="No certificates issued.">
        {pageOf(certs, at).map((ce) => <tr key={ce.id}>
          <td className={cls.td}><Link href={`/certificates/${ce.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{ce.cert_number}</Link></td>
          <td className={cls.td}>{ce.holder ?? "—"}</td>
          <td className={cls.td}><span className="flex flex-wrap gap-1">{ce.additional_insured && <Pill>Add&apos;l insured</Pill>}{ce.waiver_of_subrogation && <Pill>Waiver</Pill>}{ce.primary_noncontributory && <Pill>Primary/NC</Pill>}</span></td>
          <td className={`${cls.td} text-xs`}>{ce.issued_at ? whenShort(ce.issued_at) : "—"}<div className="text-slate-400">{ce.issued_by}</div></td>
          <td className={cls.td}><Status s={ce.status} /></td>
          <td className={`${cls.td} text-right`}><a href={`/documents/render?kind=certificate&certificate=${ce.id}`} className={cls.btnSm}>PDF</a></td>
        </tr>)}
      </Table>
      <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Certificate pages" />
    </Card>
  );
}

async function ClaimsTab({ clientId, sp }: { clientId: number; sp: SearchParams }) {
  const claims = await q<{ id: number; claim_number: string; carrier_claim_number: string | null; kind: string; loss_date: string; status: string; policy_number: string | null; adjuster_name: string | null }>(
    "SELECT cl.id, cl.claim_number, cl.carrier_claim_number, cl.kind, cl.loss_date, cl.status, p.policy_number, cl.adjuster_name FROM claims cl LEFT JOIN policies p ON p.id = cl.policy_id WHERE cl.client_id = $1 ORDER BY cl.loss_date DESC", [clientId]);
  const at = paging(sp.page, claims.length);
  return (
    <Card title={`Claims · ${at.total}`} action={<Link href={`/claims/new?client=${clientId}`} className={cls.btnSm}>Record claim</Link>}>
      <Table head={["Claim", "Carrier claim #", "Type", "Loss date", "Policy", "Adjuster", "Status"]} empty="No claims on file.">
        {pageOf(claims, at).map((cl) => <tr key={cl.id}>
          <td className={cls.td}><Link href={`/claims/${cl.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{cl.claim_number}</Link></td>
          <td className={`${cls.td} font-mono text-xs`}>{cl.carrier_claim_number ?? "—"}</td><td className={cls.td}>{cl.kind}</td>
          <td className={`${cls.td} text-xs`}>{cl.loss_date}</td><td className={`${cls.td} font-mono text-xs`}>{cl.policy_number ?? "—"}</td>
          <td className={`${cls.td} text-xs`}>{cl.adjuster_name ?? "—"}</td><td className={cls.td}><Status s={cl.status} /></td>
        </tr>)}
      </Table>
      <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Claim pages" />
    </Card>
  );
}

async function BillingTab({ clientId, clientName, canPost }: { clientId: number; clientName: string; canPost: boolean }) {
  const [invoices, receipts] = await Promise.all([
    q<{ id: number; invoice_number: string; issue_date: string; due_date: string; total: string; status: string; memo: string | null; paid: string; policy_number: string | null }>(
      `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.total, i.status, i.memo, p.policy_number,
              coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0)::text AS paid
         FROM invoices i LEFT JOIN policies p ON p.id = i.policy_id WHERE i.client_id = $1 ORDER BY i.issue_date DESC`, [clientId]),
    q<{ id: number; receipt_number: string; received_date: string; amount: string; method: string; reference: string | null; status: string }>(
      "SELECT id, receipt_number, received_date, amount, method, reference, status FROM receipts WHERE client_id = $1 ORDER BY received_date DESC", [clientId]),
  ]);
  const today = todayISO();
  const balance = (i: { total: string; paid: string }) => Number(i.total) - Number(i.paid);
  const credits = invoices.filter((i) => i.status === "open" && balance(i) < 0), debits = invoices.filter((i) => ["open", "partial"].includes(i.status) && balance(i) > 0);
  return (
    <div className="space-y-5">
      {canPost && credits.length > 0 && debits.length > 0 && (
        <Card title="Apply a credit to an invoice" pad>
          <form action={applyCreditAction} className="grid items-end gap-3 sm:grid-cols-4">
            <input type="hidden" name="back" value={`/clients/${clientId}?tab=billing`} />
            <Field label="Credit"><select name="credit_id" className={cls.input}>{credits.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {money(-balance(i), true)}</option>)}</select></Field>
            <Field label="Invoice"><select name="invoice_id" className={cls.input}>{debits.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {money(balance(i), true)} owed</option>)}</select></Field>
            <Field label="Amount" hint="Blank applies as much as it can"><input name="amount" inputMode="decimal" className={cls.input} /></Field>
            <Submit className={cls.btnPrimary}>Apply credit</Submit>
          </form>
        </Card>
      )}
      <Card title="Agency-bill invoices" action={<span className="flex gap-2">{canPost && <Link href={`/accounting/receipts/new?client=${clientId}`} className={cls.btnSm}>Record payment</Link>}<NotInMvp id="CSH-09" label="Send payment link" variant="inline" /></span>}>
        <Table head={["Invoice", "Policy", "Issued", "Due", { label: "Total", num: true }, { label: "Balance", num: true }, "Status", ""]} empty="No agency-bill invoices. Direct-bill policies are billed by the carrier.">
          {invoices.map((i) => { const bal = Number(i.total) - Number(i.paid); return <tr key={i.id}>
            <td className={cls.td}><span className="font-mono text-xs">{i.invoice_number}</span><div className="text-xs text-slate-400">{i.memo}</div></td>
            <td className={`${cls.td} font-mono text-xs`}>{i.policy_number ?? "—"}</td><td className={`${cls.td} text-xs`}>{i.issue_date}</td>
            <td className={`${cls.td} text-xs ${bal > 0 && i.due_date < today ? "font-medium text-rose-600" : ""}`}>{i.due_date}</td>
            <td className={cls.num}>{money(i.total, true)}</td><td className={cls.num}>{money(bal, true)}</td><td className={cls.td}><Status s={i.status} /></td>
            <td className={`${cls.td} text-right`}>{bal < 0 && i.status === "open" && canPost ? <form action={refundAction} className="flex justify-end gap-1"><input type="hidden" name="invoice_id" value={i.id} /><input type="hidden" name="back" value={`/clients/${clientId}?tab=billing`} /><Submit className={cls.btnSm} confirm={`Refund ${money(-bal, true)} to ${clientName} from trust?`}>Refund {money(-bal, true)}</Submit></form> : <a href={`/documents/render?kind=invoice&invoice=${i.id}`} className={cls.btnSm}>PDF</a>}</td>
          </tr>; })}
        </Table>
      </Card>
      <Card title="Payments received">
        <Table head={["Receipt", "Date", { label: "Amount", num: true }, "Method", "Reference", "Status"]} empty="No payments recorded.">
          {receipts.map((r) => <tr key={r.id}><td className={`${cls.td} font-mono text-xs`}>{r.receipt_number}</td><td className={`${cls.td} text-xs`}>{r.received_date}</td><td className={cls.num}>{money(r.amount, true)}</td><td className={`${cls.td} text-xs`}>{r.method}</td><td className={`${cls.td} text-xs`}>{r.reference ?? "—"}</td><td className={cls.td}><Status s={r.status} /></td></tr>)}
        </Table>
      </Card>
    </div>
  );
}

async function DocsTab({ clientId, pii, canWrite, policies, sp }: { clientId: number; pii: boolean; canWrite: boolean; policies: { id: number; policy_number: string; lob: string }[]; sp: SearchParams }) {
  const docs = await q<{ id: number; folder: string; title: string; created_at: Date; restricted: boolean; uploaded_by: string | null; policy_number: string | null; size: number }>(
    `SELECT d.id, d.folder, d.title, d.created_at, d.restricted, u.full_name AS uploaded_by, p.policy_number, d.size FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by_id LEFT JOIN policies p ON p.id = d.policy_id
      WHERE d.client_id = $1 AND d.active ORDER BY d.created_at DESC`, [clientId]);
  const at = paging(sp.page, docs.length);
  const shown = pageOf(docs, at);
  const folders = [...new Set(shown.map((d) => d.folder))];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {folders.length === 0 && <Card><Empty>No documents.</Empty></Card>}
        {folders.map((f) => (
          <Card key={f} title={`${f} · ${docs.filter((d) => d.folder === f).length}`}>
            <ul className="divide-y divide-slate-100">{shown.filter((d) => d.folder === f).map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="text-slate-400">📄</span>
                <div className="min-w-0 flex-1">{d.restricted && !pii ? <span className="text-slate-400">{d.title} (restricted)</span> : <a href={`/documents/${d.id}`} className="text-slate-800 hover:text-indigo-700">{d.title}</a>}
                  <div className="text-xs text-slate-400">{whenShort(d.created_at)}{d.policy_number ? ` · ${d.policy_number}` : ""}{d.uploaded_by ? ` · ${d.uploaded_by}` : ""} · {Math.round(d.size / 1024)} KB</div></div>
                {d.restricted && <Pill tone="red">restricted</Pill>}
              </li>))}</ul>
          </Card>
        ))}
        {at.pages > 1 && <Card><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Document pages" /></Card>}
      </div>
      {canWrite && (
        <Card title="Upload document" pad>
          <form action={uploadDocumentAction} className="space-y-3"><input type="hidden" name="client_id" value={clientId} />
            <Field label="File"><input type="file" name="file" required className="text-sm" /></Field>
            <Field label="Title (optional)"><input name="title" className={cls.input} /></Field>
            <Field label="Folder"><select name="folder" className={cls.input}>{DOC_FOLDERS.map((f) => <option key={f}>{f}</option>)}</select></Field>
            <Field label="Policy"><select name="policy_id" className={cls.input}><option value="">None</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number} · {lobLabel(p.lob)}</option>)}</select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restricted" /> Restricted (sensitive: only roles with PII access)</label>
            <Submit className={cls.btnPrimary}>Upload</Submit>
          </form>
        </Card>
      )}
    </div>
  );
}

async function EmailsTab({ clientId, sp }: { clientId: number; sp: SearchParams }) {
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM emails WHERE client_id = $1", [clientId]);
  const at = paging(sp.page, count!.n);
  const emails = await q<{ id: number; subject: string; from_addr: string; original_from_addr: string | null; received_at: Date; direction: string; status: string; activity_id: number | null }>(
    "SELECT id, subject, from_addr, original_from_addr, received_at, direction, status, activity_id FROM emails WHERE client_id = $1 ORDER BY received_at DESC, id DESC LIMIT $2 OFFSET $3", [clientId, at.size, at.offset]);
  return (
    <Card title={`Email · ${at.total}`}>
      <Table head={["Subject", "From", "Received", "Direction", "Status"]} empty="No email on file for this client.">
        {emails.map((e) => <tr key={e.id}>
          <td className={cls.td}><Link href={`/inbox/${e.id}`} className="text-slate-800 hover:text-indigo-700">{e.subject}</Link>{e.activity_id && <Link href={`/tasks/${e.activity_id}`} className="ml-2 text-xs text-indigo-600">task</Link>}</td>
          <td className={`${cls.td} text-xs`}>{e.original_from_addr ?? e.from_addr}</td><td className={`${cls.td} text-xs`}>{whenShort(e.received_at)}</td>
          <td className={`${cls.td} text-xs`}>{e.direction}</td><td className={cls.td}><Status s={e.status} /></td>
        </tr>)}
      </Table>
      <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Email pages" />
    </Card>
  );
}
