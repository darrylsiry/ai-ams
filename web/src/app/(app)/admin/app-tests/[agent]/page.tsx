import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { NoAccess, PageHeader } from "@/components/ui";
import { readReport } from "@/lib/agent-activity";
import { AGENTS } from "@/lib/agent-reports";
import { when } from "@/lib/time";
import { can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  const info = AGENTS.find((a) => a.key === agent);
  return { title: info ? `${info.name} report` : "Report" };
}

/** One agent's latest report, as it wrote it. Administrators only: it can describe open weaknesses. */
export default async function AgentReportPage({ params }: { params: Promise<{ agent: string }> }) {
  if (!can(await currentUser(), "admin")) return <NoAccess what="the review reports" roles="administrator" />;
  const { agent } = await params;
  const info = AGENTS.find((a) => a.key === agent);
  if (!info) notFound();
  const report = await readReport(info.key);
  if (!report) notFound();
  return (
    <div className="max-w-5xl">
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }, { href: `/admin/app-tests?agent=${info.key}#findings`, label: "App Tests" }]} title={`${info.name} report`}
        subtitle={<>As the <code className="rounded bg-slate-100 px-1 text-xs">{info.agent}</code> agent wrote it on its latest run · saved {when(report.mtime)}</>} />
      <article className="min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <Markdown source={report.text} />
      </article>
    </div>
  );
}
