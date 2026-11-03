// What a form action returns when it turns a submission down, so the form comes back as it was typed (UX-009).
// Used with useActionState. Nothing here touches the server or the browser, so both sides can import it.

export type Rejected = { error: string; values: Record<string, string | string[]>; at: number };
export type FormState = Rejected | null;

/** `at` is new on every rejection: key the fields on it, because React only reads a select's default when it mounts. */
export function rejected(f: FormData, error: string): Rejected {
  const values: Record<string, string | string[]> = {};
  for (const k of new Set(f.keys())) {
    if (k.startsWith("$")) continue;   // React's own action fields
    const all = f.getAll(k).filter((v): v is string => typeof v === "string");
    if (all.length) values[k] = all.length > 1 ? all : all[0]!;
  }
  return { error, values, at: Date.now() };
}

/** Each field's starting value: what was typed if the form came back, otherwise `initial`. */
export function fieldsOf(state: FormState) {
  const typed = state?.values;
  return {
    text: (k: string, initial = "") => { if (!typed) return initial; const v = typed[k]; return Array.isArray(v) ? v[0] ?? "" : v ?? ""; },
    on: (k: string, initial = false) => (typed ? typed[k] === "on" : initial),
    all: (k: string, initial: string[] = []) => { if (!typed) return initial; const v = typed[k]; return v === undefined ? [] : Array.isArray(v) ? v : [v]; },
  };
}
