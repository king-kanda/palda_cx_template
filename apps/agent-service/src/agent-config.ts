import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { applyAgentProfile, getAgentConfig, mergeAgentConfig, type AgentConfig } from "@garden/engine";
import { getSettings, healthyApps, systemPrincipal, withPrincipal } from "@garden/services";
import { INTEGRATION_TOOL_APPS } from "@garden/mcp-server";

/**
 * Resolves the tenant's production agent pointer to an immutable version, then applies the business's agent
 * profile (name, voice, vertical instructions, team notes) set up in the Engine.
 * Missing rows fall back to the shipped base config, so a fresh tenant still has a working agent on day one.
 */
export async function loadAgentConfig(tenantId: string, agentId: string): Promise<AgentConfig> {
  const { config: resolved, enabledIntegrationTools } = await resolveVersion(tenantId, agentId);
  await blockIntegrationTools(tenantId, resolved, enabledIntegrationTools);
  if (resolved.id !== "wambo") return resolved;
  try {
    const settings = await withPrincipal(systemPrincipal(tenantId, "agent-config"), (ctx) => getSettings(ctx));
    return applyAgentProfile(resolved, {
      agentName: settings.agentName,
      businessName: settings.tenant.name,
      tone: settings.agentTone,
      verticalInstructions: settings.preset.agent.personaExtras,
      notes: settings.agentNotes,
      intro: settings.agentIntro,
    });
  } catch {
    // A settings problem must never stop customers getting an answer; the base persona still works.
    return resolved;
  }
}

/**
 * Tools for connected apps (Google, Zoho, Odoo) are OFF by default: one is offered only when the Palda team switched it on for
 * this business AND the business has that app connected and working. Everything else is added to the blocked list, which the
 * engine enforces by exact name.
 */
async function blockIntegrationTools(tenantId: string, config: AgentConfig, enabled: string[]): Promise<void> {
  let healthy = new Set<string>();
  try {
    healthy = await healthyApps(tenantId);
  } catch (error) {
    // Can't tell which apps work: offer none of their tools, but keep the agent answering.
    console.error("[agent-config] could not read app connections", error instanceof Error ? error.message : error);
  }
  const on = new Set(enabled);
  const blocked = new Set(config.toolPolicy.blockedTools ?? []);
  for (const [tool, app] of INTEGRATION_TOOL_APPS) {
    if (!on.has(tool) || !healthy.has(app)) blocked.add(tool);
  }
  config.toolPolicy = { ...config.toolPolicy, blockedTools: [...blocked] };
}

async function resolveVersion(tenantId: string, agentId: string): Promise<{ config: AgentConfig; enabledIntegrationTools: string[] }> {
  const base = getAgentConfig(agentId);
  const db = getDb();
  // The shipped config is shared; never mutate it.
  const shipped = () => ({ config: mergeAgentConfig(base, {}), enabledIntegrationTools: [] as string[] });

  const pointer = await db.query.agentPointers.findFirst({
    where: and(
      eq(schema.agentPointers.tenantId, tenantId),
      eq(schema.agentPointers.agentId, agentId),
      eq(schema.agentPointers.environment, "production"),
    ),
  });
  if (!pointer) return shipped();

  const version = await db.query.agentVersions.findFirst({
    where: eq(schema.agentVersions.id, pointer.versionId),
  });
  if (!version) return shipped();

  const override = version.config as Partial<AgentConfig> & { toolPolicy?: { enabledIntegrationTools?: string[] } };
  const merged = mergeAgentConfig(base, {
    ...override,
    version: version.version,
  });
  // A per-customer override can only ADD restrictions. The shipped safety blocks and any shipped allow-list can never be removed by it.
  const blocked = new Set([...(base.toolPolicy.blockedTools ?? []), ...(override.toolPolicy?.blockedTools ?? [])]);
  merged.toolPolicy = {
    ...merged.toolPolicy,
    blockedTools: [...blocked],
    allowedTools: base.toolPolicy.allowedTools,
    maxToolCalls: Math.min(base.toolPolicy.maxToolCalls ?? 6, override.toolPolicy?.maxToolCalls ?? 12),
  };
  const enabled = Array.isArray(override.toolPolicy?.enabledIntegrationTools) ? override.toolPolicy.enabledIntegrationTools.map(String) : [];
  return { config: merged, enabledIntegrationTools: enabled };
}
