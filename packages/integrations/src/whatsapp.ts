import { z } from "zod";
import { hmacSha256Hex, verifyHmacSha256 } from "./crypto";

export type WhatsAppMode = "cloud" | "mock";

export function whatsappMode(): WhatsAppMode {
  return (process.env.WHATSAPP_MODE as WhatsAppMode) ?? "mock";
}

/** Read on every call, so it can be changed without a restart in tests. Set WHATSAPP_GRAPH_VERSION to a current Graph API version. */
export function graphVersion(): string {
  return process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
}

/**
 * The credentials for ONE business's WhatsApp number. Each customer connects their own number through Embedded Signup and gets
 * their own token, so sending is always done with the credentials of the business the message belongs to. When none are given the
 * old single-number environment values are used (development with one number only).
 */
export type WhatsAppCreds = { phoneNumberId: string; accessToken: string };

function resolveCreds(creds?: WhatsAppCreds | null): WhatsAppCreds {
  const phoneNumberId = creds?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = creds?.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new WhatsAppError("WhatsApp isn't connected for this business.");
  }
  return { phoneNumberId, accessToken };
}

export type SendResult = {
  waMessageId: string;
  mocked: boolean;
};

export type TemplateParam = string;

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = "WhatsAppError";
  }
}

async function graphSend(payload: Record<string, unknown>, creds?: WhatsAppCreds | null): Promise<string> {
  const { phoneNumberId, accessToken } = resolveCreds(creds);
  const res = await fetch(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: unknown };
  if (!res.ok) throw new WhatsAppError("WhatsApp send failed", json);
  const id = json.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp response did not include a message id.", json);
  return id;
}

/**
 * Marks the customer's message as read and shows "typing…" on their phone while we prepare a reply (it clears when we send, or
 * after a short time). Best effort and silent: a failure here must never affect the conversation. Uses WhatsApp Cloud API's
 * typing indicator on the read receipt; confirm it is enabled for your number when you first test with real keys.
 */
export async function sendTypingIndicator(inboundWaMessageId: string, creds?: WhatsAppCreds | null): Promise<void> {
  if (whatsappMode() === "mock" || !inboundWaMessageId) return;
  let resolved: WhatsAppCreds;
  try {
    resolved = resolveCreds(creds);
  } catch {
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/${graphVersion()}/${resolved.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${resolved.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: inboundWaMessageId,
        typing_indicator: { type: "text" },
      }),
    });
  } catch {
    /* cosmetic only */
  }
}

export async function sendText(to: string, text: string, creds?: WhatsAppCreds | null): Promise<SendResult> {
  if (whatsappMode() === "mock") {
    return { waMessageId: `mock_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, mocked: true };
  }
  const id = await graphSend(
    {
      to: to.replace("+", ""),
      type: "text",
      text: { preview_url: false, body: text },
    },
    creds,
  );
  return { waMessageId: id, mocked: false };
}

export async function sendTemplate(
  to: string,
  templateName: string,
  params: TemplateParam[],
  languageCode = "en",
  creds?: WhatsAppCreds | null,
): Promise<SendResult> {
  if (whatsappMode() === "mock") {
    return {
      waMessageId: `mock_tpl_${templateName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mocked: true,
    };
  }
  const id = await graphSend(
    {
      to: to.replace("+", ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: params.length
          ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
          : [],
      },
    },
    creds,
  );
  return { waMessageId: id, mocked: false };
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return whatsappMode() === "mock";
  if (!signatureHeader?.startsWith("sha256=")) return false;
  return verifyHmacSha256(rawBody, signatureHeader.slice("sha256=".length), secret);
}

export function webhookChallenge(params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return challenge;
  }
  return null;
}

export type InboundWhatsAppMessage = {
  waMessageId: string;
  from: string;
  type: "text" | "interactive" | "image" | "audio" | "button" | "unsupported";
  text: string | null;
  timestamp: Date;
  mediaId?: string;
  interactiveReply?: string;
  raw: Record<string, unknown>;
};

