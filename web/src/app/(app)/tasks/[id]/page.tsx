import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelAction, checklistAction, completeAction, noteAction, reassignAction, resumeAction, snoozeAction, updateAction, waitingAction, completeAndNextAction, waitingAndNextAction } from "../actions";
import { ClientPicker } from "@/components/client-picker";
import { Submit } from "@/components/submit";
import { TaskFlash } from "@/components/tasks";
import { Card, Empty, Field, KV, PageHeader, Pill, PriorityBadge, Reasons, Status, cls } from "@/components/ui";
import { NotInMvp } from "@/components/not-mvp";
import { one, q } from "@/lib/db";
import { addDays, daysBetween, money, todayISO, when, whenDate, whenShort } from "@/lib/format";
import { daysLeft, scoreTask } from "@/lib/priority";
import { lobLabel } from "@/lib/ref";
import { activeUsers, can, currentUser, mayActOn } from "@/lib/user";
import { notesFor, taskById } from "@/lib/work";

export const metadata = { title: "Task" };

// The task focus view: everything needed to finish one piece of work on one screen. The left side
// is the work (what's needed, the email it came from, the checklist, the notes); the right side is
// how to finish it (complete, wait, snooze, reassign) and the client's context, with shortcuts to
// the screen that does the job (issue a certificate, endorse a policy, record a claim).

