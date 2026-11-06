import Link from "next/link";
import { RequestAccessForm } from "./request-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request access" };

/** Ask for a login, linked from the sign-in page and reachable signed out. */
export default function RequestAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500 text-lg font-bold text-white">S</div>
          <h1 className="text-xl font-semibold text-white">Request access</h1>
          <p className="mt-1 text-sm text-slate-400">siryous AMS · Agency management</p>
        </div>
        <RequestAccessForm />
        <p className="mt-4 text-center text-sm"><Link href="/signin" className="text-indigo-300 hover:text-indigo-200 hover:underline">← Back to sign in</Link></p>
      </div>
    </main>
  );
}
