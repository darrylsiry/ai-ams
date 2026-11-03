import { denied } from "@/components/gate";
import { Pager } from "@/components/pager";
import { Card, Flash, PageHeader, Status, Table, cls } from "@/components/ui";
import { ASSISTANT_MODEL, MAX_PER_HOUR, assistantConfigured } from "@/lib/assistant";
import { one, q } from "@/lib/db";
import { num, whenShort } from "@/lib/format";
import { paging } from "@/lib/paging";
import { qs } from "@/lib/url";

export const metadata = { title: "AI Assistant use" };

/** Who asked the assistant what, and how much it used: the agency's record of what went to Anthropic. */
export default async function AssistantUse({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("admin", "AI Assistant use", "administrator");
  if (deny) return deny;
  const sp = await searchParams;
  const total = await one<{ n: number }>("SELECT count(*)::int AS n FROM assistant_log");
  const at = paging(sp.page, total!.n);
  const [people, rows] = await Promise.all([
    q<{ username: string; questions: number; failed: number; input: string; cached: string; output: string; last: Date }>("SELECT username, count(*)::int AS questions, count(*) FILTER (WHERE outcome = 'failed')::int AS failed, sum(input_tokens)::text AS input, sum(cached_tokens)::text AS cached, sum(output_tokens)::text AS output, max(asked_at) AS last FROM assistant_log WHERE asked_at > now() - interval '30 days' GROUP BY username ORDER BY questions DESC"),
    q<{ id: number; username: string; asked_at: Date; question: string; tools: string[]; rounds: number; input_tokens: number; output_tokens: number; ms: number; outcome: string }>(`SELECT id, username, asked_at, question, tools, rounds, input_tokens, output_tokens, ms, outcome FROM assistant_log ORDER BY id DESC LIMIT ${at.size} OFFSET ${at.offset}`),
  ]);
  return (
    <div className="space-y-5">
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="AI Assistant use" subtitle={`${assistantConfigured() ? `On, using ${ASSISTANT_MODEL}` : "Off: no API key on this server"}. Each person can ask ${MAX_PER_HOUR} questions an hour. Identifiers are removed from questions before they're stored or sent.`} />
      <Card title="By person, last 30 days"><Table head={["Person", { label: "Questions", num: true }, { label: "Failed", num: true }, { label: "Tokens in", num: true }, { label: "Cached", num: true }, { label: "Tokens out", num: true }, "Last asked"]} empty="Nobody has asked anything yet.">
        {people.map((p) => <tr key={p.username}><td className={cls.td}>{p.username}</td><td className={cls.num}>{p.questions}</td><td className={cls.num}>{p.failed}</td><td className={cls.num}>{num(p.input)}</td><td className={cls.num}>{num(p.cached)}</td><td className={cls.num}>{num(p.output)}</td><td className={`${cls.td} text-xs`}>{whenShort(p.last)}</td></tr>)}
      </Table></Card>
      <Card title="Questions"><Table head={["When", "Person", "Question", "Lookups", { label: "Tokens", num: true }, { label: "Seconds", num: true }, "Result"]} empty="Nobody has asked anything yet.">
        {rows.map((r) => <tr key={r.id}><td className={`${cls.td} whitespace-nowrap text-xs`}>{whenShort(r.asked_at)}</td><td className={`${cls.td} text-xs`}>{r.username}</td><td className={`${cls.td} max-w-md`}>{r.question}</td><td className={`${cls.td} text-xs text-slate-500`}>{r.tools.map((t) => t.replace(/_/g, " ")).join(", ")}</td><td className={cls.num}>{num(r.input_tokens + r.output_tokens)}</td><td className={cls.num}>{(r.ms / 1000).toFixed(1)}</td><td className={cls.td}><Status s={r.outcome === "answered" ? "done" : r.outcome === "failed" ? "declined" : "closed"} /></td></tr>)}
      </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Question pages" /></Card>
    </div>
  );
}