const webhookSchema = z
  .object({
    entry: z
      .array(
        z.object({
          changes: z
            .array(
              z.object({
                value: z.object({
                  messages: z
                    .array(
                      z.object({
                        id: z.string(),
                        from: z.string(),
                        timestamp: z.string(),
                        type: z.string(),
                        text: z.object({ body: z.string() }).optional(),
                        interactive: z
                          .object({
                            type: z.string(),
                            button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                            list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                          })
                          .optional(),
                        image: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
                        audio: z.object({ id: z.string() }).optional(),
                        button: z.object({ text: z.string(), payload: z.string() }).optional(),
                      }),
                    )
                    .optional(),
                }),
              }),
            )
            .optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export function parseWebhook(payload: unknown): InboundWhatsAppMessage[] {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.entry) return [];
  const out: InboundWhatsAppMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value.messages ?? []) {
        let type: InboundWhatsAppMessage["type"] = "unsupported";
        let text: string | null = null;
        let mediaId: string | undefined;
        let interactiveReply: string | undefined;
        if (m.type === "text" && m.text) {
          type = "text";
          text = m.text.body;
        } else if (m.type === "interactive" && m.interactive) {
          type = "interactive";
          interactiveReply = m.interactive.button_reply?.title ?? m.interactive.list_reply?.title;
          text = interactiveReply ?? null;
        } else if (m.type === "button" && m.button) {
          type = "button";
          text = m.button.text;
          interactiveReply = m.button.payload;
        } else if (m.type === "image" && m.image) {
          type = "image";
          mediaId = m.image.id;
          text = m.image.caption ?? "[image]";
        } else if (m.type === "audio" && m.audio) {
          type = "audio";
          mediaId = m.audio.id;
          text = "[voice note]";
        }
        out.push({
          waMessageId: m.id,
          from: `+${m.from.replace(/^\+/, "")}`,
          type,
          text,
          timestamp: new Date(Number(m.timestamp ?? 0) * 1000),
          mediaId,
          interactiveReply,
          raw: m as unknown as Record<string, unknown>,
        });
      }
    }
  }
  return out;
}

/* ───────────────────────── every kind of change Meta sends ───────────────────────── */

/** A message the business sent from the WhatsApp Business app on the same number (coexistence). */
export type WhatsAppEcho = {
  waMessageId: string;
  /** The business's own number. */
  from: string;
  /** The customer. */
  to: string;
  type: string;
  text: string | null;
  timestamp: Date;
  raw: Record<string, unknown>;
};

export type WhatsAppAccountUpdate = {
  event: string;
  wabaId: string | null;
  reason: string | null;
  raw: Record<string, unknown>;
};

export type WhatsAppChange = {
  /** "messages", "smb_message_echoes", "history", "smb_app_state_sync", "account_update", ... */
  field: string;
  /** The business number this is about. Messages from different numbers can arrive in one request, so route each change on its own. */
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  contacts: { waId: string; name: string }[];
  messages: InboundWhatsAppMessage[];
  echoes: WhatsAppEcho[];
  accountUpdate: WhatsAppAccountUpdate | null;
  raw: Record<string, unknown>;
};

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const plus = (n: string) => `+${n.replace(/^\+/, "")}`;

function toInbound(m: Record<string, unknown>): InboundWhatsAppMessage | null {
  const id = asStr(m.id);
  const from = asStr(m.from);
  if (!id || !from) return null;
  const type = asStr(m.type) ?? "";
  let kind: InboundWhatsAppMessage["type"] = "unsupported";
  let text: string | null = null;
  let mediaId: string | undefined;
  let interactiveReply: string | undefined;
  const textObj = asObj(m.text);
  const interactive = asObj(m.interactive);
  const button = asObj(m.button);
  const image = asObj(m.image);
  const audio = asObj(m.audio);
  if (type === "text" && asStr(textObj.body) !== null) {
    kind = "text";
    text = String(textObj.body);
  } else if (type === "interactive") {
    kind = "interactive";
    interactiveReply = asStr(asObj(interactive.button_reply).title) ?? asStr(asObj(interactive.list_reply).title) ?? undefined;
    text = interactiveReply ?? null;
  } else if (type === "button") {
    kind = "button";
    text = asStr(button.text);
    interactiveReply = asStr(button.payload) ?? undefined;
  } else if (type === "image") {
    kind = "image";
    mediaId = asStr(image.id) ?? undefined;
    text = asStr(image.caption) ?? "[image]";
  } else if (type === "audio") {
    kind = "audio";
    mediaId = asStr(audio.id) ?? undefined;
    text = "[voice note]";
  }
  return {
    waMessageId: id,
    from: plus(from),
    type: kind,
    text,
    timestamp: new Date(Number(m.timestamp ?? 0) * 1000),
    mediaId,
    interactiveReply,
    raw: m,
  };
}

/**
 * Splits one webhook request into its changes, each tied to the business number it concerns. Defensive on purpose: Meta adds
 * fields, and a field we do not understand must be skipped, never crash the handler (Meta retries failed deliveries).
 */
export function parseWhatsAppPayload(payload: unknown): WhatsAppChange[] {
  const out: WhatsAppChange[] = [];
  const entries = asObj(payload).entry;
  if (!Array.isArray(entries)) return out;
  for (const entryRaw of entries) {
    const changes = asObj(entryRaw).changes;
    if (!Array.isArray(changes)) continue;
    for (const changeRaw of changes) {
      const change = asObj(changeRaw);
      const value = asObj(change.value);
      const metadata = asObj(value.metadata);
      const field = asStr(change.field) ?? "messages";

      const contacts = (Array.isArray(value.contacts) ? value.contacts : [])
        .map((c) => ({ waId: asStr(asObj(c).wa_id) ?? "", name: asStr(asObj(asObj(c).profile).name) ?? "" }))
        .filter((c) => c.waId);

      const messages = (Array.isArray(value.messages) ? value.messages : [])
        .map((m) => toInbound(asObj(m)))
        .filter((m): m is InboundWhatsAppMessage => m !== null);

      const echoes: WhatsAppEcho[] = [];
      for (const e of Array.isArray(value.message_echoes) ? value.message_echoes : []) {
        const o = asObj(e);
        const id = asStr(o.id);
        const from = asStr(o.from);
        const to = asStr(o.to);
        if (!id || !from || !to) continue;
        echoes.push({
          waMessageId: id,
          from: plus(from),
          to: plus(to),
          type: asStr(o.type) ?? "text",
          text: asStr(asObj(o.text).body),
          timestamp: new Date(Number(o.timestamp ?? 0) * 1000),
          raw: o,
        });
      }

      let accountUpdate: WhatsAppAccountUpdate | null = null;
      if (field === "account_update") {
        const info = asObj(value.waba_info);
        accountUpdate = {
          event: asStr(value.event) ?? "",
          wabaId: asStr(info.waba_id) ?? asStr(value.waba_id),
          reason: asStr(asObj(value.disconnection_info).reason) ?? asStr(value.reason),
          raw: value,
        };
      }

      out.push({
        field,
        phoneNumberId: asStr(metadata.phone_number_id),
        displayPhoneNumber: asStr(metadata.display_phone_number),
        contacts,
        messages,
        echoes,
        accountUpdate,
        raw: value,
      });
    }
  }
  return out;
}

export function signatureForTests(rawBody: string, secret: string): string {
  return `sha256=${hmacSha256Hex(rawBody, secret)}`;
}
