"use client";
import { useEffect, useState } from "react";
import { mergeClientAction } from "../actions";
import { ClientPicker, type ClientPick } from "@/components/client-picker";
import { Submit } from "@/components/submit";
import { cls } from "@/components/ui";
import { plural } from "@/lib/format";

type Counts = { policies: number; tasks: number; invoices: number };

/** A merge can't be undone, so its confirmation names both clients and what moves (UX-018). */
export function MergeForm({ id, name, code }: { id: number; name: string; code: string }) {
  const [drop, setDrop] = useState<ClientPick | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const dropId = drop?.id;
  useEffect(() => {
    setCounts(null);
    if (!dropId) return;
    const ctl = new AbortController();
    fetch(`/clients/${dropId}/merge-counts`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)).then(setCounts).catch(() => {});
    return () => ctl.abort();
  }, [dropId]);
  const moves = counts ? `${plural(counts.policies, "policy", "policies")}, ${plural(counts.tasks, "task")} and ${plural(counts.invoices, "invoice")} move here.` : "Everything on it moves here.";
  return (
    <details className="mt-3 border-t border-slate-100 pt-3"><summary className="text-xs font-medium text-indigo-600">Merge a duplicate into this client</summary>
      <form action={mergeClientAction} className="mt-2 space-y-2"><input type="hidden" name="id" value={id} />
        <ClientPicker name="merge_id" required exclude={id} label="Duplicate client to merge" onPick={setDrop} />
        <Submit className={cls.btnDanger} confirm={drop ? `Merge ‘${drop.name} (${drop.code})’ into ‘${name} (${code})’? ${moves} This can't be undone.` : undefined}>Merge</Submit>
      </form>
    </details>
  );
}
