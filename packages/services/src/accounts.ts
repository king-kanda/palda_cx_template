import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import { passwordHash, passwordVerify } from "@garden/integrations";

export type AccountMatch = {
  tenant: typeof schema.tenants.$inferSelect;
  user: typeof schema.users.$inferSelect;
};

/**
 * Finds every business a login email belongs to, so people sign in with only an email and password.
 *
 * `users` is row-level-secured per business, so a cross-business query sees nothing under the restricted app role.
 * `login_index` (email -> tenant, kept in sync by a trigger) tells us which businesses to look inside; the user row
 * itself is then read within that business's own context, so isolation is unchanged.
 */
export async function findAccountsByEmail(email: string): Promise<AccountMatch[]> {
  const clean = email.trim().toLowerCase();
  if (!clean) return [];
  const db = getDb();
  const rows = await db.select({ tenantId: schema.loginIndex.tenantId }).from(schema.loginIndex).where(eq(schema.loginIndex.email, clean));
  const matches: AccountMatch[] = [];
  for (const { tenantId } of rows) {
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    if (!tenant) continue;
    const user = await withTenant(tenantId, (tx) =>
      tx.query.users.findFirst({
        // Compare case-insensitively: the index is lower-cased, and a stored address might not be.
        where: and(eq(schema.users.tenantId, tenantId), sql`lower(${schema.users.email}) = ${clean}`),
      }),
    );
    if (user) matches.push({ tenant, user });
  }
  return matches;
}

/**
 * Rebuilds `login_index` from the users table, one business context at a time. The migration backfills it with plain SQL,
 * but a migration role that is itself subject to row-level security sees no users; run this afterwards in that case
 * (`pnpm engine:reindex`). Safe to run any time.
 */
export async function reindexLogins(): Promise<{ businesses: number; entries: number }> {
  const db = getDb();
  const tenants = await db.query.tenants.findMany({ limit: 5000 });
  let entries = 0;
  for (const tenant of tenants) {
    const users = await withTenant(tenant.id, (tx) =>
      tx.query.users.findMany({ where: eq(schema.users.tenantId, tenant.id), columns: { email: true } }),
    );
    for (const user of users) {
      await db
        .insert(schema.loginIndex)
        .values({ email: user.email.toLowerCase(), tenantId: tenant.id })
        .onConflictDoNothing();
      entries += 1;
    }
  }
  return { businesses: tenants.length, entries };
}

/* ───────────────────────── Temporary passwords ───────────────────────── */

// No 0/O, 1/l/I: these get read out over the phone and typed from a screenshot.
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** e.g. "Kx7m-Rt9q-2Wpa": 12 random characters in three groups, about 68 bits. */
export function generateTempPassword(): string {
  const chars = Array.from({ length: 12 }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]!);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join("")).join("-");
}

/* ───────────────────────── Platform admins (Engine) ───────────────────────── */

export type PlatformAdmin = typeof schema.platformAdmins.$inferSelect;

export async function createPlatformAdmin(input: { email: string; name: string; password: string }): Promise<PlatformAdmin> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email.");
  if (input.password.length < 8) throw new Error("Use a password with at least 8 characters.");
  const [admin] = await getDb()
    .insert(schema.platformAdmins)
    .values({ email, name: input.name.trim() || email, passwordHash: passwordHash(input.password) })
    .onConflictDoUpdate({
      target: schema.platformAdmins.email,
      set: { passwordHash: passwordHash(input.password), name: input.name.trim() || email, active: true },
    })
    .returning();
  return admin!;
}

export async function authenticatePlatformAdmin(email: string, password: string): Promise<PlatformAdmin | null> {
  const admin = await getDb().query.platformAdmins.findFirst({
    where: eq(schema.platformAdmins.email, email.trim().toLowerCase()),
  });
  if (!admin || !admin.active) return null;
  return passwordVerify(password, admin.passwordHash) ? admin : null;
}

export async function getPlatformAdmin(id: string): Promise<PlatformAdmin | null> {
  const admin = await getDb().query.platformAdmins.findFirst({ where: eq(schema.platformAdmins.id, id) });
  return admin?.active ? admin : null;
}