type Ctx = { id: number; name: string; code: string; phone: string | null; email: string | null; preferred_channel: string; do_not_call: boolean; am: string | null; producer: string | null; kind: string; status: string };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; focus?: string; undo?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await taskById(Number(id));
  if (!t) notFound();
  const user = await currentUser();
  const canAct = mayActOn(user, t.owner_id);
  const today = todayISO();
  const scored = scoreTask(t, today);
  const open = t.status === "open" || t.status === "waiting";
  const [notes, users, checklist, email, attachments, client, policies, history, alsoOpen] = await Promise.all([
    notesFor(t.id, { id: user.id, pii: can(user, "pii") }),
    activeUsers(),
    one<{ checklist: { label: string; done: boolean }[]; outcome: string | null; completed_at: Date | null; completed_by: string | null; created_by: string | null }>(
      `SELECT a.checklist, a.outcome, a.completed_at, cu.full_name AS completed_by, cr.full_name AS created_by FROM activities a
         LEFT JOIN users cu ON cu.id = a.completed_by_id LEFT JOIN users cr ON cr.id = a.created_by_id WHERE a.id = $1`, [t.id]),
    t.email_id ? one<{ id: number; from_addr: string; from_name: string | null; original_from_addr: string | null; original_from_name: string | null; to_addrs: string[]; subject: string; body_text: string; sender_verified: boolean | null; direction: string; received_at: Date; classified_by: string | null; match_method: string | null }>(
      "SELECT id, from_addr, from_name, original_from_addr, original_from_name, to_addrs, subject, body_text, sender_verified, direction, received_at, classified_by, match_method FROM emails WHERE id = $1", [t.email_id]) : null,
    t.email_id ? q<{ id: number; title: string }>("SELECT id, title FROM documents WHERE email_id = $1", [t.email_id]) : Promise.resolve([]),
    t.client_id ? one<Ctx>(`SELECT c.id, c.name, c.code, c.phone, c.email, c.preferred_channel, c.do_not_call, c.kind, c.status, am.full_name AS am, pr.full_name AS producer
                              FROM clients c LEFT JOIN users am ON am.id = c.account_manager_id LEFT JOIN users pr ON pr.id = c.producer_id WHERE c.id = $1`, [t.client_id]) : null,
    t.client_id ? q<{ id: number; policy_number: string; lob: string; expiration_date: string; premium: string; status: string; carrier: string }>(
      `SELECT p.id, p.policy_number, p.lob, p.expiration_date, p.premium, p.status, ca.name AS carrier FROM policies p JOIN carriers ca ON ca.id = p.carrier_id
        WHERE p.client_id = $1 AND p.status IN ('active','bound','pending_cancel') ORDER BY p.expiration_date`, [t.client_id]) : Promise.resolve([]),
    t.client_id ? q<{ id: number; subject: string; status: string; completed_at: Date | null; created_at: Date; owner: string | null }>(
      `SELECT a.id, a.subject, a.status, a.completed_at, a.created_at, u.full_name AS owner FROM activities a LEFT JOIN users u ON u.id = a.owner_id
        WHERE a.client_id = $1 AND a.id <> $2 ORDER BY coalesce(a.completed_at, a.created_at) DESC LIMIT 6`, [t.client_id, t.id]) : Promise.resolve([]),
    open && t.policy_id ? q<{ id: number; subject: string }>("SELECT id, subject FROM activities WHERE policy_id = $1 AND code = $2 AND id <> $3 AND status IN ('open','waiting') ORDER BY id", [t.policy_id, t.code, t.id]) : Promise.resolve([]),
  ]);
  const shortcuts: { href: string; label: string }[] = [];
  const pq = t.policy_id ? `&policy=${t.policy_id}` : "";
  if (t.client_id) {
    if (t.code === "CERT-REQ" || t.code === "COI-RENEW") shortcuts.push({ href: `/certificates/new?client=${t.client_id}&task=${t.id}`, label: "Issue certificate" });
    if (t.code === "END-REQ" && t.policy_id) shortcuts.push({ href: `/policies/${t.policy_id}?action=endorse&task=${t.id}`, label: "Endorse policy" });
    if (t.code === "CANC-REQ" && t.policy_id) shortcuts.push({ href: `/policies/${t.policy_id}?action=cancel&task=${t.id}`, label: "Cancel policy" });
    if (t.code === "NONPAY" && t.policy_id) shortcuts.push({ href: `/policies/${t.policy_id}?action=nonpay&task=${t.id}`, label: "Resolve non-pay" });
    if (t.code === "CLAIM-FNOL") shortcuts.push(t.claim_id ? { href: `/claims/${t.claim_id}`, label: "Open claim" } : { href: `/claims/new?client=${t.client_id}${pq}&task=${t.id}`, label: "Record claim" });
    if (t.code === "ID-CARD" && t.policy_id) shortcuts.push({ href: `/documents/render?kind=id_card&policy=${t.policy_id}`, label: "Open ID cards (PDF)" });
    if (t.code === "DOC-REQ" && t.policy_id) shortcuts.push({ href: `/documents/render?kind=dec_page&policy=${t.policy_id}`, label: "Open declarations (PDF)" });
    if (t.category === "Renewal" && t.policy_id) shortcuts.push({ href: `/policies/${t.policy_id}?tab=renewal`, label: "Work the renewal" });
    if ((t.code === "POL-CHECK" || t.code === "NB-SETUP" || t.code === "BINDER-EXP") && t.policy_id) shortcuts.push({ href: `/policies/${t.policy_id}`, label: t.code === "POL-CHECK" ? "Open policy to check" : "Open policy" });
    if (t.code === "BILL-INQ" || t.code === "PAY-POST") shortcuts.push({ href: `/clients/${t.client_id}?tab=billing`, label: "Client billing" });
    if (t.code === "CLAIM-FU" && t.claim_id) shortcuts.push({ href: `/claims/${t.claim_id}`, label: "Open claim" });
  }

  return (
    <div>
      <TaskFlash msg={sp.msg} error={sp.error} undo={sp.undo} />
      <PageHeader crumbs={[{ href: "/", label: "My day" }, { href: "/tasks", label: "Tasks" }]}
        title={t.subject}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{t.code_label}</span><PriorityBadge p={t.priority} /><Status s={t.status} />
          <span>· {t.owner_name ?? "Unassigned"}</span><span>· {t.status === "waiting" ? `waiting on ${t.waiting_on}, back ${t.follow_up_date ? whenDate(t.follow_up_date) : "no date set"}` : `due ${whenDate(t.due_date)}`}</span>
          {t.snoozed_until && t.snoozed_until > today && <Pill tone="violet">snoozed to {whenDate(t.snoozed_until)}</Pill>}
          {open && <span title="Priority score">· score {scored.score}</span>}</span>}
        actions={sp.focus ? <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">Focus mode · your top task</span> : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="What's needed" pad>
            {open && scored.reasons.length > 0 && <div className="mb-3"><Reasons reasons={scored.reasons} max={8} /></div>}
            {alsoOpen.length > 0 && <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">Also open on this policy: {alsoOpen.map((a, i) => <span key={a.id}>{i > 0 && " · "}<Link href={`/tasks/${a.id}`} className="font-medium underline">{a.subject}</Link></span>)}</div>}
            {t.description ? <p className="whitespace-pre-wrap text-sm text-slate-700">{t.description}</p> : <p className="text-sm text-slate-500">No description.</p>}
            {shortcuts.length > 0 && open && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {shortcuts.map((s) => <Link key={s.href} href={s.href} className={cls.btnPrimary}>{s.label} →</Link>)}
              </div>
            )}
            {!open && <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600"><span className="min-w-0 flex-1">{t.status === "done" ? "Completed" : "Cancelled"} {checklist?.completed_at ? when(checklist.completed_at) : ""}{checklist?.completed_by ? ` by ${checklist.completed_by}` : ""}{checklist?.outcome ? ` — ${checklist.outcome}` : ""}</span>
              {t.status === "done" && canAct && <form action={resumeAction}><input type="hidden" name="id" value={t.id} /><Submit className={cls.btnSm} pending="Reopening…">Reopen</Submit></form>}</div>}
          </Card>

          {email && (
            <Card title={<>Original email <span className="font-normal text-slate-500">· classified by {email.classified_by === "ai" ? "Claude" : "rules"}{email.match_method ? ` · matched by ${email.match_method}` : ""}</span></>} action={<Link href={`/inbox/${email.id}`} className={cls.link}>Open in inbox</Link>}>
              <div className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                <div><span className="font-medium text-slate-700">{email.original_from_name ?? email.from_name ?? email.from_addr}</span> &lt;{email.original_from_addr ?? email.from_addr}&gt;{email.original_from_addr && <> · forwarded by {email.from_name}</>}</div>
                {email.sender_verified === false && email.direction === "inbound" && <div className="text-amber-700">The mail provider didn&apos;t confirm this sender&apos;s address. Treat the From line as a claim.</div>}
                <div>To {email.to_addrs.join(", ")} · {when(email.received_at)}</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{email.subject}</div>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm text-slate-700">{email.body_text}</pre>
              {attachments.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2.5">{attachments.map((a) => <a key={a.id} href={`/documents/${a.id}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-white">📎 {a.title}</a>)}</div>}
            </Card>
          )}

          {checklist && checklist.checklist.length > 0 && (
            <Card title={`Checklist · ${checklist.checklist.filter((c) => c.done).length}/${checklist.checklist.length}`}>
              <ul className="divide-y divide-slate-100">
                {checklist.checklist.map((c, i) => (
                  <li key={i}>
                    <form action={checklistAction} className="flex items-center gap-3 px-4 py-2">
                      <input type="hidden" name="id" value={t.id} /><input type="hidden" name="index" value={i} />
                      <button disabled={!open || !canAct} className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${c.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 bg-white hover:border-slate-400"}`} aria-label={c.done ? `Mark “${c.label}” not done` : `Mark “${c.label}” done`}>{c.done ? "✓" : ""}</button>
                      <span className={`text-sm ${c.done ? "text-slate-500 line-through" : "text-slate-700"}`}>{c.label}</span>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={`Notes and history · ${notes.length}`}>
            <form action={noteAction} className="space-y-2 border-b border-slate-100 p-4">
              <input type="hidden" name="activity_id" value={t.id} /><input type="hidden" name="client_id" value={t.client_id ?? ""} />
              <textarea name="body" rows={2} placeholder="Add a note: what you did, who you spoke with, what was decided…" className={cls.input} />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <select name="kind" className="rounded border border-slate-300 px-2 py-1 text-xs"><option value="note">Note</option><option value="call">Phone call</option><option value="email_out">Email sent</option></select>
                <label className="flex items-center gap-1"><input type="checkbox" name="confidential" /> Confidential</label>
                <Submit className={`${cls.btnSm} ml-auto`}>Add note</Submit>
              </div>
            </form>
            {notes.length === 0 ? <Empty>No notes yet.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {notes.map((n) => (
                  <li key={n.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2 text-xs text-slate-500"><span className="font-medium text-slate-700">{n.author ?? "System"}</span><span>{whenShort(n.created_at)}</span>{n.kind !== "note" && <Pill tone={n.kind === "system" ? "slate" : "blue"}>{n.kind === "email_out" ? "email" : n.kind}</Pill>}{n.confidential && <Pill tone="red">confidential</Pill>}</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Created {when(t.created_at)}{checklist?.created_by ? ` by ${checklist.created_by}` : t.source === "email" ? " from an email" : t.source === "automation" ? " by daily automation" : ""}</div>
          </Card>
        </div>

        <div className="space-y-5">
          {open && !canAct ? (
            <Card title="Finish this task" pad><p className="text-sm text-slate-500">{t.owner_name ? `This is ${t.owner_name}'s task. Ask them, or a principal, to change it.` : "Your role can't change tasks."}</p></Card>
          ) : open ? (
            <Card title="Finish this task" pad className="lg:sticky lg:top-16">
              <form action={completeAction} className="space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <Field label="Outcome"><textarea name="outcome" rows={2} placeholder="e.g. Certificate issued and emailed to holder" className={cls.input} /></Field>
                <Field label="Follow up">
                  <select name="follow_up_days" className={cls.input}><option value="">No follow-up</option><option value="1">Tomorrow</option><option value="3">In 3 days</option><option value="7">In a week</option><option value="14">In 2 weeks</option><option value="30">In 30 days</option></select>
                </Field>
                <div className="flex gap-2 pt-1">
                  <Submit className={`${cls.btnGreen} flex-1`} formAction={completeAndNextAction}>Done &amp; next →</Submit>
                  <Submit className={cls.btn}>Done</Submit>
                </div>
              </form>
              <div className="my-4 border-t border-slate-100" />
              <form action={waitingAction} className="space-y-2">
                <input type="hidden" name="id" value={t.id} />
                <div className="text-xs font-medium text-slate-600">Waiting on someone</div>
                <div className="flex gap-2">
                  <select name="waiting_on" defaultValue={t.waiting_on ?? "client"} className={cls.input}><option value="client">Client</option><option value="carrier">Carrier</option><option value="internal">Colleague</option><option value="other">Other</option></select>
                  <input type="date" name="follow_up_date" aria-label="Follow-up date (blank uses the default for who you are waiting on)" title="Blank uses the default for who you are waiting on" className={cls.input} />
                </div>
                <input name="comment" placeholder="What are you waiting for?" className={cls.input} />
                <div className="flex gap-2"><Submit className={`${cls.btnSm} flex-1`} formAction={waitingAndNextAction}>Wait &amp; next →</Submit><Submit className={cls.btnSm}>Wait</Submit></div>
              </form>
              {t.status === "waiting" && <form action={resumeAction} className="mt-2"><input type="hidden" name="id" value={t.id} /><Submit className={`${cls.btnSm} w-full`}>It arrived — back to my queue</Submit></form>}
              <div className="my-4 border-t border-slate-100" />
              <div className="text-xs font-medium text-slate-600">Snooze</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[["1", "Tomorrow"], ["3", "3 days"], ["7", "1 week"]].map(([d, l]) => (
                  <form key={d} action={snoozeAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="days" value={d} /><input type="hidden" name="next" value="1" /><button className={cls.btnSm}>{l}</button></form>
                ))}
              </div>
              <details className="mt-4 border-t border-slate-100 pt-3">
                <summary className="text-xs font-medium text-indigo-600">Reassign, reprioritize, cancel</summary>
                <form action={reassignAction} className="mt-2 flex gap-2"><input type="hidden" name="id" value={t.id} />
                  <select name="owner_id" defaultValue={t.owner_id ?? ""} className={cls.input}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
                  <Submit className={cls.btnSm}>Reassign</Submit></form>
                <form action={updateAction} className="mt-2 flex gap-2"><input type="hidden" name="id" value={t.id} />
                  <select name="priority" defaultValue={t.priority} className={cls.input}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select>
                  <input type="date" name="due_date" defaultValue={t.due_date} className={cls.input} />
                  <Submit className={cls.btnSm}>Save</Submit></form>
                <form action={cancelAction} className="mt-2 flex gap-2"><input type="hidden" name="id" value={t.id} />
                  <input name="reason" placeholder="Why it isn't needed" className={cls.input} />
                  <Submit className={cls.btnDanger} confirm="Cancel this task?">Cancel task</Submit></form>
              </details>
            </Card>
          ) : null}

          {client ? (
            <Card title="Client" action={<Link href={`/clients/${client.id}`} className={cls.link}>Open account</Link>} pad>
              <Link href={`/clients/${client.id}`} className="text-base font-semibold text-slate-900 hover:text-indigo-700">{client.name}</Link>
              <div className="mb-3 text-xs text-slate-500">{client.code} · <Status s={client.status} /></div>
              <KV cols={1} items={[
                ["Phone", <span key="p">{client.phone ?? "—"}{client.do_not_call && <Pill tone="red">do not call</Pill>}</span>],
                ["Email", client.email ? <a className={cls.link} href={`mailto:${client.email}`}>{client.email}</a> : "—"],
                ["Prefers", client.preferred_channel],
                ["Account manager / producer", `${client.am ?? "—"} / ${client.producer ?? "—"}`],
              ]} />
              <div className="mt-3 flex flex-wrap gap-2"><NotInMvp id="WRK-23" label="Call" /><NotInMvp id="WRK-22" label="Text" /></div>
              <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">In-force policies</div>
              {policies.length === 0 ? <p className="mt-1 text-sm text-slate-500">None</p> : (
                <ul className="mt-1 space-y-1">
                  {policies.map((p) => {
                    const left = daysBetween(today, p.expiration_date);
                    return <li key={p.id} className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm ${p.id === t.policy_id ? "bg-indigo-50" : ""}`}>
                      <Link href={`/policies/${p.id}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs">{p.policy_number}</span> <span className="text-slate-500">{lobLabel(p.lob)}</span></Link>
                      <span className={`whitespace-nowrap text-xs tabular-nums ${left <= 30 ? "text-amber-700" : "text-slate-500"}`}>{money(p.premium)} · {daysLeft(left)}</span>
                    </li>;
                  })}
                </ul>
              )}
              {history.length > 0 && <>
                <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent work</div>
                <ul className="mt-1 space-y-1.5">{history.map((h) => <li key={h.id} className="text-xs"><Link href={`/tasks/${h.id}`} className="text-slate-700 hover:underline">{h.subject}</Link><div className="text-slate-500">{h.owner} · {whenShort(h.completed_at ?? h.created_at)} · {h.status}</div></li>)}</ul>
              </>}
            </Card>
          ) : open && (
            <Card title="Link to a client" pad>
              <p className="mb-2 text-xs text-slate-500">This task isn&apos;t linked to a client yet.</p>
              <form action={updateAction} className="space-y-2"><input type="hidden" name="id" value={t.id} />
                <ClientPicker name="client_id" required />
                <Submit className={`${cls.btnPrimary} w-full`}>Link client</Submit>
              </form>
            </Card>
          )}
          {client && open && policies.length > 0 && (
            <Card title="Linked policy" pad>
              <form action={updateAction} className="flex gap-2"><input type="hidden" name="id" value={t.id} />
                <select name="policy_id" defaultValue={t.policy_id ?? ""} className={cls.input}><option value="">No policy</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number} · {lobLabel(p.lob)}</option>)}</select>
                <Submit className={cls.btnSm}>Save</Submit>
              </form>
            </Card>
          )}
          {!can(user, "write") && <p className="text-xs text-slate-500">Your role has read-only access to client records.</p>}
        </div>
      </div>
    </div>
  );
}
