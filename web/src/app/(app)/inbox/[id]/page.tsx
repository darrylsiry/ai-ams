import Link from "next/link";
import { notFound } from "next/navigation";
import { ignoreAction, linkClientAction, replyAction, retypeAction, reviewedAction } from "../actions";
import { ClientPicker } from "@/components/client-picker";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, KV, PageHeader, Pill, Status, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { when } from "@/lib/format";
import { lobLabel } from "@/lib/ref";
import { emailEnabled } from "@/lib/email/send";
import { activityCodes } from "@/lib/work";

export const metadata = { title: "Email" };

type Email = { sender_verified: boolean | null; id: number; message_id: string; from_addr: string; from_name: string | null; original_from_addr: string | null; original_from_name: string | null; to_addrs: string[]; cc_addrs: string[];
  subject: string; body_text: string; received_at: Date; status: string; client_id: number | null; policy_id: number | null; match_method: string | null; match_confidence: string | null;
  classification: { activity_code?: string; summary?: string; priority?: string; confidence?: number; requested_change?: string | null } | null; classified_by: string | null; activity_id: number | null;
  routed: string | null; source: string; client_name: string | null; direction: string };

export default async function EmailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const e = await one<Email>(`SELECT e.*, u.full_name AS routed, c.name AS client_name FROM emails e LEFT JOIN users u ON u.id = e.routed_user_id LEFT JOIN clients c ON c.id = e.client_id WHERE e.id = $1`, [Number(id)]);
  if (!e) notFound();
  const [codes, policies, docs, task] = await Promise.all([
    activityCodes(),
    e.client_id ? q<{ id: number; policy_number: string; lob: string }>("SELECT id, policy_number, lob FROM policies WHERE client_id = $1 AND status IN ('active','bound','pending_cancel') ORDER BY expiration_date", [e.client_id]) : Promise.resolve([]),
    q<{ id: number; title: string; client_id: number | null }>("SELECT id, title, client_id FROM documents WHERE email_id = $1", [e.id]),
    e.activity_id ? one<{ id: number; subject: string; status: string; code: string; owner: string | null }>("SELECT a.id, a.subject, a.status, a.code, u.full_name AS owner FROM activities a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = $1", [e.activity_id]) : null,
  ]);
  const c = e.classification ?? {};
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/inbox", label: "Email inbox" }]} title={e.subject || "(no subject)"} subtitle={<span className="flex items-center gap-2"><Status s={e.status} /> received {when(e.received_at)} · via {e.source}</span>}
        actions={e.status === "new" && (e.client_id ? <form action={reviewedAction}><input type="hidden" name="id" value={e.id} /><Submit className={cls.btnGreen}>Looks right</Submit></form> : <Link href="#pick-client" className={cls.btn}>Pick client →</Link>)} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="space-y-0.5 border-b border-slate-100 px-4 py-3 text-sm">
              <div><span className="text-slate-500">From </span><span className="font-medium">{e.original_from_name ?? e.from_name}</span> &lt;{e.original_from_addr ?? e.from_addr}&gt;</div>
              {e.original_from_addr && <div className="text-slate-500">Forwarded by {e.from_name} &lt;{e.from_addr}&gt;</div>}
              {e.sender_verified === false && e.direction === "inbound" && <div className="text-amber-700">The mail provider didn&apos;t confirm this sender&apos;s address. Treat the From line as a claim.</div>}
              <div className="text-slate-500">To {e.to_addrs.join(", ")}{e.cc_addrs.length ? ` · Cc ${e.cc_addrs.join(", ")}` : ""}</div>
            </div>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm text-slate-800">{e.body_text}</pre>
            {docs.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">{docs.map((d) => <a key={d.id} href={`/documents/${d.id}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs hover:bg-white">📎 {d.title}</a>)}</div>}
          </Card>
          {e.direction === "inbound" && (
            <Card title="Reply" pad>
              <form action={replyAction} className="space-y-2"><input type="hidden" name="id" value={e.id} />
                <textarea name="body" rows={4} placeholder={`Reply to ${e.original_from_addr ?? e.from_addr}…`} className={cls.input} />
                <div className="flex items-center gap-2"><Submit className={cls.btnPrimary}>Send reply</Submit>{!emailEnabled() && <NotInMvp id="WRK-25O" variant="inline" label="Sending needs SMTP" />}</div>
              </form>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title="What the intake decided" pad>
            <KV cols={1} items={[
              ["Routed to", e.routed ?? "—"],
              ["Client", e.client_name ? <Link key="c" href={`/clients/${e.client_id}`} className={cls.link}>{e.client_name}</Link> : <Pill tone="red">No match</Pill>],
              ["Matched by", e.match_method ? `${e.match_method} (${Math.round(Number(e.match_confidence) * 100)}%)` : "—"],
              ["Classified by", e.classified_by === "ai" ? "Claude" : e.classified_by === "rules" ? "keyword rules" : "—"],
              ["Summary", c.summary ?? "—"],
              ...(c.requested_change ? [["Requested change", c.requested_change] as [string, string]] : []),
              ["Task", task ? <Link key="t" href={`/tasks/${task.id}`} className={cls.link}>{task.subject}</Link> : "None"],
              ...(task ? [["Task status", <span key="s"><Status s={task.status} /> {task.owner}</span>] as [string, React.ReactNode]] : []),
            ]} />
          </Card>
          {e.direction === "inbound" && <>
            <div id="pick-client" className="scroll-mt-20"><Card title="Confirm or correct the client" pad>
              <form action={linkClientAction} className="space-y-2"><input type="hidden" name="id" value={e.id} />
                <ClientPicker name="client_id" required initial={e.client_id && e.client_name ? { id: e.client_id, name: e.client_name } : null} />
                {policies.length > 0 && <select name="policy_id" defaultValue={e.policy_id ?? ""} className={cls.input}><option value="">No specific policy</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number} · {lobLabel(p.lob)}</option>)}</select>}
                {policies.length > 0 && <p className="text-[11px] text-slate-500">These are the current client&apos;s policies. Changing the client clears the policy.</p>}
                {docs.some((d) => !d.client_id) && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Attachments are held off the client&apos;s file until you confirm the client here{e.client_id && e.status === "new" ? " or choose Looks right" : ""}.</p>}
                <Submit className={`${cls.btn} w-full`}>Save client</Submit>
              </form>
            </Card></div>
            {task && (
              <Card title="Change the task type" pad>
                <form action={retypeAction} className="space-y-2"><input type="hidden" name="id" value={e.id} />
                  <Field label="Type"><select name="code" defaultValue={task.code} className={cls.input}>{codes.map((cd) => <option key={cd.code} value={cd.code}>{cd.category} · {cd.label}</option>)}</select></Field>
                  <Field label="New subject (optional)"><input name="subject" placeholder={task.subject} className={cls.input} /></Field>
                  <Submit className={`${cls.btn} w-full`}>Update task</Submit>
                </form>
              </Card>
            )}
            {e.status !== "ignored" && <form action={ignoreAction}><input type="hidden" name="id" value={e.id} /><Submit className={`${cls.btnDanger} w-full`} confirm="Ignore this email? Its task is cancelled too, unless another email shares it.">Ignore — no action needed</Submit></form>}
          </>}
        </div>
      </div>
    </div>
  );
}
