import Link from "next/link";
import { Card, PageHeader, cls } from "@/components/ui";
import { toolsFor } from "@/lib/assistant-tools";
import { ROLE_LABEL, currentUser } from "@/lib/user";

export const metadata = { title: "What the AI Assistant can see" };

/** The assistant's limits in plain words, and exactly which lookups this person's role gives it. */
export default async function AboutAssistant() {
  const user = await currentUser();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader crumbs={[{ href: "/assistant", label: "AI Assistant" }]} title="What the AI Assistant can see" subtitle={`For your role: ${ROLE_LABEL[user.role]}`} />
      <Card title="The rules" pad>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
          <li><b>It only reads.</b> It can&apos;t create, change, send or post anything. It tells you how, and links the page.</li>
          <li><b>It sees what your role can see.</b> Someone in another role gets different answers to the same question.</li>
          <li><b>Some records never go to it, for anyone:</b> the date of birth, license and FEIN fields, driver details, confidential notes and restricted documents.</li>
          <li><b>Free text is filtered, but not perfectly.</b> Numbers shaped like these identifiers are removed from email, notes and questions before they&apos;re sent. A filter can miss one typed an unusual way, so don&apos;t paste them into a question.</li>
          <li><b>What it reads goes to Anthropic</b> to produce the answer, including client names, policy details, email and notes. An administrator can turn it off in <Link href="/admin/settings" className={cls.link}>Settings</Link>.</li>
          <li><b>Check what matters.</b> It can be wrong. Follow the links before acting, and it doesn&apos;t decide coverage or give legal advice.</li>
          <li><b>Questions are logged:</b> who asked, what, and which lookups ran, so the agency can see how it&apos;s used.</li>
        </ul>
      </Card>
      <Card title="Lookups your role allows"><ul className="divide-y divide-slate-100">{toolsFor(user).map((t) => <li key={t.name} className="px-4 py-2 text-sm"><span className="font-medium capitalize text-slate-900">{t.name.replace(/_/g, " ")}</span><p className="text-xs text-slate-500">{t.description}</p></li>)}</ul></Card>
    </div>
  );
}
