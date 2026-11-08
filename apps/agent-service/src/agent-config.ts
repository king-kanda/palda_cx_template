import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { getAgentConfig, mergeAgentConfig, type AgentConfig } from "@garden/engine";

/**
 * Resolves the tenant's production agent pointer to an immutable version.
 * Missing rows fall back to the shipped base config, so a fresh tenant still
 * has a working agent on day one.
 */
export async function loadAgentConfig(tenantId: string, agentId: string): Promise<AgentConfig> {
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
  return mergeAgentConfig(base, {
    ...override,
    version: version.version,
  });
}
