import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * A safe client for MCP servers that a customer's agent may use (a calendar, a CRM, an accounting tool).
 *
 * The server URL is typed in by staff, so it is treated as untrusted:
 *  - https only (http only if EXTERNAL_MCP_ALLOW_INSECURE=true, for local development);
 *  - no URL credentials; no redirects (a redirect could point back inside our network);
 *  - the host is resolved and EVERY address must be public. The check runs on the real connection (undici `lookup`), not just
 *    before it, so a DNS answer that changes between check and connect (rebinding) cannot reach a private address.
 *    Loopback, private, link-local (including the cloud metadata address) and carrier-grade NAT ranges are refused.
 *    EXTERNAL_MCP_ALLOW_PRIVATE=true lifts the address rule for local development only.
 * What comes back is treated as untrusted too: tool names are validated, descriptions are cleaned and capped, results are
 * truncated, and the number of tools and the size of each schema are bounded.
 */

export class ExternalMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalMcpError";
  }
}

const allowPrivate = () => process.env.EXTERNAL_MCP_ALLOW_PRIVATE === "true";
const allowInsecure = () => process.env.EXTERNAL_MCP_ALLOW_INSECURE === "true";

/* ─────────────────────────────── address rules ─────────────────────────────── */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3], // multicast and reserved
];

/** True when an IP address is not a normal public internet address. Unknown or malformed input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 can reach IPv4 private space
    return false;
  }
  return true;
}

/** Throws unless the URL is one we are willing to connect to. Does not resolve DNS (the connection does, see below). */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ExternalMcpError("That is not a valid web address.");
  }
  if (raw.length > 500) throw new ExternalMcpError("That address is too long.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowInsecure())) {
    throw new ExternalMcpError("The address must start with https://.");
  }
  if (url.username || url.password) throw new ExternalMcpError("Do not put a username or password in the address. Use the token field.");
  if (url.hash) throw new ExternalMcpError("Remove the # part of the address.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new ExternalMcpError("The address has no host.");
  if (isIP(host) && isPrivateAddress(host) && !allowPrivate()) {
    throw new ExternalMcpError("That address points inside a private network, which isn't allowed.");
  }
  if (!isIP(host) && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) && !allowPrivate()) {
    throw new ExternalMcpError("That host name points inside a private network, which isn't allowed.");
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | { address: string; family: number }[], family?: number) => void;

function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length) return callback(new Error(`No address for ${hostname}`) as NodeJS.ErrnoException);
    if (!allowPrivate()) {
      const bad = addresses.find((a) => isPrivateAddress(a.address));
      if (bad) return callback(new ExternalMcpError(`${hostname} resolves to a private address.`) as unknown as NodeJS.ErrnoException);
    }
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}

let dispatcher: Agent | null = null;
function safeDispatcher(): Agent {
  dispatcher ??= new Agent({
    connect: { lookup: guardedLookup as never },
    headersTimeout: 15_000,
    bodyTimeout: 20_000,
  });
  return dispatcher;
}

/** fetch with the address rules enforced on the actual connection, and redirects refused. */
export const safeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  undiciFetch(input as never, { ...(init as object), dispatcher: safeDispatcher(), redirect: "error" } as never) as unknown as Promise<Response>;

/* ───────────────────────────────── tool specs ───────────────────────────────── */

export type ExternalToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_TOOLS = 100;
const MAX_SCHEMA_CHARS = 8_000;

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Identifies exactly what staff reviewed. If a server later changes a tool's name, description or inputs, this changes. */
export function toolFingerprint(spec: ExternalToolSpec): string {
  return createHash("sha256").update(stableJson({ n: spec.name, d: spec.description, s: spec.inputSchema })).digest("hex").slice(0, 32);
}

/* ─────────────────────────────────── client ─────────────────────────────────── */

export type ExternalServerRef = { url: string; token?: string | null };

async function open(server: ExternalServerRef): Promise<Client> {
  const url = assertSafeUrl(server.url);
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: safeFetch as never,
    requestInit: { headers: server.token ? { authorization: `Bearer ${server.token}` } : {} },
  });
  const client = new Client({ name: "palda-cx-agent", version: "0.1.0" });
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) => setTimeout(() => reject(new ExternalMcpError("The server didn't answer in time.")), 15_000)),
  ]);
  return client;
}

