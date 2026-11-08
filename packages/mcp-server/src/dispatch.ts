import { and, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import * as svc from "@garden/services";
import type { Principal, ServiceContext } from "@garden/services";
import { TOOL_MAP, TOOLS, type AnyToolDef, type ToolTier } from "./tools";

export type ToolCallOutcome = {
  ok: boolean;
  tool: string;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
  /** True when the call produced an approval instead of executing. */
  pendingApproval?: { approvalId: string; kind: string };
};

const OWNER_ONLY_TOOLS = new Set(["payments.refund", "bookings.apply_discount"]);
const OWNER_APPROVAL_KINDS = new Set(["refund", "discount", "override_price"]);

function scopesAllow(principal: Principal, tool: AnyToolDef): boolean {
  if (principal.scopes.includes("*")) return true;
  return tool.scopes.some((scope) => principal.scopes.includes(scope));
}

function principalAllowed(principal: Principal, tool: AnyToolDef): boolean {
  return tool.principalTypes.includes(principal.type);
}

/** Tools a principal may see / call, filtered by principal type and scopes. */
export function visibleTools(principal: Principal): AnyToolDef[] {
  return TOOLS.filter((tool) => principalAllowed(principal, tool) && scopesAllow(principal, tool));
}

export function isSensitiveFor(tool: AnyToolDef, principal: Principal): boolean {
  if (tool.tier !== "write-sensitive") return false;
  if (principal.type !== "staff") return true;
  return principal.role !== "owner" && OWNER_ONLY_TOOLS.has(tool.name);
}

function approvalKindFor(tool: AnyToolDef, args: Record<string, unknown>): svc.ApprovalKind {
  switch (tool.name) {
    case "payments.refund":
      return "refund";
    case "bookings.apply_discount":
      return "discount";
    case "messages.send":
      return "bulk_send";
    default:
      return typeof args.kind === "string" ? (args.kind as svc.ApprovalKind) : "other";
  }
}

function parseArgs(tool: AnyToolDef, raw: unknown): Record<string, unknown> {
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new svc.ValidationError(
      `Invalid arguments for ${tool.name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`)
        .join("; ")}`,
      parsed.error.flatten(),
    );
  }
  return parsed.data as Record<string, unknown>;
}

async function readIdempotent(
  ctx: ServiceContext,
  tool: string,
  key: string,
): Promise<unknown | undefined> {
  const row = await ctx.db.query.idempotencyKeys.findFirst({
    where: and(
      eq(schema.idempotencyKeys.tenantId, ctx.tenantId),
      eq(schema.idempotencyKeys.key, key),
      eq(schema.idempotencyKeys.tool, tool),
    ),
  });
  if (!row) return undefined;
  return (row.result as Record<string, unknown>).result;
}

async function writeIdempotent(
  ctx: ServiceContext,
  tool: string,
  key: string,
  result: unknown,
): Promise<void> {
  await ctx.db
    .insert(schema.idempotencyKeys)
    .values({
      tenantId: ctx.tenantId,
      key,
      tool,
      result: { result: result ?? null } as Record<string, unknown>,
    })
    .onConflictDoNothing();
}

/** Runs a tool with no tier gating (used after an approval). */
async function runTool(
  principal: Principal,
  tool: AnyToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  return svc.withPrincipal(principal, async (ctx) => {
    const idempotencyKey =
      typeof args.idempotencyKey === "string" && args.idempotencyKey.length >= 6
        ? args.idempotencyKey
        : null;
    if (idempotencyKey) {
      const cached = await readIdempotent(ctx, tool.name, idempotencyKey);
      if (cached !== undefined) return cached;
    }
    const result = await tool.handler(ctx, args);
    if (idempotencyKey) await writeIdempotent(ctx, tool.name, idempotencyKey, result);
    return result;
  });
}

/**
 * Central MCP tool dispatcher.
 *
 * - principal type + scope gating
 * - strict Zod argument parsing
 * - customer/system sensitive writes become approvals, never executions
 * - approvals.decide runs the approved tool exactly once
 * - generic idempotency for write tools that accept `idempotencyKey`
 */
export async function callTool(
  principal: Principal,
  name: string,
  rawArgs: unknown,
): Promise<ToolCallOutcome> {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return {
      ok: false,
      tool: name,
      error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` },
    };
  }

  try {
    if (!principalAllowed(principal, tool)) {
      throw new svc.ForbiddenError(
        `Tool ${name} is not available to ${principal.type} principals.`,
      );
    }
    if (!scopesAllow(principal, tool)) {
      throw new svc.ForbiddenError(
        `Missing scope for ${name}. Required one of: ${tool.scopes.join(", ")}`,
      );
    }
    const args = parseArgs(tool, rawArgs);

    // Only an owner may approve money-moving / pricing exceptions.
    if (tool.name === "approvals.decide" && principal.type === "staff" && principal.role !== "owner") {
      const approval = await svc.withPrincipal(principal, (ctx) =>
        svc.getApproval(ctx, String(args.approvalId)),
      );
      if (OWNER_APPROVAL_KINDS.has(approval.kind)) {
        throw new svc.ForbiddenError(
          `Only an owner can decide a ${approval.kind} approval.`,
        );
      }
    }

    if (isSensitiveFor(tool, principal)) {
      const kind = approvalKindFor(tool, args);
      const approval = await svc.withPrincipal(principal, (ctx) =>
        svc.requestApproval(ctx, {
          kind,
          payload: {
            tool: tool.name,
            args,
            reason:
              principal.type === "customer"
                ? "Customer requested a sensitive action"
                : principal.type === "system"
                  ? "Agent requested a sensitive action"
                  : "Staff member requested an owner-only action",
          },
          expiresInHours: 24,
        }),
      );
      return {
        ok: true,
        tool: name,
        pendingApproval: { approvalId: approval.id, kind },
        result: {
          status: "pending_approval",
          approvalId: approval.id,
          kind,
          // Echo the parsed request back so the agent can restate the exact
          // figures without inventing them (the guard checks tool output).
          requested: args,
          message:
            "This action needs a human owner to approve it. It has been added to the approvals queue and nothing has been changed yet.",
        },
      };
    }

    const result = await runTool(principal, tool, args);

    // approvals.decide returns a pendingTool for tool-backed approvals.
    if (tool.name === "approvals.decide") {
      const execution = (result as { execution?: svc.ApprovalExecution }).execution;
      if (execution && !execution.executed && execution.pendingTool) {
        const innerTool = TOOL_MAP.get(execution.pendingTool.tool);
        if (!innerTool) {
          throw new svc.NotFoundError("Tool", execution.pendingTool.tool);
        }
        // The approver executes the action regardless of the original
        // requester's principal type — sensitive actions were gated above.
        const innerResult = await runTool(principal, innerTool, execution.pendingTool.args);
        await svc.withPrincipal(principal, (ctx) =>
          svc.markApprovalExecuted(ctx, String(args.approvalId), innerResult),
        );
        return {
          ok: true,
          tool: name,
          result: {
            ...(result as Record<string, unknown>),
            execution: { executed: true, result: innerResult },
          },
        };
      }
    }

    return { ok: true, tool: name, result };
  } catch (error) {
    if (error instanceof svc.ServiceError) {
      return {
        ok: false,
        tool: name,
        error: { code: error.code, message: error.message, details: error.details },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, tool: name, error: { code: "INTERNAL", message } };
  }
}

export type ToolDescriptor = {
  name: string;
  group: string;
  description: string;
  tier: ToolTier;
  input: AnyToolDef["input"];
};

export function describeTools(principal: Principal): ToolDescriptor[] {
  return visibleTools(principal).map((tool) => ({
    name: tool.name,
    group: tool.group,
    description: tool.description,
    tier: tool.tier,
    input: tool.input,
  }));
}
