import { closeDb, loadEnv } from "@garden/db";
import { reindexLogins } from "@garden/services";

loadEnv();

/**
 * Rebuilds the email -> business lookup that email-only sign-in uses. Normally the database keeps it in sync by itself;
 * run this once after migrating a database whose migration role could not see every business, or if sign-in ever
 * says "wrong email" for an account that exists.
 */
async function main() {
  const result = await reindexLogins();
  console.log(`\nLogin index rebuilt: ${result.entries} logins across ${result.businesses} businesses.\n`);
  await closeDb();
}

main().catch(async (error) => {
  console.error("\nReindex failed:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