function friendly(error: unknown): ExternalMcpError {
  if (error instanceof ExternalMcpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  // The SDK's HTTP errors carry the status code; it is more reliable than matching words in the body.
  const status = (error as { code?: unknown })?.code;
  if (status === 401 || status === 403) return new ExternalMcpError("The server refused the token (unauthorised).");
  if (status === 404) return new ExternalMcpError("Nothing is served at that address (not found). Check the path.");
  if (status === 429) return new ExternalMcpError("The server is rate-limiting requests. Try again shortly.");
  if (typeof status === "number" && status >= 500) return new ExternalMcpError(`The server had a problem (error ${status}). Try again later.`);
  if (/private address|private network/i.test(`${message} ${cause}`)) return new ExternalMcpError("That server is on a private network, which isn't allowed.");
  if (/<!doctype|<html|text\/html/i.test(message)) return new ExternalMcpError("That address returned a web page, not an MCP server. Check the address.");
  if (/404|not found/i.test(message) && !/ENOTFOUND/i.test(`${message} ${cause}`)) return new ExternalMcpError("Nothing is served at that address (not found). Check the path.");
  if (/401|403|unauthori[sz]ed|forbidden/i.test(message)) return new ExternalMcpError("The server refused the token (unauthorised).");
  if (/ENOTFOUND|EAI_AGAIN/i.test(`${message} ${cause}`)) return new ExternalMcpError("That host name could not be found.");
  if (/ECONNREFUSED|ECONNRESET|fetch failed|terminated/i.test(`${message} ${cause}`)) return new ExternalMcpError("Couldn't connect to the server.");
  if (/redirect/i.test(`${message} ${cause}`)) return new ExternalMcpError("The server tried to redirect, which isn't allowed. Use its final address.");
  return new ExternalMcpError(`The server returned an error: ${clean(message, 160)}`);
}

/** Connects, lists the server's tools (cleaned and bounded), and disconnects. Used by the Engine's "Sync tools". */
export async function listExternalTools(server: ExternalServerRef): Promise<ExternalToolSpec[]> {
  let client: Client | null = null;
  try {
    client = await open(server);
    const result = await client.listTools();
    const out: ExternalToolSpec[] = [];
    for (const tool of result.tools.slice(0, MAX_TOOLS)) {
      if (!TOOL_NAME.test(tool.name)) continue;
      const schema = (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} };
      if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) continue;
      out.push({ name: tool.name, description: clean(tool.description ?? tool.name, 600), inputSchema: schema });
    }
    return out;
  } catch (error) {
    throw friendly(error);
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export type ExternalCallResult = { ok: true; text: string; truncated: boolean } | { ok: false; error: string };

/** Calls one tool. Results are text only, truncated, and never throw. */
export async function callExternalTool(
  server: ExternalServerRef,
  name: string,
  args: unknown,
  options: { maxChars?: number; timeoutMs?: number } = {},
): Promise<ExternalCallResult> {
  const maxChars = options.maxChars ?? 8_000;
  let client: Client | null = null;
  try {
    client = await open(server);
    const call = client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
    const result = await Promise.race([
      call,
      new Promise<never>((_, reject) => setTimeout(() => reject(new ExternalMcpError("The tool took too long.")), options.timeoutMs ?? 20_000)),
    ]);
    const parts = Array.isArray(result.content) ? result.content : [];
    const joined = parts
      .filter((p): p is { type: "text"; text: string } => Boolean(p && typeof p === "object" && (p as { type?: string }).type === "text"))
      .map((p) => p.text)
      .join("\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    const truncated = joined.length > maxChars;
    const text = truncated ? `${joined.slice(0, maxChars)}\n[truncated]` : joined;
    if (result.isError) return { ok: false, error: clean(text || "The tool reported an error.", 300) };
    return { ok: true, text, truncated };
  } catch (error) {
    return { ok: false, error: friendly(error).message };
  } finally {
    await client?.close().catch(() => undefined);
  }
}
