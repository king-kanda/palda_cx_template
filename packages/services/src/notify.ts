import { and, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import {
  WhatsAppError,
  sendTemplate,
  sendTemplateWithButtons,
  sendText,
  whatsappMode,
  type SendResult,
  type TemplateButton,
  type WhatsAppCreds,
} from "@garden/integrations";
import type { ServiceContext } from "./context";
import { getWhatsappCreds } from "./whatsapp-connect";
import type { Customer } from "@garden/db";

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * The WhatsApp credentials for the business sending this message. Each business sends from its OWN number with its OWN token; a
 * business with no connected number fails here, and never borrows another business's. (Mock mode needs none.)
 */
async function credsFor(ctx: ServiceContext): Promise<WhatsAppCreds | null> {
  if (whatsappMode() !== "cloud") return null;
  const creds = await getWhatsappCreds(ctx.tenantId);
  if (!creds) throw new WhatsAppError("WhatsApp isn't connected for this business.");
  return creds;
}

export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = vars[key];
    return value == null ? match : String(value);
  });
}

/**
 * Removes the `{{review_link}}` placeholder (and the ": " or dash before it) from a template.
 * Used when a business has not configured a review link, so customers never get a blank or foreign link.
 */
export function stripReviewLink(template: string): string {
  return template.replace(/\s*[:–—-]?\s*\{\{\s*review_link\s*\}\}/g, "");
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
    const creds = await credsFor(ctx);
    const result =
      whatsappMode() === "cloud"
        ? await sendTemplate(
            input.customer.phoneE164,
            input.templateName,
            templateParams(input.body, input.vars),
            input.language === "sw" ? "sw" : "en",
            creds,
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

/**
 * Sends an approved template that has buttons (for example "Pay with M-Pesa" and "Pay online"). In mock mode, and when WhatsApp
 * refuses the template (not approved yet), `fallbackText` is sent as an ordinary message instead, which works while the
 * customer's 24-hour window is open. `sent: false` means neither went out.
 */
export async function sendProactiveButtons(
  ctx: ServiceContext,
  input: {
    customer: Customer;
    templateName: string;
    /** Body text with numbered {{1}}.. placeholders, exactly as submitted to Meta. */
    body: string;
    params: string[];
    buttons: TemplateButton[];
    fallbackText: string;
    language?: string;
  },
): Promise<{ sent: boolean; mocked: boolean; usedTemplate: boolean; error?: string }> {
  const rendered = input.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => input.params[Number(n) - 1] ?? "");
  try {
    if (whatsappMode() === "cloud") {
      const creds = await credsFor(ctx);
      try {
        const result = await sendTemplateWithButtons(
          input.customer.phoneE164,
          input.templateName,
          input.params,
          input.buttons,
          input.language === "sw" ? "sw" : "en",
          creds,
        );
        await logSend(ctx, input.customer, rendered, result);
        return { sent: true, mocked: result.mocked, usedTemplate: true };
      } catch (templateError) {
        // Not approved yet (or the customer's window is the only way in): fall back to plain text.
        const result = await sendText(input.customer.phoneE164, input.fallbackText, creds);
        await logSend(ctx, input.customer, input.fallbackText, result, undefined);
        return {
          sent: true,
          mocked: result.mocked,
          usedTemplate: false,
          error: templateError instanceof Error ? templateError.message : String(templateError),
        };
      }
    }
    const result = await sendText(input.customer.phoneE164, input.fallbackText);
    await logSend(ctx, input.customer, input.fallbackText, result);
    return { sent: true, mocked: result.mocked, usedTemplate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSend(ctx, input.customer, input.fallbackText, null, message);
    return { sent: false, mocked: false, usedTemplate: false, error: message };
  }
}

export async function sendFreeform(
  ctx: ServiceContext,
  customer: Customer,
  text: string,
): Promise<{ sent: boolean; mocked: boolean }> {
  try {
    const result = await sendText(customer.phoneE164, text, await credsFor(ctx));
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
      await sendText(phone, text, await credsFor(ctx));
      return { sent: true };
    } catch {
      return { sent: false };
    }
  }
  return { sent: true };
}
