import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.AGENT_SERVICE_PORT ?? process.env.PORT ?? 3100);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent-service] listening on http://localhost:${info.port}`);
});
