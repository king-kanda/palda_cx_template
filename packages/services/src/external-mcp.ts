import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant, type ExternalToolRow } from "@garden/db";
import {
  ExternalMcpError,
  assertSafeUrl,
  decryptJson,
  encryptJson,
  listExternalTools,
  toolFingerprint,
} from "@garden/integrations";
import { CUSTOM_PROVIDER_ID, INTEGRATION_PROVIDERS, integrationDisplay, isKnownProvider } from "./integrations-catalog";
import { NotFoundError, ValidationError } from "./types";

/**
 * External MCP servers for ONE customer's agent, set up by the Palda team in the Engine.
 *
 * Nothing an outside server offers is usable until staff look at it and switch the tool on. A tool is bound to a fingerprint of
 * exactly what they reviewed (name, description, inputs); if the server later changes it, a sync switches it off again and marks
 * it "changed" so it must be reviewed again. This is the defence against a server quietly rewriting a tool's description to
 * steer the agent. The token is encrypted at rest and never leaves this module.
 */

/**
 * Who is acting: always a Palda admin (the Engine). Customers never connect, change or even see the technical side of an
 * integration; the Palda team connects each customer's apps for them. What a customer sees is `getCustomerIntegrations`.
 */
export type McpActor = string;
const actorLabel = (by: McpActor) => `engine:${by}`;

async function audit(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  by: McpActor,
  tenantId: string,
  action: string,
  entityId: string,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({ tenantId, actor: actorLabel(by), action, entity: "mcp_server", entityId, diff: diff ?? null });
}

async function requireTenant(tenantId: string) {
  const { getDb } = await import("@garden/db");
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
  if (!tenant) throw new NotFoundError("Customer", tenantId);
}

export type ExternalServerInfo = {
  id: string;
  name: string;
  url: string;
  host: string;
  hasToken: boolean;
  agents: string[];
  status: string;
  /** Which app this is (catalog id, or "custom"). */
  provider: string;
  /** The friendly name: the app's catalog name, or the label given to a custom one. */
  displayName: string;
  category: string;
  tools: ExternalToolRow[];
  enabledCount: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
};

const NAME = /^[a-z][a-z0-9]{1,15}$/;

function present(row: typeof schema.tenantMcpServers.$inferSelect): ExternalServerInfo {
  let host = "";
  try {
    host = new URL(row.url).host;
  } catch {
    /* keep empty */
  }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    host,
    hasToken: Boolean(row.secretEnc),
    agents: row.agents,
    status: row.status,
    provider: row.provider,
    displayName: integrationDisplay(row.provider, row.label).name,
    category: integrationDisplay(row.provider, row.label).category,
    tools: row.tools,
    enabledCount: row.tools.filter((t) => t.enabled).length,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
  };
}

function tokenOf(row: { secretEnc: string | null }): string | null {
  if (!row.secretEnc) return null;
  try {
    return decryptJson<{ token: string }>(row.secretEnc).token || null;
  } catch {
    return null;
  }
}

export async function listExternalServers(tenantId: string): Promise<ExternalServerInfo[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.query.tenantMcpServers.findMany({
      where: eq(schema.tenantMcpServers.tenantId, tenantId),
      orderBy: asc(schema.tenantMcpServers.createdAt),
    });
    return rows.map(present);
  });
}

async function getRow(tenantId: string, serverId: string) {
  const row = await withTenant(tenantId, (tx) =>
    tx.query.tenantMcpServers.findFirst({
      where: and(eq(schema.tenantMcpServers.tenantId, tenantId), eq(schema.tenantMcpServers.id, serverId)),
    }),
  );
  if (!row) throw new NotFoundError("MCP server", serverId);
  return row;
}

/** Merges a fresh tool list into what staff already approved: unchanged approved tools stay on, changed ones switch off. */
export function mergeTools(existing: ExternalToolRow[], fresh: { name: string; description: string; inputSchema: Record<string, unknown> }[]): ExternalToolRow[] {
  const before = new Map(existing.map((t) => [t.name, t]));
  return fresh.map((spec) => {
    const fingerprint = toolFingerprint(spec);
    const prior = before.get(spec.name);
    if (!prior) return { ...spec, fingerprint, enabled: false };
    if (prior.fingerprint === fingerprint) return { ...spec, fingerprint, enabled: prior.enabled };
    return { ...spec, fingerprint, enabled: false, changed: prior.enabled || prior.changed ? true : undefined };
  });
}

