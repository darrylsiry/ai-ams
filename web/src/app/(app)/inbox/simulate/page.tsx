import Link from "next/link";
import { simulateAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, cls } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { one, q } from "@/lib/db";
import { NoAccess } from "@/components/ui";
import { activeUsers, authEnabled, can, currentUser } from "@/lib/user";

export const metadata = { title: "Test email intake" };

// Sends an email through exactly the pipeline the webhook uses, so intake can be tried without a
// mail provider. Samples are drawn from the live book so matching has something to find.

export default async function Simulate({ searchParams }: { searchParams: Promise<{ sample?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (authEnabled() && !can(user, "admin")) return <NoAccess what="test email intake" roles="administrator" />;
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "amsinbox.siryous.app";
  const users = await activeUsers();
  const pick = await one<{ name: string; email: string | null; first: string | null; last: string | null; policy_number: string | null; lob: string | null }>(
    `SELECT c.name, ct.email, ct.first_name AS first, ct.last_name AS last, p.policy_number, p.lob
       FROM clients c JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary
       LEFT JOIN LATERAL (SELECT policy_number, lob FROM policies WHERE client_id = c.id AND status = 'active' ORDER BY premium DESC LIMIT 1) p ON true
      WHERE c.kind = $1 AND c.status = 'insured' AND (c.account_manager_id = $2 OR $3) ORDER BY md5(c.id::text || current_date::text) LIMIT 1`,
    [sp.sample === "auto" || sp.sample === "claim" ? "individual" : "business", user.id, user.role !== "account_manager"]);
  const p = pick ?? { name: "Sample Client", email: "client@example.com", first: "Pat", last: "Lee", policy_number: null, lob: null };
  const samples: Record<string, { subject: string; body: string; forwarded?: boolean }> = {
    cert: { subject: "Need a COI today", body: `Hi,\n\nCan you send a certificate of insurance to Hendrick Brothers General Contractors for the Glenwood Ave tenant upfit? They need additional insured with waiver of subrogation and primary/non-contributory. We can't start on site until they have it — today if at all possible.\n\nThanks,\n${p.first} ${p.last}\n${p.name}` },
    auto: { subject: "Adding a car", body: `Hi,\n\nWe just bought a 2026 Toyota RAV4 and need it added to our auto policy ${p.policy_number ?? ""}. VIN is 2T3P1RFV8TW123456. Can you let me know the new premium?\n\nThanks,\n${p.first} ${p.last}` },
    claim: { subject: "Accident this morning", body: `Hi,\n\nI was rear-ended at a light this morning. Nobody hurt but the bumper and trunk are smashed. The other driver's insurance is GEICO. What do I do next?\n\n${p.first}` },
    cancel: { subject: `Cancel policy ${p.policy_number ?? ""}`, body: `Hello,\n\nWe sold the second location and need to cancel policy ${p.policy_number ?? ""} effective the end of the month.\n\nThank you,\n${p.first} ${p.last}` },
    unclear: { subject: "Question", body: "Hey, quick question when you get a sec. Thanks!" },
  };
  const s = samples[sp.sample ?? "cert"] ?? samples.cert;
  const fromAddr = sp.sample === "unclear" ? "someone.new@gmail.com" : p.email ?? "client@example.com";
  const recent = await q<{ id: number; subject: string; activity_id: number | null }>("SELECT id, subject, activity_id FROM emails WHERE source = 'simulator' ORDER BY id DESC LIMIT 5");
  return (
    <div className="max-w-4xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/inbox", label: "Email inbox" }]} title="Test email intake"
        subtitle={<>Runs the same pipeline as the inbound webhook: route → match client → classify ({aiEnabled() ? "Claude is on" : "keyword rules; set ANTHROPIC_API_KEY to classify with Claude"}) → task.</>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="text-slate-500">Samples from your book:</span>
        {Object.keys(samples).map((k) => <Link key={k} href={`/inbox/simulate?sample=${k}`} className={sp.sample === k || (!sp.sample && k === "cert") ? cls.btnPrimary : cls.btn}>{k}</Link>)}
      </div>
      <Card pad>
        <form action={simulateAction} className="grid gap-4 sm:grid-cols-2" key={sp.sample ?? "cert"}>
          <Field label="From name"><input name="from_name" defaultValue={sp.sample === "unclear" ? "Sam" : `${p.first} ${p.last}`} className={cls.input} /></Field>
          <Field label="From address"><input name="from_addr" type="email" required defaultValue={fromAddr} className={cls.input} /></Field>
          <Field label="To" className="sm:col-span-2">
            <select name="to" defaultValue={`${user.inbox_alias}@${domain}`} className={cls.input}>
              <option value={`service@${domain}`}>service@{domain} — shared, routes to the client&apos;s account manager</option>
              {users.map((u) => <option key={u.id} value={`${u.inbox_alias}@${domain}`}>{u.inbox_alias}@{domain} — {u.full_name}</option>)}
            </select>
          </Field>
          <Field label="Subject" className="sm:col-span-2"><input name="subject" required defaultValue={s.subject} className={cls.input} /></Field>
          <Field label="Body" className="sm:col-span-2"><textarea name="body" rows={9} defaultValue={s.body} className={cls.input} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="forwarded" /> Send it as if I forwarded it from my mailbox (the client is inside the forwarded message)</label>
          <Field label="Note when forwarding (optional)" className="sm:col-span-2"><input name="note" placeholder="e.g. Please handle — client called too" className={cls.input} /></Field>
          <Field label="Attachment (optional)"><input type="file" name="attachment" className="text-sm" /></Field>
          <Field label="…or upload a whole .eml message instead"><input type="file" name="eml" accept=".eml,message/rfc822" className="text-sm" /></Field>
          <div className="sm:col-span-2"><Submit className={cls.btnPrimary} pending="Processing…">Send to intake</Submit></div>
        </form>
      </Card>
      {recent.length > 0 && <div className="mt-4 text-sm text-slate-500">Recent tests: {recent.map((r, i) => <span key={r.id}>{i > 0 && " · "}<Link className={cls.link} href={r.activity_id ? `/tasks/${r.activity_id}` : `/inbox/${r.id}`}>{r.subject}</Link></span>)}</div>}
      <Card title="From a terminal" className="mt-5" pad>
        <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST "http://localhost:3200/api/inbound/email?token=$INBOUND_EMAIL_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"${fromAddr}","to":"${user.inbox_alias}@${domain}","subject":"${s.subject}","text":"..."}'`}</pre>
      </Card>
    </div>
  );
}
