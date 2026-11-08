import { handleMcpRequest } from "@garden/mcp-server";

export const dynamic = "force-dynamic";

/**
 * Per-tenant MCP endpoint (streamable HTTP). The bearer token carries the tenant
 * and principal; the dispatcher re-checks scopes and converts sensitive writes
 * from customer/system principals into approvals.
 */
export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