/** Adds a server, then connects once to prove it works and to read its tools. Every tool starts switched off. */
export async function addExternalServer(
  by: McpActor,
  tenantId: string,
  input: { provider?: string; label?: string; name?: string; url: string; token?: string },
): Promise<{ id: string; toolCount: number }> {
  const provider = (input.provider ?? CUSTOM_PROVIDER_ID).trim();
  if (!isKnownProvider(provider)) throw new ValidationError("Choose one of the listed apps, or Other.");
  const label = (input.label ?? "").trim();
  if (provider === CUSTOM_PROVIDER_ID && (label.length < 2 || label.length > 40)) {
    throw new ValidationError("Give the app a name the customer will recognise (2 to 40 characters).");
  }
  // The short name labels the tools. It defaults from the app, so staff rarely type it.
  const suggested = INTEGRATION_PROVIDERS.find((p) => p.id === provider)?.defaultName ?? "";
  const name = (input.name?.trim() || suggested).toLowerCase();
  if (!NAME.test(name)) throw new ValidationError("The short name must be 2 to 16 lowercase letters or digits, starting with a letter (e.g. calendar).");
  let url: string;
  try {
    url = assertSafeUrl(input.url).toString();
  } catch (error) {
    throw new ValidationError(error instanceof ExternalMcpError ? error.message : "That address can't be used.");
  }
  const token = (input.token ?? "").trim();
  if (token.length > 2000) throw new ValidationError("That token is too long.");
  await requireTenant(tenantId);

  // Prove it before saving anything.
  let specs: Awaited<ReturnType<typeof listExternalTools>>;
  try {
    specs = await listExternalTools({ url, token: token || null });
  } catch (error) {
    throw new ValidationError(error instanceof ExternalMcpError ? error.message : "Couldn't read that server's tools.");
  }
  if (specs.length === 0) throw new ValidationError("Connected, but the server offers no usable tools.");

  return withTenant(tenantId, async (tx) => {
    const clash = await tx.query.tenantMcpServers.findFirst({
      where: and(eq(schema.tenantMcpServers.tenantId, tenantId), eq(schema.tenantMcpServers.name, name)),
    });
    if (clash) throw new ValidationError(`This customer already has a connection called "${name}". Use a different short name.`);
    const [row] = await tx
      .insert(schema.tenantMcpServers)
      .values({
        tenantId,
        name,
        provider,
        label: provider === CUSTOM_PROVIDER_ID ? label : null,
        url,
        secretEnc: token ? encryptJson({ token }) : null,
        tools: mergeTools([], specs),
        lastSyncedAt: new Date(),
        createdBy: actorLabel(by),
      })
      .returning();
    await audit(tx, by, tenantId, "engine.mcp_added", row!.id, { name, host: new URL(url).host, tools: specs.length });
    return { id: row!.id, toolCount: specs.length };
  });
}

/** Re-reads the server's tools. Approved tools that changed are switched off and flagged; the rest keep their state. */
export async function syncExternalServer(by: McpActor, tenantId: string, serverId: string) {
  const row = await getRow(tenantId, serverId);
  try {
    const specs = await listExternalTools({ url: row.url, token: tokenOf(row) });
    const tools = mergeTools(row.tools, specs);
    const changed = tools.filter((t) => t.changed).map((t) => t.name);
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(schema.tenantMcpServers)
        .set({ tools, lastSyncedAt: new Date(), lastError: null })
        .where(eq(schema.tenantMcpServers.id, serverId));
      await audit(tx, by, tenantId, "engine.mcp_synced", serverId, { tools: tools.length, switchedOff: changed });
    });
    return { toolCount: tools.length, changed };
  } catch (error) {
    const message = error instanceof ExternalMcpError ? error.message : "Couldn't read that server's tools.";
    await withTenant(tenantId, (tx) =>
      tx.update(schema.tenantMcpServers).set({ lastError: message }).where(eq(schema.tenantMcpServers.id, serverId)),
    );
    throw new ValidationError(message);
  }
}

