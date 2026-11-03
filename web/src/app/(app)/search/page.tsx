import Link from "next/link";
import { Card, Empty, PageHeader, Status, cls } from "@/components/ui";
import { q } from "@/lib/db";
import { money, whenShort } from "@/lib/format";
import { lobLabel } from "@/lib/ref";

export const metadata = { title: "Search" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const term = ((await searchParams).q ?? "").trim();
  if (!term) return <div><PageHeader title="Search" /><Empty>Type a client, contact, policy number, claim, certificate, phone or email in the box above.</Empty></div>;
  const digits = term.replace(/\D/g, "");
  const [clients, contacts, policies, claims, certs, emails, tasks] = await Promise.all([
    q<{ id: number; name: string; code: string; status: string; city: string | null }>(`SELECT id, name, code, status, city FROM clients WHERE name ILIKE '%' || $1 || '%' OR code ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
      OR ($2 <> '' AND length($2) >= 4 AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE '%' || $2 || '%') ORDER BY status = 'insured' DESC, name LIMIT 20`, [term, digits]),
    q<{ client_id: number; client: string; name: string; email: string | null; title: string | null }>(`SELECT ct.client_id, c.name AS client, ct.first_name || ' ' || ct.last_name AS name, ct.email, ct.title FROM contacts ct JOIN clients c ON c.id = ct.client_id
      WHERE (ct.first_name || ' ' || ct.last_name) ILIKE '%' || $1 || '%' OR ct.email ILIKE '%' || $1 || '%' OR ($2 <> '' AND length($2) >= 4 AND regexp_replace(coalesce(ct.phone, ct.mobile, ''), '\\D', '', 'g') LIKE '%' || $2 || '%') LIMIT 15`, [term, digits]),
    q<{ id: number; policy_number: string; lob: string; status: string; client: string; premium: string; expiration_date: string }>(`SELECT p.id, p.policy_number, p.lob, p.status, c.name AS client, p.premium, p.expiration_date FROM policies p JOIN clients c ON c.id = p.client_id
      WHERE p.policy_number ILIKE '%' || $1 || '%' OR replace(p.policy_number, '-', '') ILIKE '%' || replace($1, '-', '') || '%' ORDER BY p.expiration_date DESC LIMIT 15`, [term]),
    q<{ id: number; claim_number: string; carrier_claim_number: string | null; client: string; status: string }>(`SELECT cl.id, cl.claim_number, cl.carrier_claim_number, c.name AS client, cl.status FROM claims cl JOIN clients c ON c.id = cl.client_id WHERE cl.claim_number ILIKE '%' || $1 || '%' OR cl.carrier_claim_number ILIKE '%' || $1 || '%' LIMIT 10`, [term]),
    q<{ id: number; cert_number: string; holder: string | null; client: string; status: string }>(`SELECT ce.id, ce.cert_number, oi.name AS holder, c.name AS client, ce.status FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id
      WHERE ce.cert_number ILIKE '%' || $1 || '%' OR oi.name ILIKE '%' || $1 || '%' ORDER BY ce.issued_at DESC LIMIT 10`, [term]),
    q<{ id: number; subject: string; from_addr: string; received_at: Date }>(`SELECT id, subject, coalesce(original_from_addr, from_addr) AS from_addr, received_at FROM emails WHERE subject ILIKE '%' || $1 || '%' OR from_addr ILIKE '%' || $1 || '%' OR original_from_addr ILIKE '%' || $1 || '%' ORDER BY received_at DESC LIMIT 10`, [term]),
    q<{ id: number; subject: string; status: string }>(`SELECT id, subject, status FROM activities WHERE subject ILIKE '%' || $1 || '%' ORDER BY (status IN ('open','waiting')) DESC, created_at DESC LIMIT 10`, [term]),
  ]);
  const total = clients.length + contacts.length + policies.length + claims.length + certs.length + emails.length + tasks.length;
  const Section = ({ title, n, children }: { title: string; n: number; children: React.ReactNode }) => n ? <Card title={`${title} · ${n}`}><ul className="divide-y divide-slate-100">{children}</ul></Card> : null;
  return (
    <div>
      <PageHeader title={`Search: “${term}”`} subtitle={`${total} result${total === 1 ? "" : "s"}`} />
      {total === 0 && <Card><Empty>Nothing found. Try part of a name, a policy number, or the last digits of a phone number.</Empty></Card>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Clients" n={clients.length}>{clients.map((c) => <li key={c.id} className="flex items-center justify-between px-4 py-2 text-sm"><Link href={`/clients/${c.id}`} className={cls.link}>{c.name}</Link><span className="flex items-center gap-2 text-xs text-slate-500">{c.code} · {c.city}<Status s={c.status} /></span></li>)}</Section>
        <Section title="Policies" n={policies.length}>{policies.map((p) => <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm"><Link href={`/policies/${p.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{p.policy_number}</Link><span className="flex items-center gap-2 text-xs text-slate-500">{p.client} · {lobLabel(p.lob)} · {money(p.premium)}<Status s={p.status} /></span></li>)}</Section>
        <Section title="Contacts" n={contacts.length}>{contacts.map((c, i) => <li key={i} className="px-4 py-2 text-sm"><Link href={`/clients/${c.client_id}?tab=contacts`} className={cls.link}>{c.name}</Link> <span className="text-xs text-slate-500">{c.title ? `${c.title}, ` : ""}{c.client} · {c.email}</span></li>)}</Section>
        <Section title="Claims" n={claims.length}>{claims.map((c) => <li key={c.id} className="px-4 py-2 text-sm"><Link href={`/claims/${c.id}`} className={cls.link}>{c.claim_number}</Link> <span className="text-xs text-slate-500">{c.client} · {c.carrier_claim_number} · {c.status}</span></li>)}</Section>
        <Section title="Certificates" n={certs.length}>{certs.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm"><span><Link href={`/certificates/${c.id}`} className={cls.link}>{c.cert_number}</Link> <span className="text-xs text-slate-500">{c.client} → {c.holder}</span></span><Status s={c.status} /></li>)}</Section>
        <Section title="Email" n={emails.length}>{emails.map((e) => <li key={e.id} className="px-4 py-2 text-sm"><Link href={`/inbox/${e.id}`} className={cls.link}>{e.subject}</Link> <span className="text-xs text-slate-500">{e.from_addr} · {whenShort(e.received_at)}</span></li>)}</Section>
        <Section title="Tasks" n={tasks.length}>{tasks.map((t) => <li key={t.id} className="flex justify-between px-4 py-2 text-sm"><Link href={`/tasks/${t.id}`} className={cls.link}>{t.subject}</Link><Status s={t.status} /></li>)}</Section>
      </div>
    </div>
  );
}
