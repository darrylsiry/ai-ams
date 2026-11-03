// Who may do what, with nothing else attached, so server code and tests can both use it.
import type { Role, User } from "./user";

export type Permission =
  | "admin"            // users, settings, roadmap
  | "team"             // team workload view, reassign anyone's work
  | "pii"              // see DOB, license numbers, FEIN
  | "accounting"       // post receipts, statements, payables, lock periods
  | "accounting.view"  // see accounting screens
  | "reports.all"      // every user's numbers, not just your own
  | "write";           // change clients, policies, certificates, claims

const GRANTS: Record<Role, Permission[]> = {
  admin: ["admin", "team", "pii", "accounting", "accounting.view", "reports.all", "write"],
  principal: ["team", "pii", "accounting", "accounting.view", "reports.all", "write"],
  account_manager: ["write", "accounting.view"],
  csr: ["write"],
  producer: ["write"],
  accounting: ["accounting", "accounting.view", "reports.all"],
  readonly: [],
};

export function can(u: Pick<User, "role" | "can_view_pii">, p: Permission): boolean {
  if (p === "pii" && u.can_view_pii) return true;
  return GRANTS[u.role]?.includes(p) ?? false;
}

/** Owners act on their own work; the team permission acts on anyone's; unassigned work is open to anyone who can work at all (SEC-005, SEC-027). */
export function mayActOn(u: Pick<User, "id" | "role" | "can_view_pii">, ownerId: number | null): boolean {
  if (can(u, "team")) return true;
  if (!can(u, "write") && !can(u, "accounting")) return false;
  return !ownerId || ownerId === u.id;
}
