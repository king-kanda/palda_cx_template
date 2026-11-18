import { serve } from "@hono/node-server";
import { startPlatformSettingsSync } from "@garden/services";
import { app } from "./app";

const port = Number(process.env.AGENT_SERVICE_PORT ?? process.env.PORT ?? 3100);

// Meta / WhatsApp settings saved in the Engine (falls back to .env), loaded before taking traffic and refreshed every 30 seconds.
void startPlatformSettingsSync().finally(() => {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[agent-service] listening on http://localhost:${info.port}`);
  });
});
