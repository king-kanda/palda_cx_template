import { randomBytes } from "node:crypto";
import { closeDb, loadEnv } from "@garden/db";
import { SHOWCASE_BUSINESSES, seedShowcaseBusiness } from "@garden/services";

loadEnv();

/**
 * Seeds the three showcase businesses (a garden venue, a dental clinic, a cleaning company) with a year of realistic data.
 *   pnpm db:showcase                 # create them (refuses if one already exists)
 *   pnpm db:showcase --reset         # wipe and recreate them (deletes everything in those three businesses)
 *   pnpm db:showcase --only palda    # just one
 * Each run prints new passwords for the owner and staff logins.
 */
const reset = process.argv.includes("--reset");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
const password = () => randomBytes(12).toString("base64url").slice(0, 14);

async function main() {
  const rows: string[] = [];
  for (const business of SHOWCASE_BUSINESSES.filter((b) => !only || b.slug === only)) {
    const passwords = { owner: password(), staff: password() };
    const started = Date.now();
    process.stdout.write(`Seeding ${business.name}... `);
    const result = await seedShowcaseBusiness(business, passwords, { reset });
    const c = result.counts;
    console.log(
      `done in ${Math.round((Date.now() - started) / 1000)}s: ${c.history} past and ${c.upcoming} upcoming bookings, ${c.payments} payments, ` +
        `${c.customers} extra customers, ${c.chats} chats, ${c.reviews} reviews, ${c.expenses} expenses`,
    );
    rows.push(`  ${business.name}\n    owner  ${business.ownerEmail}  /  ${passwords.owner}\n    staff  ${business.staffEmail}  /  ${passwords.staff}`);
  }
  console.log(`\nLogins (sign in at /login):\n\n${rows.join("\n\n")}\n`);
  await closeDb();
}

main().catch(async (error) => {
  console.error("\nShowcase seed failed:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
