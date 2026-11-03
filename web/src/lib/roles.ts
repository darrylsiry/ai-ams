// Role names, with nothing else attached, so code that can't load the session (tests) can use them.
import type { Role } from "./user";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator", principal: "Principal", account_manager: "Account manager",
  csr: "Customer service rep", producer: "Producer", accounting: "Accounting", readonly: "Read only",
};
