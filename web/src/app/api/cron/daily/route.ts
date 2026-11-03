import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyAutomation } from "@/lib/automation";

export const dynamic = "force-dynamic";

/** Daily automation for an external scheduler (GitHub Actions, a Fly scheduled machine): POST with CRON_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.CRON_TOKEN;
  // Header only: a token in the URL ends up in proxy logs (SEC-017).
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!token || got.length !== token.length || !timingSafeEqual(Buffer.from(got), Buffer.from(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runDailyAutomation());
}
