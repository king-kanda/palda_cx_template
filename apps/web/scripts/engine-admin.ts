import { closeDb, loadEnv } from "@garden/db";
import { createPlatformAdmin } from "@garden/services";

loadEnv();

/**
 * Creates (or resets the password of) a Palda CX team login for the Engine.
 *   pnpm engine:admin --email you@palda.co.ke --name "Your Name" --password "a long passphrase"
 * Re-running with the same email updates the name and password and re-activates the login.
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const password = arg("password");
  const name = arg("name") ?? email ?? "";
  if (!email || !password) {
    console.error('Usage: pnpm engine:admin --email you@palda.co.ke --name "Your Name" --password "a long passphrase"');
    process.exit(1);
  }
  const admin = await createPlatformAdmin({ email, name, password });
  console.log(`\nEngine login ready\n\n  ${admin.name} <${admin.email}>\n  Sign in at /engine/login\n`);
  await closeDb();
}

main().catch(async (error) => {
  console.error("\nCould not create the Engine login:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
