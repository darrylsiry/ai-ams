import { denied } from "@/components/gate";
import { emailEnabled } from "@/lib/email/send";
import { Card, KV, PageHeader, Pill } from "@/components/ui";
import { AI_MODEL, aiEnabled } from "@/lib/ai";
import { loadUsers } from "@/lib/basic-auth";
import { one } from "@/lib/db";
import { configuredOrigin } from "@/lib/http";

export const metadata = { title: "System status" };

export default async function System() {
  const deny = await denied("admin", "system status", "administrator");
  if (deny) return deny;
  const db = await one<{ v: string; size: string; clients: number; emails: number; last: string }>(`SELECT version() AS v, pg_size_pretty(pg_database_size(current_database())) AS size, (SELECT count(*)::int FROM clients) AS clients,
    (SELECT count(*)::int FROM emails) AS emails, (SELECT value::text FROM settings WHERE key = 'automation_last_run') AS last`);
  const origin = configuredOrigin() ?? "http://localhost:3200";
  const on = (b: boolean, yes: string, no: string) => b ? <Pill tone="green">{yes}</Pill> : <Pill tone="amber">{no}</Pill>;
  return (
    <div className="max-w-4xl">
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="System status" />
      <div className="space-y-5">
        <Card title="Runtime" pad><KV cols={2} items={[["Database", db?.v.split(" ").slice(0, 2).join(" ")], ["Database size", db?.size], ["Clients / emails", `${db?.clients} / ${db?.emails}`], ["Daily automation last ran", db?.last?.replace(/"/g, "")],
          ["Deployment", process.env.FLY_APP_NAME ? `Fly.io app ${process.env.FLY_APP_NAME} (${process.env.FLY_REGION ?? ""})` : "Local"], ["Public URL", origin]]} /></Card>
        <Card title="Sign-in" pad><KV cols={2} items={[["Password gate", on(loadUsers(process.env).size > 0, `on — ${loadUsers(process.env).size} logins`, "off (local development)")], ["Session", "Signed cookie, 7 days; API uses HTTP Basic"]]} /></Card>
        <Card title="Claude (AI assists)" pad><KV cols={2} items={[["Status", on(aiEnabled(), "on", "off — set ANTHROPIC_API_KEY")], ["Model", AI_MODEL], ["Used for", "Email triage, policy checking, commission statement PDFs, account Q&A"], ["Without a key", "Keyword rules and manual steps; nothing breaks"]]} /></Card>
        <Card title="Inbound email" pad><KV cols={1} items={[["Webhook", on(!!process.env.INBOUND_EMAIL_TOKEN, "configured", "off — set INBOUND_EMAIL_TOKEN")], ["Endpoint", `${origin}/api/inbound/email`], ["Addresses", `<alias>@${process.env.INBOUND_EMAIL_DOMAIN || "(set INBOUND_EMAIL_DOMAIN)"} and service@…`], ["Providers", "Postmark JSON, Mailgun / SendGrid forms, raw MIME (Cloudflare Email Workers, SES). See docs/INBOUND_EMAIL.md"]]} /></Card>
        <Card title="Outbound email" pad><KV cols={1} items={[["Status", on(emailEnabled(), "configured — replies and certificates are emailed", "off — replies and certificate deliveries are only logged until SMTP_URL is set")]]} /></Card>
      </div>
    </div>
  );
}
