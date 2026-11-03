import { NoAccess } from "@/components/ui";
import { can, currentUser, type Permission } from "@/lib/user";

/**
 * A page's own permission check (SEC-006): the NoAccess panel when the user lacks `p`, else null. A
 * check in a shared layout isn't enough, because a client navigation re-renders only the page.
 */
export async function denied(p: Permission, what: string, roles: string) {
  return can(await currentUser(), p) ? null : <NoAccess what={what} roles={roles} />;
}