/** Switches exactly these tools on (everything else off). Binds each to the fingerprint staff just reviewed. */
export async function setExternalToolsEnabled(by: McpActor, tenantId: string, serverId: string, enabled: string[]) {
  const row = await getRow(tenantId, serverId);
  const want = new Set(enabled);
  const tools = row.tools.map((t) => ({ ...t, enabled: want.has(t.name), changed: want.has(t.name) ? undefined : t.changed }));
  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.tenantMcpServers).set({ tools }).where(eq(schema.tenantMcpServers.id, serverId));
    await audit(tx, by, tenantId, "engine.mcp_tools_set", serverId, { enabled: tools.filter((t) => t.enabled).map((t) => t.name) });
  });
  return { enabled: tools.filter((t) => t.enabled).length };
}

export async function setExternalServerStatus(by: McpActor, tenantId: string, serverId: string, status: "active" | "disabled") {
  await getRow(tenantId, serverId);
  await withTenant(tenantId, async (tx) => {
    await tx.update(schema.tenantMcpServers).set({ status }).where(eq(schema.tenantMcpServers.id, serverId));
    await audit(tx, by, tenantId, "engine.mcp_status", serverId, { status });
  });
}

export async function deleteExternalServer(by: McpActor, tenantId: string, serverId: string) {
  const row = await getRow(tenantId, serverId);
  await withTenant(tenantId, async (tx) => {
    await tx.delete(schema.tenantMcpServers).where(and(eq(schema.tenantMcpServers.tenantId, tenantId), eq(schema.tenantMcpServers.id, serverId)));
    await audit(tx, by, tenantId, "engine.mcp_removed", serverId, { name: row.name });
  });
}

export type LoadedExternalTool = {
  serverId: string;
  serverName: string;
  url: string;
  token: string | null;
  tool: ExternalToolRow;
};

/** What the agent may use right now: active servers that include this agent, and only tools staff switched on. */
export async function loadEnabledExternalTools(tenantId: string, agentId: string): Promise<LoadedExternalTool[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.query.tenantMcpServers.findMany({
      where: and(eq(schema.tenantMcpServers.tenantId, tenantId), eq(schema.tenantMcpServers.status, "active")),
      orderBy: asc(schema.tenantMcpServers.createdAt),
    }),
  );
  const out: LoadedExternalTool[] = [];
  for (const row of rows) {
    if (!row.agents.includes(agentId)) continue;
    const token = tokenOf(row);
    for (const tool of row.tools) {
      if (tool.enabled && !tool.changed) out.push({ serverId: row.id, serverName: row.name, url: row.url, token, tool });
    }
  }
  return out;
}

/* ───────────────────────────── What the customer sees ───────────────────────────── */

export type CustomerIntegration = {
  id: string;
  name: string;
  category: string;
  summary: string;
  /** "connected" (working), "paused" (switched off by the Palda team), or "attention" (the last check failed). */
  status: "connected" | "paused" | "attention";
  /** How many things the assistant is currently allowed to do with this app. Never tool names. */
  capabilities: number;
  lastCheckedAt: Date | null;
};

/**
 * The customer's read-only view of their connected apps. It deliberately carries no address, token, tool names or raw error
 * text: those are technical, and an error message could reveal the address of the server behind it.
 */
export async function getCustomerIntegrations(tenantId: string): Promise<CustomerIntegration[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.query.tenantMcpServers.findMany({
      where: eq(schema.tenantMcpServers.tenantId, tenantId),
      orderBy: asc(schema.tenantMcpServers.createdAt),
    }),
  );
  return rows.map((row) => {
    const display = integrationDisplay(row.provider, row.label);
    return {
      id: row.id,
      name: display.name,
      category: display.category,
      summary: display.summary,
      status: row.status !== "active" ? "paused" : row.lastError ? "attention" : "connected",
      capabilities: row.tools.filter((t) => t.enabled && !t.changed).length,
      lastCheckedAt: row.lastSyncedAt,
    };
  });
}
