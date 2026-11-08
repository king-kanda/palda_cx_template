import { getSql } from "@garden/db";

/**
 * Advisory locks are held on a pinned postgres.js connection. Drizzle's pool
 * may hand different connections to different queries, and session-level locks
 * are per connection, so `reserve()` is required.
 */
export class LockUnavailableError extends Error {
  constructor(message = "This conversation is already being handled.") {
    super(message);
    this.name = "LockUnavailableError";
  }
}

export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const sql = getSql();
  const reserved = await sql.reserve();
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${key})) as locked
    `;
    if (!row?.locked) throw new LockUnavailableError();
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(hashtext(${key}))`.catch(() => undefined);
    }
  } finally {
    reserved.release();
  }
}

/** Non-throwing variant used for the engine's acquireLock hook. */
export async function tryAdvisoryLock(key: string): Promise<() => Promise<void>> {
  const sql = getSql();
  const reserved = await sql.reserve();
  const [row] = await reserved<{ locked: boolean }[]>`
    select pg_try_advisory_lock(hashtext(${key})) as locked
  `;
  if (!row?.locked) {
    reserved.release();
    throw new LockUnavailableError();
  }
  return async () => {
    await reserved`select pg_advisory_unlock(hashtext(${key}))`.catch(() => undefined);
    reserved.release();
  };
}
