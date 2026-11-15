/**
 * Reads the messages Meta's Embedded Signup popup posts back to our page. This file has NO server imports, so the browser can use it
 * (import from "@garden/integrations/signup-message"); the server package re-exports it.
 */

export type SignupMessage =
  | { kind: "finish"; event: string; wabaId: string | null; phoneNumberId: string | null; businessId: string | null; coexistence: boolean }
  | { kind: "cancel"; step: string | null }
  | { kind: "error"; message: string };

/**
 * Reads one message posted by Meta's Embedded Signup popup. Only messages from a facebook.com origin that look like
 * WA_EMBEDDED_SIGNUP are understood; anything else returns null. Pure, so it is tested without a browser.
 */
export function parseSignupMessage(origin: string, data: unknown): SignupMessage | null {
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let obj: unknown = data;
  if (typeof data === "string") {
    try {
      obj = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.type !== "WA_EMBEDDED_SIGNUP") return null;
  const d = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const event = str(o.event) ?? "";
  if (event === "CANCEL") return { kind: "cancel", step: str(d.current_step) };
  if (event === "ERROR") return { kind: "error", message: str(d.error_message) ?? "Something went wrong in the WhatsApp sign-up." };
  if (event.startsWith("FINISH")) {
    return {
      kind: "finish",
      event,
      wabaId: str(d.waba_id),
      phoneNumberId: str(d.phone_number_id),
      businessId: str(d.business_id),
      coexistence: event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
    };
  }
  return null;
}
