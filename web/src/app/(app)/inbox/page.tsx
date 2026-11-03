import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import Link from "next/link";
import { reviewedAction } from "./actions";
import { NotInMvp } from "@/components/not-mvp";
import { Card, Empty, Flash, PageHeader, Pill, Status, Tabs, cls } from "@/components/ui";
import { q } from "@/lib/db";
import { whenShort } from "@/lib/format";
import { can, currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Email inbox" };

type Row = { id: number; subject: string; from_addr: string; from_name: string | null; original_from_addr: string | null; original_from_name: string | null; received_at: Date; status: string;
  client_id: number | null; client_name: string | null; match_method: string | null; match_confidence: string | null; activity_id: number | null; code_label: string | null; activity_status: string | null;
  routed: string | null; classified_by: string | null; has_att: boolean; direction: string };

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const tab = sp.tab ?? "triage";
  const scope = sp.scope ?? (can(user, "team") ? "all" : "mine");
  const where: string[] = []; const params: unknown[] = [];
  if (tab === "triage") where.push("e.status = 'new'");
  if (tab === "ignored") where.push("e.status = 'ignored'");
  if (tab === "sent") where.push("e.direction = 'outbound'"); else where.push("e.direction = 'inbound'");
  if (scope === "mine") { params.push(user.id); where.push(`(e.routed_user_id = $${params.length} OR e.forwarded_by_user_id = $${params.length})`); }
  if (sp.q) { params.push(sp.q); where.push(`(e.subject ILIKE '%' || $${params.length} || '%' OR e.from_addr ILIKE '%' || $${params.length} || '%' OR e.original_from_addr ILIKE '%' || $${params.length} || '%')`); }
  const whereSql = where.join(" AND ");
  const count = await q<{ n: number }>(`SELECT count(*)::int AS n FROM emails e WHERE ${whereSql}`, params);
  const at = paging(sp.page, count[0].n);
  const rows = await q<Row>(`
    SELECT e.id, e.subject, e.from_addr, e.from_name, e.original_from_addr, e.original_from_name, e.received_at, e.status, e.client_id, c.name AS client_name, e.match_method, e.match_confidence,
           e.activity_id, ac.label AS code_label, a.status AS activity_status, u.full_name AS routed, e.classified_by, e.direction,
           EXISTS (SELECT 1 FROM documents d WHERE d.email_id = e.id) AS has_att
      FROM emails e LEFT JOIN clients c ON c.id = e.client_id LEFT JOIN activities a ON a.id = e.activity_id LEFT JOIN activity_codes ac ON ac.code = a.code LEFT JOIN users u ON u.id = e.routed_user_id
     WHERE ${whereSql} ORDER BY e.received_at DESC, e.id DESC LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const counts = (await q<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM emails WHERE direction = 'inbound' ${scope === "mine" ? "AND (routed_user_id = $1 OR forwarded_by_user_id = $1)" : ""} GROUP BY status`, scope === "mine" ? [user.id] : []));
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "amsinbox.siryous.app";
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Email inbox"
        subtitle={<>Forward or copy client email to <span className="font-mono text-slate-700">{user.inbox_alias}@{domain}</span> (your queue) or <span className="font-mono text-slate-700">service@{domain}</span> (the client&apos;s account manager). Each email becomes a task.</>}
        actions={<><NotInMvp id="WRK-20S" label="Connect mailbox" /><Link href={qs(sp, { page: undefined, scope: scope === "mine" ? "all" : "mine" })} className={cls.btn}>{scope === "mine" ? "Show everyone's" : "Show only mine"}</Link>{can(user, "admin") && <Link href="/inbox/simulate" className={cls.btnPrimary}>Test email intake</Link>}</>} />
      <Tabs current={tab} tabs={[
        { key: "triage", label: "Needs triage", href: qs(sp, { page: undefined, tab: "triage" }), count: n("new") },
        { key: "all", label: "All received", href: qs(sp, { page: undefined, tab: "all" }), count: n("new") + n("actioned") + n("linked") },
        { key: "ignored", label: "Ignored", href: qs(sp, { page: undefined, tab: "ignored" }), count: n("ignored") },
        { key: "sent", label: "Replies", href: qs(sp, { page: undefined, tab: "sent" }) },
      ]} />
      {tab === "triage" && <p className="mb-3 text-sm text-slate-500">These emails already have a task. They are here because the client match was weak or the request was unclear: confirm the client and type, and they leave this list.</p>}
      <Card>
        {rows.length === 0 ? <Empty>{tab === "triage" ? "Nothing needs triage. Every email was matched and turned into work." : "No emails."}</Empty> : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => {
              const who = r.original_from_name ?? r.from_name ?? r.original_from_addr ?? r.from_addr;
              const conf = Number(r.match_confidence ?? 0);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/70">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/inbox/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">{r.subject || "(no subject)"}</Link>
                      {r.has_att && <span title="Has attachments">📎</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">{who}</span>{r.original_from_addr && <span>· forwarded by {r.from_name}</span>}
                      <span>· {whenShort(r.received_at)}</span>{r.routed && <span>· → {r.routed}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {r.client_name ? <Pill tone={conf >= 0.75 ? "green" : "amber"} title={r.match_method ?? ""}>{r.client_name}{conf < 0.75 ? " ?" : ""}</Pill> : r.direction === "inbound" && <Pill tone="red">No client match</Pill>}
                      {r.code_label && <Link href={`/tasks/${r.activity_id}`}><Pill tone="indigo">{r.code_label}{r.activity_status && r.activity_status !== "open" ? ` · ${r.activity_status}` : ""}</Pill></Link>}
                      {r.classified_by && <Pill tone="slate">{r.classified_by === "ai" ? "Claude" : "rules"}</Pill>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2"><Status s={r.status} />
                    {r.status === "new" && (r.client_id ? <form action={reviewedAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="list" /><button className={cls.btnSm}>Looks right</button></form> : <Link href={`/inbox/${r.id}`} className={cls.btnSm}>Pick client →</Link>)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Email pages" />
      </Card>
    </div>
  );
}
