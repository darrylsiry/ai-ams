import Link from "next/link";
import { notFound } from "next/navigation";
import { addSubmissionAction, stageAction, updateSubmissionAction } from "../actions";
import { CheckList } from "@/components/check-list";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { TaskLine } from "@/components/tasks";
import { Card, Empty, Field, Flash, KV, PageHeader, Status, Table, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money, whenShort } from "@/lib/format";
import { lobLabel, OPP_STAGE_LABEL, OPP_STAGES, SUBMISSION_STATUS_LABEL } from "@/lib/ref";
import { listTasks } from "@/lib/work";

export const metadata = { title: "Opportunity" };

export default async function Opp({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const o = await one<{ id: number; name: string; stage: string; kind: string; lines: string[]; est_premium: string | null; target_date: string | null; source: string | null; notes: string | null; lost_reason: string | null;
    client_id: number; client_name: string; owner: string | null; won_policy_id: number | null; created_at: Date }>(
    "SELECT o.*, c.name AS client_name, u.full_name AS owner FROM opportunities o JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.owner_id WHERE o.id = $1", [Number(id)]);
  if (!o) notFound();
  const [subs, carriers, allTasks] = await Promise.all([
    q<{ id: number; carrier_id: number; carrier: string; status: string; submitted_at: Date | null; responded_at: Date | null; quoted_premium: string | null; declination_reason: string | null; notes: string | null; commission_pct: string | null; uw: string | null }>(
      "SELECT s.*, ca.name AS carrier, ca.underwriting_email AS uw FROM submissions s JOIN carriers ca ON ca.id = s.carrier_id WHERE s.opportunity_id = $1 ORDER BY s.quoted_premium NULLS LAST, s.id", [o.id]),
    q<{ id: number; name: string; lines: string[] }>("SELECT id, name, lines FROM carriers WHERE kind <> 'wholesaler' AND active ORDER BY name"),
    listTasks({ opportunityId: o.id, limit: 50 }),
  ]);
  const open = !["won", "lost"].includes(o.stage);
  const fit = carriers.filter((c) => !o.lines.length || o.lines.some((l) => c.lines.includes(l)));
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/sales", label: "Sales pipeline" }]} title={o.name} subtitle={<span className="flex items-center gap-2"><Status s={o.stage} /> {o.client_name} · owner {o.owner} · opened {whenShort(o.created_at)}</span>}
        actions={<><Link href={`/clients/${o.client_id}`} className={cls.btn}>Open client</Link>{o.won_policy_id && <Link href={`/policies/${o.won_policy_id}`} className={cls.btnPrimary}>Bound policy</Link>}</>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={`Markets · ${subs.length}`}>
            {subs.length === 0 ? <Empty>No submissions yet. Add markets on the right.</Empty> : (
              <Table head={["Carrier", "Status", { label: "Quoted", num: true }, { label: "Commission", num: true }, "Submitted", ""]}>
                {subs.map((s) => <tr key={s.id} className={s.status === "quoted" ? "bg-sky-50/40" : ""}>
                  <td className={cls.td}><div className="font-medium">{s.carrier}</div>{s.uw && <a href={`mailto:${s.uw}?subject=${encodeURIComponent(`Submission: ${o.client_name}`)}`} className="text-xs text-indigo-600">email underwriting</a>}{s.declination_reason && <div className="text-xs text-rose-600">{s.declination_reason}</div>}</td>
                  <td className={cls.td}><Status s={s.status} /></td>
                  <td className={cls.num}>{s.quoted_premium ? money(s.quoted_premium) : "—"}</td>
                  <td className={cls.num}>{s.commission_pct ? `${Number(s.commission_pct)}%` : "—"}</td>
                  <td className={`${cls.td} text-xs`}>{s.submitted_at ? whenShort(s.submitted_at) : "—"}</td>
                  <td className={`${cls.td} text-right`}>
                    {s.status === "quoted" && open && <Link href={`/policies/new?client=${o.client_id}&opportunity=${o.id}&carrier=${s.carrier_id}&premium=${s.quoted_premium ?? ""}`} className={cls.btnGreen}>Bind →</Link>}
                    {open && <details className="mt-1 text-left"><summary className="text-xs text-indigo-600">Update</summary>
                      <form action={updateSubmissionAction} className="mt-2 w-64 space-y-2"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="sub_id" value={s.id} />
                        <select name="status" defaultValue={s.status} className={cls.input}>{Object.entries(SUBMISSION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        <input name="quoted_premium" placeholder="Quoted premium" defaultValue={s.quoted_premium ?? ""} className={cls.input} />
                        <input name="declination_reason" placeholder="Declination reason" className={cls.input} />
                        <input name="notes" placeholder="Notes" className={cls.input} />
                        <Submit className={cls.btnSm}>Save</Submit></form></details>}
                  </td>
                </tr>)}
              </Table>
            )}
          </Card>
          <Card title="Work">{allTasks.length === 0 ? <Empty>No tasks linked.</Empty> : <ul className="divide-y divide-slate-100">{allTasks.map((t) => <TaskLine key={t.id} t={t} showOwner showReasons={false} actions={t.status === "open"} />)}</ul>}</Card>
        </div>
        <div className="space-y-5">
          <Card title="Details" pad><KV cols={1} items={[["Client", <Link key="c" href={`/clients/${o.client_id}`} className={cls.link}>{o.client_name}</Link>], ["Lines", o.lines.map(lobLabel).join(", ") || "—"], ["Estimated premium", o.est_premium ? money(o.est_premium) : "—"], ["Target date", o.target_date], ["Source", o.source], ["Notes", o.notes], ...(o.lost_reason ? [["Lost reason", o.lost_reason] as [string, string]] : [])]} /></Card>
          {open && <Card title="Add markets" pad>
            <form action={addSubmissionAction} className="space-y-2"><input type="hidden" name="id" value={o.id} />
              <CheckList name="carrier_ids" legend="Markets to add" options={fit.map((c) => ({ value: String(c.id), label: c.name }))} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="submitted" defaultChecked /> Already sent</label>
              <Submit className={`${cls.btn} w-full`}>Add selected</Submit>
            </form>
            <div className="mt-3 flex flex-wrap gap-2"><NotInMvp id="PLC-19" label="Submit via API" /><NotInMvp id="PLC-08" label="Send client an application" /></div>
          </Card>}
          {open && <Card title="Stage" pad>
            <form action={stageAction} className="space-y-2"><input type="hidden" name="id" value={o.id} />
              <select name="stage" defaultValue={o.stage} className={cls.input}>{OPP_STAGES.filter((s) => s !== "won").map((s) => <option key={s} value={s}>{OPP_STAGE_LABEL[s]}</option>)}</select>
              <input name="lost_reason" placeholder="If lost: why" className={cls.input} />
              <Submit className={`${cls.btn} w-full`}>Update</Submit>
            </form>
          </Card>}
        </div>
      </div>
    </div>
  );
}
