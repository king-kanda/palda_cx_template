import { appRequest } from "./apps-http";
import { integrationsMode } from "./oauth-apps";

/** Google Workspace calls used by the agent's built-in Google tools. Everything acts on the connected account's own calendar/mail. */

const mock = (token: string) => integrationsMode() === "mock" || token.startsWith("mock_");

export async function googleAccountEmail(token: string): Promise<string | null> {
  if (mock(token)) return "owner@example.com";
  const me = await appRequest<{ email?: string }>("https://www.googleapis.com/oauth2/v2/userinfo", { token });
  return me.email ?? null;
}

export type BusySlot = { start: string; end: string };

/** Busy times on the business's primary calendar between `from` and `to` (ISO). */
export async function googleBusy(token: string, input: { from: string; to: string }): Promise<BusySlot[]> {
  if (mock(token)) {
    const start = new Date(input.from);
    const at = (h: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), h)).toISOString();
    // 09:00-11:00 and 14:00-15:00 Nairobi on the first day.
    return [
      { start: at(6), end: at(8) },
      { start: at(11), end: at(12) },
    ].filter((s) => s.end > input.from && s.start < input.to);
  }
  const res = await appRequest<{ calendars?: Record<string, { busy?: BusySlot[] }> }>("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    token,
    json: { timeMin: input.from, timeMax: input.to, timeZone: "Africa/Nairobi", items: [{ id: "primary" }] },
  });
  return res.calendars?.primary?.busy ?? [];
}

export type CreatedEvent = { id: string; link: string | null; start: string; end: string };

export async function googleCreateEvent(
  token: string,
  input: { summary: string; description?: string; start: string; end: string; attendeeEmail?: string | null },
): Promise<CreatedEvent> {
  if (mock(token)) return { id: "mock-event-1", link: "https://calendar.google.com/calendar/event?eid=mock", start: input.start, end: input.end };
  const res = await appRequest<{ id: string; htmlLink?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events${input.attendeeEmail ? "?sendUpdates=all" : ""}`,
    {
      method: "POST",
      token,
      json: {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start, timeZone: "Africa/Nairobi" },
        end: { dateTime: input.end, timeZone: "Africa/Nairobi" },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
      },
    },
  );
  return { id: res.id, link: res.htmlLink ?? null, start: res.start?.dateTime ?? input.start, end: res.end?.dateTime ?? input.end };
}

/** Header-safe: no line breaks, so a subject can't inject extra headers. */
const headerSafe = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

export async function googleSendEmail(token: string, input: { to: string; subject: string; body: string }): Promise<{ id: string }> {
  if (mock(token)) return { id: "mock-message-1" };
  const subject = `=?UTF-8?B?${Buffer.from(headerSafe(input.subject)).toString("base64")}?=`;
  const mime = [`To: ${headerSafe(input.to)}`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", input.body].join("\r\n");
  const raw = Buffer.from(mime).toString("base64url");
  const res = await appRequest<{ id: string }>("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", token, json: { raw } });
  return { id: res.id };
}
