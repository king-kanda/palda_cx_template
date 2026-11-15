import { and, eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";

export type AccountMatch = {
  tenant: typeof schema.tenants.$inferSelect;
  user: typeof schema.users.$inferSelect;
};

/**
 * Finds every business a login email belongs to, so people sign in with email + password only.
 *
 * Users are row-level-secured per tenant, so a cross-tenant `select` would see nothing under the restricted
 * application role. Instead we look inside each business's own tenant context. That costs one small query per
 * business (run in small batches so we never exhaust the pool), which is fine for hundreds of businesses; past that,
 * add a non-RLS email -> tenant index maintained by a trigger.
 */
export async function findAccountsByEmail(email: string): Promise<AccountMatch[]> {
  const clean = email.trim().toLowerCase();
  if (!clean) return [];
  const tenants = await getDb().query.tenants.findMany({ limit: 1000 });
  const matches: AccountMatch[] = [];
  const BATCH = 8;
  for (let i = 0; i < tenants.length; i += BATCH) {
    const batch = tenants.slice(i, i + BATCH);
    const found = await Promise.all(
      batch.map(async (tenant) => {
        const user = await withTenant(tenant.id, (tx) =>
          tx.query.users.findFirst({
            where: and(eq(schema.users.tenantId, tenant.id), eq(schema.users.email, clean)),
          }),
        );
        return user ? { tenant, user } : null;
      }),
    );
    for (const match of found) if (match) matches.push(match);
  }
  return matches;
}
