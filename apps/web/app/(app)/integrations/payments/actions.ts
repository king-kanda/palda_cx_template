"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PaymentProviderId } from "@garden/integrations";
import {
  ServiceError,
  movePaymentProvider,
  refreshPaymentTemplates,
  removePaymentProvider,
  savePaymentProvider,
  setPaymentProviderEnabled,
  setupPaymentTemplates,
  withPrincipal,
  type ProviderCredentialsInput,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

const PROVIDERS = ["tuma", "paystack", "pesapal"] as const;
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim().slice(0, 500);

function providerOf(formData: FormData): PaymentProviderId {
  const p = text(formData, "provider");
  if (!(PROVIDERS as readonly string[]).includes(p)) throw new ServiceError("VALIDATION", "Unknown payment provider.");
  return p as PaymentProviderId;
}

/** Runs one owner action and comes back to the page with a short message. Secrets are never put in the message. */
async function run(done: string, fn: (ctx: Parameters<Parameters<typeof withPrincipal>[1]>[0]) => Promise<unknown>): Promise<never> {
  const session = await requireSession();
  let message = done;
  let failed = false;
  try {
    await withPrincipal(principalOf(session), fn);
    revalidatePath("/integrations");
  } catch (error) {
    failed = true;
    message = error instanceof ServiceError ? error.message : "Something went wrong. Please try again.";
    if (!(error instanceof ServiceError)) console.error("[payments] settings action failed", error instanceof Error ? error.message : error);
  }
  redirect(`/integrations?${failed ? "payError" : "payOk"}=${encodeURIComponent(message)}#payments`);
}

export async function saveProviderAction(formData: FormData): Promise<void> {
  const provider = providerOf(formData);
  let input: ProviderCredentialsInput;
  if (provider === "tuma") input = { provider, email: text(formData, "email"), apiKey: text(formData, "apiKey") };
  else if (provider === "paystack") input = { provider, secretKey: text(formData, "secretKey") };
  else
    input = {
      provider,
      consumerKey: text(formData, "consumerKey"),
      consumerSecret: text(formData, "consumerSecret"),
      environment: text(formData, "environment") === "live" ? "live" : "sandbox",
    };
  await run("Saved. This provider is now switched on.", (ctx) => savePaymentProvider(ctx, input));
}

export async function toggleProviderAction(formData: FormData): Promise<void> {
  const provider = providerOf(formData);
  const on = text(formData, "on") === "1";
  await run(on ? "Switched on." : "Switched off.", (ctx) => setPaymentProviderEnabled(ctx, provider, on));
}

export async function moveProviderAction(formData: FormData): Promise<void> {
  const provider = providerOf(formData);
  const direction = text(formData, "direction") === "up" ? -1 : 1;
  await run("Order updated.", (ctx) => movePaymentProvider(ctx, provider, direction));
}

export async function removeProviderAction(formData: FormData): Promise<void> {
  const provider = providerOf(formData);
  await run("Removed.", (ctx) => removePaymentProvider(ctx, provider));
}

export async function setupTemplatesAction(): Promise<void> {
  await run("Payment messages were sent to WhatsApp for approval. This can take a little while.", (ctx) => setupPaymentTemplates(ctx));
}

export async function refreshTemplatesAction(): Promise<void> {
  await run("Status updated.", (ctx) => refreshPaymentTemplates(ctx));
}
