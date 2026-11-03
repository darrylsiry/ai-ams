import { db } from "@/lib/db";
import { aiEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { rows } = await db.query("SELECT (SELECT count(*)::int FROM clients) AS clients, (SELECT value FROM settings WHERE key = 'automation_last_run') AS automation");
    return Response.json({ ok: true, database: "up", clients: rows[0].clients, automation_last_run: rows[0].automation, ai: aiEnabled() ? "on" : "off (no ANTHROPIC_API_KEY)",
      inbound_email: process.env.INBOUND_EMAIL_TOKEN ? "configured" : "off (no INBOUND_EMAIL_TOKEN)" });
  } catch (err) {
    return Response.json({ ok: false, database: (err as Error).message }, { status: 503 });
  }
}
