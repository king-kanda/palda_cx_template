import { staffPrincipal, type Principal } from "@garden/services";
import type { Session } from "./auth";

export function principalOf(session: Session): Principal {
  return staffPrincipal(session.tenantId, session.userId, session.role);
}
