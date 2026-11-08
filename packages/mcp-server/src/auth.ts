import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import {
  CUSTOMER_SCOPES,
  normalisePhone,
  ServiceError,
  type Principal,
} from "@garden/services";

export type McpTokenClaims = {
  tid: string;
  pt: "customer" | "staff" | "system";
  pid?: string;
  phone?: string;
  role?: "owner" | "staff";
  scopes: string[];
  label?: string;
};

function secret(): Uint8Array {
  const value = process.env.MCP_TOKEN_SECRET ?? "dev-mcp-secret-change-me";
  return new TextEncoder().encode(value);
}

export async function signMcpToken(claims: McpTokenClaims, expiresIn = "365d"): Promise<string> {
  return new SignJWT({
    tid: claims.tid,
    pt: claims.pt,
    pid: claims.pid,
    phone: claims.phone,
    role: claims.role,
    scopes: claims.scopes,
    label: claims.label,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("garden-booking-app")
    .setAudience("garden-agent-engine")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

export async function verifyMcpToken(token: string): Promise<McpTokenClaims> {
  const { payload } = await jwtVerify(token, secret(), {
    issuer: "garden-booking-app",
    audience: "garden-agent-engine",
  });
  const tid = payload.tid;
  const pt = payload.pt;
  if (typeof tid !== "string" || (pt !== "customer" && pt !== "staff" && pt !== "system")) {
    throw new ServiceError("UNAUTHORIZED", "Invalid MCP token claims.", 401);
  }
  return {
    tid,
    pt,
    pid: typeof payload.pid === "string" ? payload.pid : undefined,
    phone: typeof payload.phone === "string" ? payload.phone : undefined,
    role: payload.role === "owner" || payload.role === "staff" ? payload.role : undefined,
    scopes: Array.isArray(payload.scopes) ? (payload.scopes as string[]) : [],
    label: typeof payload.label === "string" ? payload.label : undefined,
  };
}

/**
 * Builds the principal *from the database*, not only the token, so revoked
 * staff or deleted customers cannot keep acting with an old token.
 */
export async function principalFromClaims(claims: McpTokenClaims): Promise<Principal> {
  const db = getDb();
  const tenant = await db.query.tenants.findFirst({
    where: and(eq(schema.tenants.id, claims.tid), eq(schema.tenants.status, "active")),
  });
  if (!tenant) throw new ServiceError("UNAUTHORIZED", "Unknown or inactive tenant.", 401);

  if (claims.pt === "staff") {
    if (!claims.pid) throw new ServiceError("UNAUTHORIZED", "Staff token missing user id.", 401);
    const user = await withTenant(claims.tid, (tx) =>
      tx.query.users.findFirst({
        where: and(
          eq(schema.users.id, claims.pid!),
          eq(schema.users.tenantId, claims.tid),
          eq(schema.users.active, true),
        ),
      }),
    );
    if (!user) throw new ServiceError("UNAUTHORIZED", "Staff user is inactive.", 401);
    return {
      type: "staff",
      tenantId: claims.tid,
      userId: user.id,
      role: user.role === "owner" ? "owner" : "staff",
      scopes: claims.scopes.length ? claims.scopes : ["*"],
    };
  }

  if (claims.pt === "customer") {
    if (!claims.pid) throw new ServiceError("UNAUTHORIZED", "Customer token missing customer id.", 401);
    const customer = await withTenant(claims.tid, (tx) =>
      tx.query.customers.findFirst({
        where: and(
          eq(schema.customers.id, claims.pid!),
          eq(schema.customers.tenantId, claims.tid),
        ),
      }),
    );
    if (!customer) throw new ServiceError("UNAUTHORIZED", "Unknown customer.", 401);
    return {
      type: "customer",
      tenantId: claims.tid,
      customerId: customer.id,
      phoneE164: normalisePhone(customer.phoneE164),
      scopes: claims.scopes.length ? claims.scopes : [...CUSTOMER_SCOPES],
    };
  }

  return {
    type: "system",
    tenantId: claims.tid,
    scopes: claims.scopes.length ? claims.scopes : ["*"],
    label: claims.label ?? "agent",
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

export async function authenticateRequest(request: Request): Promise<Principal> {
  const token = bearerToken(request);
  if (!token) throw new ServiceError("UNAUTHORIZED", "Missing MCP bearer token.", 401);
  const claims = await verifyMcpToken(token);
  return principalFromClaims(claims);
}
