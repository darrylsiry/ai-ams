import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request a quote" };

const input = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

export default async function Quote({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const sp = await searchParams;
  const agency = (await one<{ value: { name: string; phone: string } }>("SELECT value FROM settings WHERE key = 'agency'"))?.value;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-semibold text-slate-900">Request a quote</h1>
        <p className="mt-1 text-sm text-slate-600">{agency?.name} · {agency?.phone}. A licensed agent will contact you within one business day.</p>
        {sp.sent ? <p className="mt-6 rounded-md bg-emerald-50 p-4 text-emerald-800">Thank you — we received your request and will be in touch shortly.</p> : (
          <form method="post" action="/api/leads" className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            {sp.error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">Please give your name and email.</p>}
            <div className="grid grid-cols-2 gap-3"><label className="text-sm">First name<input name="first_name" required className={input} /></label><label className="text-sm">Last name<input name="last_name" required className={input} /></label></div>
            <label className="block text-sm">Business name (if a business)<input name="business" className={input} /></label>
            <div className="grid grid-cols-2 gap-3"><label className="text-sm">Email<input name="email" type="email" required className={input} /></label><label className="text-sm">Phone<input name="phone" className={input} /></label></div>
            <label className="block text-sm">ZIP code<input name="zip" className={input} /></label>
            <fieldset className="text-sm"><legend className="mb-1">I&apos;m interested in</legend><div className="flex flex-wrap gap-3">{["Auto", "Home", "Umbrella", "Business insurance", "Workers' comp", "Commercial auto"].map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" name="coverage" value={c} />{c}</label>)}</div></fieldset>
            <label className="block text-sm">Anything else?<textarea name="message" rows={3} className={input} /></label>
            <input name="website_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
            <p className="text-xs text-slate-500">By submitting you agree that we may contact you about insurance by phone or email.</p>
            <button className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Send request</button>
          </form>
        )}
      </div>
    </main>
  );
}
