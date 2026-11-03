import { NextResponse } from "next/server";
import { CLIENT_SCOPES, searchClients, type ClientScope } from "@/lib/client-search";
import { money } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Type-ahead for the client picker: /clients/lookup?q=<text>&scope=<which clients>&exclude=<id> */
export async function GET(req: Request) {
  const user = await currentUser();
  const p = new URL(req.url).searchParams;
  const asked = p.get("scope") ?? "all";
  const scope: ClientScope = Object.hasOwn(CLIENT_SCOPES, asked) ? asked as ClientScope : "all";
  // Balances are what the payment screen shows, and only payment staff can open it.
  if (scope === "open_balance" && !can(user, "accounting")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await searchClients(p.get("q") ?? "", { scope, exclude: Number(p.get("exclude")) || null });
  const clients = rows.map(({ balance, ...c }) => ({ ...c, note: balance === null ? null : money(balance, true) }));
  return NextResponse.json({ clients }, { headers: { "Cache-Control": "no-store" } });
}
