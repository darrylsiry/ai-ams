import { NextResponse } from "next/server";
import { mergeCounts } from "@/lib/client-search";
import { can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** What a merge would move, for its confirmation. Only people who can merge may ask. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!can(user, "team")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(await mergeCounts(Number(id)), { headers: { "Cache-Control": "no-store" } });
}
