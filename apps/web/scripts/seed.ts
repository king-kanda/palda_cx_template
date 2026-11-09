import { loadEnv } from "@garden/db";
import { seedDemoTenant } from "@garden/services";
import type { VerticalId } from "@garden/verticals";

loadEnv();

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function main() {
  const slug = arg("slug", process.env.DEFAULT_TENANT_SLUG ?? "palda")!;
  const vertical = (arg("vertical", "venue") ?? "venue") as VerticalId;
  const reset = process.argv.includes("--reset");
  const name = arg("name", "Palda Gardens")!;
  const ownerEmail = arg("owner", process.env.SEED_OWNER_EMAIL ?? "owner@palda.co.ke")!;
  const ownerPassword = arg("password", process.env.SEED_OWNER_PASSWORD ?? "owner1234")!;
  const staffEmail = arg("staff", process.env.SEED_STAFF_EMAIL ?? "staff@palda.co.ke")!;
  const staffPassword = arg("staff-password", process.env.SEED_STAFF_PASSWORD ?? "staff1234")!;

  const result = await seedDemoTenant({
    slug,
    name,
    vertical,
    ownerEmail,
    ownerPassword,
    staffEmail,
    staffPassword,
    reset,
  });

  console.log("\nDemo tenant ready\n");
  console.log(`  Tenant:   ${result.slug} (${result.vertical})`);
  console.log(`  Tenant ID:${result.tenantId}`);
  console.log(`  Owner:    ${result.ownerEmail} / ${ownerPassword}`);
  console.log(`  Staff:    ${staffEmail} / ${staffPassword}`);
  console.log(
    `  Seeded:   ${result.counts.customers} customers, ${result.counts.resources} resources, ` +
      `${result.counts.offerings} offerings, ${result.counts.bookings} bookings, ` +
      `${result.counts.invoices} invoices, ${result.counts.payments} payments`,
  );
  if (result.counts.skipped) {
    console.log(`  Skipped:  ${result.counts.skipped} overlapping demo bookings (expected)`);
  }
  console.log("\nNext: pnpm dev  ->  http://localhost:3000/login\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
