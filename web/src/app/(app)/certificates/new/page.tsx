import { IssueForm } from "./issue-form";
import { ClientPicker } from "@/components/client-picker";
import { Card, Field, Flash, PageHeader, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { emailEnabled } from "@/lib/email/send";
import { whenDate } from "@/lib/format";
import { lobLabel } from "@/lib/ref";

export const metadata = { title: "Issue certificate" };

export default async function NewCert({ searchParams }: { searchParams: Promise<{ client?: string; policy?: string; task?: string; holder?: string; error?: string }> }) {
  const sp = await searchParams;
  const clientId = Number(sp.client) || null;
  if (!clientId) return (
    <div className="max-w-3xl"><PageHeader crumbs={[{ href: "/certificates", label: "Certificates" }]} title="Issue certificate" />
      <Card pad><form className="flex items-end gap-2"><Field label="Insured" className="flex-1"><ClientPicker name="client" required scope="business" /></Field><button className={cls.btnPrimary}>Continue</button></form></Card></div>
  );
  const [client, policies, holders, task, current] = await Promise.all([
    one<{ name: string }>("SELECT name FROM clients WHERE id = $1", [clientId]),
    q<{ id: number; policy_number: string; lob: string; carrier: string; expiration_date: string; status: string }>(
      "SELECT p.id, p.policy_number, p.lob, ca.name AS carrier, p.expiration_date, p.status FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.client_id = $1 AND p.status IN ('active','bound','pending_cancel') ORDER BY p.lob", [clientId]),
    q<{ id: number; name: string; email: string | null; last_desc: string | null; used: boolean }>(
      `SELECT oi.id, oi.name, oi.email, (SELECT ce.description_of_operations FROM certificates ce WHERE ce.holder_id = oi.id AND ce.client_id = $1 ORDER BY ce.id DESC LIMIT 1) AS last_desc,
              EXISTS (SELECT 1 FROM certificates ce WHERE ce.holder_id = oi.id AND ce.client_id = $1) AS used
         FROM other_interests oi WHERE oi.kind = 'certificate_holder' ORDER BY used DESC, oi.name`, [clientId]),
    sp.task ? one<{ subject: string; description: string | null }>("SELECT subject, description FROM activities WHERE id = $1", [Number(sp.task)]) : null,
    q<{ holder_id: number; cert_number: string }>("SELECT holder_id, cert_number FROM certificates WHERE client_id = $1 AND status = 'issued' AND holder_id IS NOT NULL ORDER BY id", [clientId]),
  ]);
  const liability = ["GL", "CA", "WC", "CUMB", "BOP", "PROP", "IM", "PL"];
  // The holder named in the request (e.g. a forwarded COI email) is picked for you.
  const requestText = (task?.description ?? "").toLowerCase();
  const holder = holders.find((h) => h.id === Number(sp.holder))
    ?? holders.filter((h) => requestText.includes(h.name.toLowerCase().replace(/\s+(llc|inc\.?)$/i, ""))).sort((a, b) => b.name.length - a.name.length)[0];
  const wantsAI = /additional insured/i.test(task?.description ?? ""), wantsWOS = /waiver/i.test(task?.description ?? ""), wantsPNC = /primary/i.test(task?.description ?? "");
  return (
    <div className="max-w-4xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/certificates", label: "Certificates" }, { href: `/clients/${clientId}`, label: client?.name ?? "Client" }]} title={`Issue certificate · ${client?.name}`} subtitle={task ? `For task: ${task.subject}` : undefined} />
      {task?.description && <div className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200"><b>Request:</b> {task.description.split("\n")[0]}</div>}
      <IssueForm clientId={clientId} taskId={sp.task ?? ""} emailOn={emailEnabled()} holders={holders.map((h) => ({ id: h.id, label: `${h.used ? "★ " : ""}${h.name}` }))} selected={holder?.id ?? null}
        replaces={Object.fromEntries(current.map((c) => [c.holder_id, c.cert_number]))} email={holder?.email ?? ""} description={holder?.last_desc ?? "All operations of the named insured."}
        policies={policies.map((p) => ({ id: p.id, number: p.policy_number, label: `${lobLabel(p.lob)} · ${p.carrier} · expires ${whenDate(p.expiration_date)}${p.status !== "active" ? ` · ${p.status}` : ""}`, ticked: sp.policy && Number(sp.policy) === p.id || (liability.includes(p.lob) && p.lob !== "PROP") }))}
        flags={{ ai: wantsAI || !task, wos: wantsWOS, pnc: wantsPNC }} />
    </div>
  );
}
