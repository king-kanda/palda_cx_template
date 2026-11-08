import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type DbOrTx = Db | Tx;

type GlobalWithDb = typeof globalThis & {
  __gardenSql?: ReturnType<typeof postgres>;
  __gardenDb?: Db;
};

const globalForDb = globalThis as GlobalWithDb;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and start Postgres (docker compose up -d).",
    );
  }
  return url;
}

export function getSql() {
  if (!globalForDb.__gardenSql) {
    globalForDb.__gardenSql = postgres(connectionString(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return globalForDb.__gardenSql;
}

export function getDb(): Db {
  if (!globalForDb.__gardenDb) {
    globalForDb.__gardenDb = drizzle(getSql(), { schema });
  }
  return globalForDb.__gardenDb;
}

/**
 * Runs `fn` inside a transaction whose `app.tenant_id` is set for the
 * transaction. This is what makes the RLS policies effective when the app
 * connects with a non-owner Postgres role.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Tx);
  });
}

/** Reads current_setting('app.tenant_id') — used by RLS `USING` policies. */
export const currentTenant = sql<string | null>`nullif(current_setting('app.tenant_id', true), '')`;

export async function pingDb(): Promise<boolean> {
  try {
    await getSql()`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__gardenSql) {
    await globalForDb.__gardenSql.end({ timeout: 5 });
    globalForDb.__gardenSql = undefined;
    globalForDb.__gardenDb = undefined;
  }
}
