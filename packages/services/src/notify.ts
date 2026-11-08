import { and, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import {
  sendTemplate,
  sendText,
  whatsappMode,
  type SendResult,
} from "@garden/integrations";
import type { ServiceContext } from "./context";
import type { Customer } from "@garden/db";

export type TemplateVars = Record<string, string | number | null | undefined>;

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value == null ? match : String(value);
  });
}

/** Placeholder values in the order they appear — matches WhatsApp template variables. */
export function templateParams(body: string, vars: TemplateVars): string[] {
  const params: string[] = [];
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const key = match[1]!;
    params.push(vars[key] == null ? "" : String(vars[key]));
  }
  return params;
}

export function baseVars(businessName: string, customer?: { name: string } | null): TemplateVars {
  return {
    business_name: businessName,
    customer_name: customer?.name ?? "there",
  };
}

async function logSend(
  ctx: ServiceContext,
  customer: Customer,
  text: string,
  result: SendResult | null,
  error?: string,
): Promise<void> {
  await ctx.db.insert(schema.integrationsLog).values({
    tenantId: ctx.tenantId,
    kind: "whatsapp",
    direction: "outbound",
    request: { to: customer.phoneE164, body: text },
    response: result ? { waMessageId: result.waMessageId, mocked: result.mocked } : null,
    ok: !error,
    error: error ?? null,
  });
}

/**
 * Sends a proactive message. In production this must be an approved template
 * (24-hour window); in mock mode it is stored locally. Template variable order
 * follows the placeholders in `body`.
 */
export async function sendProactive(
  ctx: ServiceContext,
  input: {
    customer: Customer;
    templateName: string;
    body: string;
    vars: TemplateVars;
    language?: string;
  },
): Promise<{ sent: boolean; mocked: boolean; body: string }> {
  const text = renderTemplate(input.body, input.vars);
  try {
    const result =
      whatsappMode() === "cloud"
        ? await sendTemplate(
            input.customer.phoneE164,
            input.templateName,
            templateParams(input.body, input.vars),
            input.language === "sw" ? "sw" : "en",
          )
        : await sendText(input.customer.phoneE164, text);
    await logSend(ctx, input.customer, text, result);
    return { sent: true, mocked: result.mocked, body: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSend(ctx, input.customer, text, null, message);
    return { sent: false, mocked: false, body: text };
  }
}

export async function sendFreeform(
  ctx: ServiceContext,
  customer: Customer,
  text: string,
): Promise<{ sent: boolean; mocked: boolean }> {
  try {
    const result = await sendText(customer.phoneE164, text);
    await logSend(ctx, customer, text, result);
    return { sent: true, mocked: result.mocked };
  } catch (error) {
    await logSend(ctx, customer, text, null, error instanceof Error ? error.message : String(error));
    return { sent: false, mocked: false };
  }
}

/** Staff-facing alert (new handoff, daily digest). Web chat is v1's staff channel. */
export async function sendStaffAlert(
  ctx: ServiceContext,
  text: string,
  phone?: string | null,
): Promise<{ sent: boolean }> {
  await ctx.db.insert(schema.integrationsLog).values({
    tenantId: ctx.tenantId,
    kind: "staff_alert",
    direction: "outbound",
    request: { phone: phone ?? null, body: text },
    response: { channel: phone ? "whatsapp" : "in_app" },
    ok: true,
  });
  if (phone && whatsappMode() === "cloud") {
    try {
      await sendText(phone, text);
      return { sent: true };
    } catch {
      return { sent: false };
    }
  }
  return { sent: true };
}
