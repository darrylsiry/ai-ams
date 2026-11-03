"use client";

// Safety net for a page that fails to render: say so plainly and offer a retry, inside the app shell.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-xl rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
      <div className="font-semibold">This page couldn&apos;t load</div>
      <p className="mt-1">Nothing was changed. Try again, and if it keeps happening, send an administrator the reference below.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-rose-700">Reference {error.digest}</p>}
      <button onClick={reset} className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-rose-900 ring-1 ring-rose-300 hover:bg-rose-100">Try again</button>
    </div>
  );
}
