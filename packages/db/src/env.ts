import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

/**
 * Loads the repo-root `.env` no matter which workspace package a command runs
 * from (pnpm runs package scripts with the package directory as cwd).
 * Returns the path it loaded, or null when no `.env` exists.
 */
export function loadEnv(startDir = process.cwd()): string | null {
  let dir = resolve(/* turbopackIgnore: true */ startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(/* turbopackIgnore: true */ candidate)) {
      config({ path: candidate });
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
