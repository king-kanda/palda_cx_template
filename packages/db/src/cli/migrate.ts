import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../client";
import { loadEnv } from "../env";

loadEnv();

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

async function main() {
  console.log(`[db] migrating from ${migrationsFolder}`);
  await migrate(getDb(), { migrationsFolder });
  console.log("[db] migrations complete");
  await closeDb();
}

main().catch(async (err) => {
  console.error("[db] migration failed:", err);
  await closeDb();
  process.exit(1);
});
