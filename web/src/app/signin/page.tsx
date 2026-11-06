import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsers } from "@/lib/basic-auth";
import { safeNext, signInAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

type Params = { next?: string; error?: string; username?: string; signedout?: string; disabled?: string; throttled?: string };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  if (!loadUsers(process.env).size) redirect("/");
  const next = await safeNext(p.next);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white">S</div>
          <h1 className="text-xl font-semibold text-white">siryous AMS</h1>
          <p className="mt-1 text-sm text-slate-400">Agency management</p>
        </div>
        <form action={signInAction} className="rounded-xl bg-white p-6 shadow-lg">
          <input type="hidden" name="next" value={next} />
          {p.signedout && <p className="mb-4 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">You&apos;re signed out.</p>}
          {p.disabled && <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">This login has been turned off. Ask your administrator.</p>}
          {p.throttled && <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">Too many failed attempts. Wait a minute and try again.</p>}
          {p.error && <p className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">That user ID or password isn&apos;t right.</p>}
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="username">User ID</label>
          <input id="username" name="username" autoComplete="username" autoFocus required defaultValue={p.username ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <button className="mt-6 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Sign in</button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-300">Don&apos;t have a login? <Link href="/request-access" className="font-medium text-indigo-300 hover:text-indigo-200 hover:underline">Request access</Link></p>
        <p className="mt-2 text-center text-xs text-slate-400">Logins are issued per person by your administrator.</p>
      </div>
    </main>
  );
}
