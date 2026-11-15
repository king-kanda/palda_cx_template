"use server";

import { redirect } from "next/navigation";
import { destroySession, getSession } from "@/lib/auth";

/** Ends a Palda admin's visit to a customer's app and returns them to that customer in the Engine. */
export async function exitImpersonationAction(): Promise<void> {
  const session = await getSession();
  await destroySession();
  redirect(session?.impersonator ? `/engine/${session.tenantId}` : "/login");
}
