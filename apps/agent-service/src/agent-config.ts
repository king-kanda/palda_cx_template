import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { applyAgentProfile, getAgentConfig, mergeAgentConfig, type AgentConfig } from "@garden/engine";
import { getSettings, systemPrincipal, withPrincipal } from "@garden/services";

/**
 * Resolves the tenant's production agent pointer to an immutable version, then applies the business's agent
 * profile (name, voice, vertical instructions, team notes) set up in the Engine.
 * Missing rows fall back to the shipped base config, so a fresh tenant still has a working agent on day one.
 */
export async function loadAgentConfig(tenantId: string, agentId: string): Promise<AgentConfig> {
  const resolved = await resolveVersion(tenantId, agentId);
  if (resolved.id !== "wambo") return resolved;
  try {
    const settings = await withPrincipal(systemPrincipal(tenantId, "agent-config"), (ctx) => getSettings(ctx));
    return applyAgentProfile(resolved, {
      agentName: settings.agentName,
      businessName: settings.tenant.name,
      tone: settings.agentTone,
      verticalInstructions: settings.preset.agent.personaExtras,
      notes: settings.agentNotes,
    });
  } catch {
    // A settings problem must never stop customers getting an answer; the base persona still works.
    return resolved;
  }
}

async function resolveVersion(tenantId: string, agentId: string): Promise<AgentConfig> {
  const base = getAgentConfig(agentId);
  const db = getDb();

  const pointer = await db.query.agentPointers.findFirst({
    where: and(
      eq(schema.agentPointers.tenantId, tenantId),
      eq(schema.agentPointers.agentId, agentId),
      eq(schema.agentPointers.environment, "production"),
    ),
  });
  if (!pointer) return base;

  const version = await db.query.agentVersions.findFirst({
    where: eq(schema.agentVersions.id, pointer.versionId),
  });
  if (!version) return base;

  const override = version.config as Partial<AgentConfig>;
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
  return merged;
}
