import Link from "next/link";
import { notFound } from "next/navigation";
import { markClaimReportedAction, closeClaimAction, followUpAction, updateClaimAction } from "../actions";
import { uploadDocumentAction } from "../../documents/actions";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { TaskLine } from "@/components/tasks";
import { Card, Empty, Field, Flash, KV, PageHeader, Status, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { daysBetween, todayISO, when, whenShort } from "@/lib/format";
import { lobLabel } from "@/lib/ref";
import { listTasks } from "@/lib/work";

export const metadata = { title: "Claim" };

export default async function Claim({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const cl = await one<{ id: number; claim_number: string; client_id: number; client_name: string; policy_id: number | null; policy_number: string | null; lob: string | null; carrier: string | null; carrier_claim_number: string | null; loss_date: string; reported_date: string; kind: string;
    description: string; location: string | null; claimant: string | null; status: string; adjuster_name: string | null; adjuster_phone: string | null; adjuster_email: string | null; submitted_to_carrier_at: Date | null; closed_at: Date | null; created_by: string | null }>(
    `SELECT cl.*, c.name AS client_name, p.policy_number, p.lob, ca.name AS carrier, u.full_name AS created_by FROM claims cl JOIN clients c ON c.id = cl.client_id LEFT JOIN policies p ON p.id = cl.policy_id LEFT JOIN carriers ca ON ca.id = p.carrier_id LEFT JOIN users u ON u.id = cl.created_by_id WHERE cl.id = $1`, [Number(id)]);
  if (!cl) notFound();
  const tasks = (await listTasks({ clientId: cl.client_id, limit: 300 })).filter((t) => t.claim_id === cl.id);
  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "waiting").length;
  const docs = await q<{ id: number; title: string; created_at: Date }>("SELECT id, title, created_at FROM documents WHERE claim_id = $1 AND active ORDER BY created_at DESC", [cl.id]);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/claims", label: "Claims" }, { href: `/clients/${cl.client_id}`, label: cl.client_name }]} title={<span className="flex items-center gap-3"><span className="font-mono">{cl.claim_number}</span><Status s={cl.status} /></span>}
        subtitle={`${cl.kind} · loss ${cl.loss_date} · reported ${cl.reported_date} (${daysBetween(cl.reported_date, todayISO())} days ago)`}
        actions={<NotInMvp id="CLM-06" />} />
      {!cl.submitted_to_carrier_at && cl.status === "open" && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200"><span className="flex-1">Not reported to the carrier yet. Report within 24 hours and record the carrier&apos;s claim number below.</span><form action={markClaimReportedAction}><input type="hidden" name="id" value={cl.id} /><Submit className={cls.btnSm}>Mark reported</Submit></form></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Loss" pad><p className="whitespace-pre-wrap text-sm text-slate-700">{cl.description}</p>
            <div className="mt-3"><KV cols={3} items={[["Policy", cl.policy_id ? <Link key="p" href={`/policies/${cl.policy_id}`} className={cls.link}>{cl.policy_number}</Link> : "—"], ["Line", cl.lob ? lobLabel(cl.lob) : "—"], ["Carrier", cl.carrier], ["Location", cl.location], ["Claimant", cl.claimant], ["Recorded by", cl.created_by]]} /></div></Card>
          <Card title={`Follow-ups · ${tasks.length}`} action={cl.status === "open" && <form action={followUpAction} className="flex items-center gap-1"><input type="hidden" name="id" value={cl.id} /><select name="days" className="rounded border border-slate-300 px-1 py-0.5 text-xs"><option value="3">3 days</option><option value="5">5 days</option><option value="7">7 days</option><option value="14">14 days</option></select><Submit className={cls.btnSm}>Schedule follow-up</Submit></form>}>
            {tasks.length === 0 ? <Empty>No follow-ups.</Empty> : <ul className="divide-y divide-slate-100">{tasks.map((t) => <TaskLine key={t.id} t={t} showOwner showReasons={false} actions={t.status === "open"} />)}</ul>}
          </Card>
          <Card title={`Photos and documents · ${docs.length}`}>
            <ul className="divide-y divide-slate-100">{docs.map((d) => <li key={d.id} className="px-4 py-2 text-sm"><a href={`/documents/${d.id}`} className={cls.link}>{d.title}</a> <span className="text-xs text-slate-400">{whenShort(d.created_at)}</span></li>)}</ul>
            <form action={uploadDocumentAction} className="flex items-center gap-2 border-t border-slate-100 px-4 py-3"><input type="hidden" name="client_id" value={cl.client_id} /><input type="hidden" name="claim_id" value={cl.id} /><input type="hidden" name="policy_id" value={cl.policy_id ?? ""} /><input type="hidden" name="folder" value="Claims" /><input type="hidden" name="back" value={`/claims/${cl.id}`} />
              <input type="file" name="file" required className="text-sm" /><Submit className={cls.btnSm}>Upload</Submit></form>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Carrier and adjuster" pad>
            <form action={updateClaimAction} className="space-y-2"><input type="hidden" name="id" value={cl.id} />
              <Field label="Carrier claim number"><input name="carrier_claim_number" defaultValue={cl.carrier_claim_number ?? ""} className={cls.input} /></Field>
              <Field label="Adjuster"><input name="adjuster_name" defaultValue={cl.adjuster_name ?? ""} className={cls.input} /></Field>
              <Field label="Phone"><input name="adjuster_phone" defaultValue={cl.adjuster_phone ?? ""} className={cls.input} /></Field>
              <Field label="Email"><input name="adjuster_email" defaultValue={cl.adjuster_email ?? ""} className={cls.input} /></Field>
              <Field label="Claimant"><input name="claimant" defaultValue={cl.claimant ?? ""} className={cls.input} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reported" defaultChecked={!!cl.submitted_to_carrier_at} disabled={!!cl.submitted_to_carrier_at} /> Reported to carrier {cl.submitted_to_carrier_at && <span className="text-xs text-slate-500">{when(cl.submitted_to_carrier_at)}</span>}</label>
              <Submit className={cls.btn}>Save</Submit>
            </form>
          </Card>
          <Card title={cl.status === "open" ? "Close claim" : "Reopen claim"} pad>
            <form action={closeClaimAction} className="space-y-2"><input type="hidden" name="id" value={cl.id} />{cl.status === "closed" && <input type="hidden" name="reopen" value="1" />}
              <input name="note" placeholder={cl.status === "open" ? "Outcome (e.g. paid, denied, withdrawn)" : "Why reopen"} className={cls.input} />
              <Submit className={cl.status === "open" ? cls.btn : cls.btnPrimary} confirm={cl.status === "open" ? `Close ${cl.claim_number}${openTasks ? ` and its ${openTasks} open follow-up${openTasks === 1 ? "" : "s"}` : ""}?` : undefined}>{cl.status === "open" ? "Close claim" : "Reopen"}</Submit>
              {cl.closed_at && <p className="text-xs text-slate-500">Closed {when(cl.closed_at)}</p>}
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
