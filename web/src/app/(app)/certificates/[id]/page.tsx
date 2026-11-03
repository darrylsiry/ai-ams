import Link from "next/link";
import { notFound } from "next/navigation";
import { redeliverAction, renewAllAction, revokeAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, KV, PageHeader, Pill, Status, Table, cls } from "@/components/ui";
import { policiesNotInForce, replacementOf, verifyWording } from "@/lib/certificates";
import { one, q } from "@/lib/db";
import { emailEnabled } from "@/lib/email/send";
import { when, whenDate, whenShort } from "@/lib/format";
import { lobLabel } from "@/lib/ref";

export const metadata = { title: "Certificate" };

export default async function Cert({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ce = await one<{ id: number; cert_number: string; client_id: number; client_name: string; holder_id: number | null; holder: string | null; holder_email: string | null; status: string; description_of_operations: string | null;
    additional_insured: boolean; waiver_of_subrogation: boolean; primary_noncontributory: boolean; issued_at: Date | null; by: string | null; delivered_to: string | null; delivered_at: Date | null; renewed_from_id: number | null }>(
    `SELECT ce.*, c.name AS client_name, oi.name AS holder, oi.email AS holder_email, u.full_name AS by FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id LEFT JOIN users u ON u.id = ce.issued_by_id WHERE ce.id = $1`, [Number(id)]);
  if (!ce) notFound();
  const pols = await q<{ id: number; policy_number: string; lob: string; carrier: string; effective_date: string; expiration_date: string; status: string; renewal_policy_id: number | null }>(
    "SELECT p.id, p.policy_number, p.lob, ca.name AS carrier, p.effective_date, p.expiration_date, p.status, p.renewal_policy_id FROM certificate_policies cp JOIN policies p ON p.id = cp.policy_id JOIN carriers ca ON ca.id = p.carrier_id WHERE cp.certificate_id = $1", [ce.id]);
  const warnings = await verifyWording(pols.map((p) => p.id), ce);
  const lapsed = ce.status === "issued" ? await policiesNotInForce(ce.id) : [];
  const history = await q<{ id: number; action: string; actor: string; summary: string; occurred_at: Date }>("SELECT id, action, actor, summary, occurred_at FROM audit_events WHERE entity_type = 'certificate' AND entity_id = $1 ORDER BY id DESC", [String(ce.id)]);
  const renewable = pols.some((p) => p.renewal_policy_id);
  const live = ce.status === "issued";
  const { next, current } = live ? { next: null, current: null } : await replacementOf(ce);
  const pdf = `/documents/render?kind=certificate&certificate=${ce.id}`;
  const emailOff = !emailEnabled();
  // Only an email a mail server accepted may read as delivered (UX-002).
  const lastSend = history.find((h) => h.action === "certificate.marked_sent" || h.action === "certificate.delivered");
  const byHand = lastSend?.action === "certificate.marked_sent";
  const unsent = emailOff && !ce.delivered_at;
  const delivery: [string, React.ReactNode][] = unsent ? [["Delivery", <span key="d" className="whitespace-normal">Not sent — outbound email isn&apos;t connected</span>], ["Holder email", ce.delivered_to ?? ce.holder_email]]
    : emailOff || byHand ? [["Sent to", ce.delivered_to], ["Sent", ce.delivered_at ? `${when(ce.delivered_at)}${byHand ? ` · marked by ${lastSend!.actor}` : ""}` : "—"]]
    : [["Delivered to", ce.delivered_to], ["Delivered", ce.delivered_at ? when(ce.delivered_at) : "—"]];
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/certificates", label: "Certificates" }, { href: `/clients/${ce.client_id}`, label: ce.client_name }]} title={<span className="flex items-center gap-3"><span className="font-mono">{ce.cert_number}</span><Status s={ce.status} /></span>}
        subtitle={`${ce.client_name} → ${ce.holder ?? "no holder"}`}
        actions={<>{current && <Link href={`/certificates/${current.id}`} className={cls.btnPrimary}>Open current certificate →</Link>}
          <a href={pdf} className={live ? cls.btnPrimary : cls.btn}>{live ? (unsent && !lapsed.length ? "Open PDF to attach" : "Open PDF") : `Open PDF (marked ${ce.status.toUpperCase()})`}</a>{live && <Link href={`/certificates/new?client=${ce.client_id}&holder=${ce.holder_id ?? ""}`} className={cls.btn}>Reissue with changes</Link>}</>} />
      {ce.status === "superseded" && <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 ring-1 ring-rose-300">{next ? <>Replaced by <Link href={`/certificates/${next.id}`} className="font-mono underline">{next.cert_number}</Link>{next.issued_at ? ` on ${whenDate(next.issued_at)}` : ""}. </> : "Superseded. "}Don&apos;t send this one.</div>}
      {ce.status === "revoked" && <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 ring-1 ring-rose-300">Revoked. Don&apos;t send this one.{current && <> The current certificate for this holder is <Link href={`/certificates/${current.id}`} className="font-mono underline">{current.cert_number}</Link>.</>}</div>}
      {lapsed.length > 0 && <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 ring-1 ring-rose-300">Coverage no longer in force: {lapsed.join(", ")}. Don&apos;t send this certificate. Reissue it on current coverage or revoke it, and tell the holder.</div>}
      {renewable && ce.status === "issued" && <div className="mb-4 flex items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">A policy on this certificate has renewed. <form action={renewAllAction} className="ml-auto"><input type="hidden" name="client_id" value={ce.client_id} /><Submit className={cls.btnSm}>Reissue all certificates for {ce.client_name}</Submit></form></div>}
      {warnings.length > 0 && <div className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200"><b>Wording not backed by an endorsement on file:</b><ul className="ml-4 list-disc">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Coverage shown"><Table head={["Policy", "Line", "Carrier", "Term", "Status"]}>{pols.map((p) => <tr key={p.id}><td className={cls.td}><Link href={`/policies/${p.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{p.policy_number}</Link></td><td className={cls.td}>{lobLabel(p.lob)}</td><td className={`${cls.td} text-xs`}>{p.carrier}</td><td className={`${cls.td} text-xs`}>{p.effective_date} → {p.expiration_date}</td><td className={cls.td}><Status s={p.status} /></td></tr>)}</Table></Card>
          <Card title="Wording" pad><div className="mb-2 flex gap-1">{ce.additional_insured && <Pill tone="indigo">Additional insured</Pill>}{ce.waiver_of_subrogation && <Pill tone="indigo">Waiver of subrogation</Pill>}{ce.primary_noncontributory && <Pill tone="indigo">Primary &amp; non-contributory</Pill>}</div><p className="whitespace-pre-wrap text-sm text-slate-700">{ce.description_of_operations}</p></Card>
          <Card title="History"><ul className="divide-y divide-slate-100">{history.map((h) => <li key={h.id} className="px-4 py-2 text-sm"><span className="text-xs text-slate-500">{h.actor} · {whenShort(h.occurred_at)}</span><p>{h.summary}</p></li>)}</ul></Card>
        </div>
        <div className="space-y-5">
          <Card title="Issued" pad><KV cols={1} items={[["Issued", ce.issued_at ? when(ce.issued_at) : "—"], ["By", ce.by], ...delivery, ...(ce.renewed_from_id ? [["Renews", <Link key="r" href={`/certificates/${ce.renewed_from_id}`} className={cls.link}>previous certificate</Link>] as [string, React.ReactNode]] : [])]} /></Card>
          {live && <>
            {lapsed.length === 0 && <Card title={emailOff ? "Sent it yourself?" : "Send again"} pad><form action={redeliverAction} className="space-y-2"><input type="hidden" name="id" value={ce.id} />
              {emailOff && <p className="text-xs text-slate-500">Outbound email isn&apos;t connected. Attach the PDF in Outlook, then record it here.</p>}
              <Field label={emailOff ? "Sent to" : "Email"}><input name="delivered_to" type="email" required defaultValue={ce.delivered_to ?? ce.holder_email ?? ""} className={cls.input} /></Field><Submit className={cls.btn}>{!emailOff ? "Send" : ce.delivered_at ? "Log as sent" : "Mark as sent"}</Submit></form></Card>}
            <Card title="Revoke" pad><form action={revokeAction} className="space-y-2"><input type="hidden" name="id" value={ce.id} /><input name="reason" placeholder="Why" className={cls.input} /><Submit className={cls.btnDanger} confirm="Revoke this certificate?">Revoke</Submit></form></Card>
          </>}
        </div>
      </div>
    </div>
  );
}
