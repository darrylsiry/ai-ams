"use client";
import { useFormStatus } from "react-dom";

/** A submit button that disables itself and shows progress while its form's action runs. */
export function Submit({ children, className, pending, formAction, confirm }: { children: React.ReactNode; className?: string; pending?: string; formAction?: (f: FormData) => Promise<void>; confirm?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} disabled={busy} className={className}
      onClick={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {busy ? (pending ?? "Working…") : children}
    </button>
  );
}
