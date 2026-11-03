import { NextResponse } from "next/server";
import { todayISO } from "@/lib/format";
import { currentUser } from "@/lib/user";
import { queueFor } from "@/lib/work";

export const dynamic = "force-dynamic";

/** "Start next task": open the highest-ranked task in the current user's queue. */
export async function GET(req: Request) {
  const u = await currentUser();
  const queue = await queueFor(u.id, todayISO());
  const msg = new URL(req.url).searchParams.get("msg");
  const to = queue[0] ? `/tasks/${queue[0].id}?focus=1${msg ? `&msg=${encodeURIComponent(msg)}` : ""}` : `/?msg=${encodeURIComponent(msg ? `${msg} Your queue is clear.` : "Your queue is clear.")}`;
  return new NextResponse(null, { status: 303, headers: { Location: to } });
}
