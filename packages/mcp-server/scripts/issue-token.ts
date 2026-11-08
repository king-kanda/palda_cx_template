import { and, eq } from "drizzle-orm";
import { closeDb, getDb, loadEnv, schema } from "@garden/db";
import { CUSTOMER_SCOPES } from "@garden/services";
import { signMcpToken, type McpTokenClaims } from "../src/auth";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!;
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

loadEnv();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slug = str(args, "tenant") ?? process.env.DEFAULT_TENANT_SLUG ?? "palda";
  const type = (str(args, "type") ?? "staff") as McpTokenClaims["pt"];
  const expires = str(args, "expires") ?? "365d";
  const db = getDb();

  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
  if (!tenant) throw new Error(`No tenant with slug "${slug}". Run pnpm db:seed first.`);

  let claims: McpTokenClaims;
  if (type === "staff") {
    const email = str(args, "email");
    if (!email) throw new Error("--email is required for a staff token (e.g. owner@palda.co.ke).");
    const user = await db.query.users.findFirst({
      where: and(
        eq(schema.users.tenantId, tenant.id),
        eq(schema.users.email, email.toLowerCase()),
      ),
    });
    if (!user) throw new Error(`No user ${email} in tenant ${slug}.`);
    claims = {
      tid: tenant.id,
      pt: "staff",
      pid: user.id,
      role: user.role === "owner" ? "owner" : "staff",
      scopes: ["*"],
      label: user.email,
    };
  } else if (type === "customer") {
    const phone = str(args, "phone");
    const id = str(args, "customer");
    const customer = id
      ? await db.query.customers.findFirst({
          where: and(eq(schema.customers.tenantId, tenant.id), eq(schema.customers.id, id)),
        })
      : phone
        ? await db.query.customers.findFirst({
            where: and(eq(schema.customers.tenantId, tenant.id), eq(schema.customers.phoneE164, phone)),
          })
        : null;
    if (!customer) throw new Error("Pass --customer <uuid> or --phone +2547XXXXXXXX.");
    claims = {
      tid: tenant.id,
      pt: "customer",
      pid: customer.id,
      phone: customer.phoneE164,
      scopes: [...CUSTOMER_SCOPES],
      label: customer.name,
    };
  } else {
    claims = {
      tid: tenant.id,
      pt: "system",
      scopes: ["*"],
      label: str(args, "label") ?? "wambo",
    };
  }

  const token = await signMcpToken(claims, expires);
  console.log(token);
  await closeDb();
}

main().catch(async (error) => {
  console.error("[mcp] issue-token failed:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
