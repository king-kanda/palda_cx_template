/**
 * Runs once when the Next.js server starts. Loads the Meta / WhatsApp settings saved in the Engine (Settings) into this
 * process and keeps them fresh every 30 seconds, so a change made in the browser reaches the web app without a restart.
 * Node runtime only: the settings need the database.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startPlatformSettingsSync } = await import("@garden/services");
    await startPlatformSettingsSync();
  } catch (error) {
    console.error("[web] platform settings sync did not start; using .env only", error instanceof Error ? error.message : error);
  }
}
