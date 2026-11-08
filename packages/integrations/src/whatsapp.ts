import { z } from "zod";
import { hmacSha256Hex, verifyHmacSha256 } from "./crypto";

export type WhatsAppMode = "cloud" | "mock";

export function whatsappMode(): WhatsAppMode {
  return (process.env.WHATSAPP_MODE as WhatsAppMode) ?? "mock";
}

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";

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

async function graphSend(payload: Record<string, unknown>): Promise<string> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !token) {
    throw new WhatsAppError("WhatsApp Cloud API credentials are not configured.");
  }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: unknown };
  if (!res.ok) throw new WhatsAppError("WhatsApp send failed", json);
  const id = json.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp response did not include a message id.", json);
  return id;
}

export async function sendText(to: string, text: string): Promise<SendResult> {
  if (whatsappMode() === "mock") {
    return { waMessageId: `mock_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, mocked: true };
  }
  const id = await graphSend({
    to: to.replace("+", ""),
    type: "text",
    text: { preview_url: false, body: text },
  });
  return { waMessageId: id, mocked: false };
}

export async function sendTemplate(
  to: string,
  templateName: string,
  params: TemplateParam[],
  languageCode = "en",
): Promise<SendResult> {
  if (whatsappMode() === "mock") {
    return {
      waMessageId: `mock_tpl_${templateName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mocked: true,
    };
  }
  const id = await graphSend({
    to: to.replace("+", ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
        : [],
    },
  });
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

export function signatureForTests(rawBody: string, secret: string): string {
  return `sha256=${hmacSha256Hex(rawBody, secret)}`;
}
