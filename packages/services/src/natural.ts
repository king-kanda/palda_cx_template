import { whatsappMode } from "@garden/integrations";
import type { Customer } from "@garden/db";
import type { ServiceContext } from "./context";
import { sendFreeform } from "./notify";

/**
 * Makes replies feel like a person typing on WhatsApp instead of a system answering: a long reply goes out as two or three short
 * messages, each after a pause that scales with its length, not as one block that appears instantly.
 *
 * Pacing is on for real WhatsApp (cloud) and off in mock mode so tests stay fast. HUMAN_PACING=on|off overrides it.
 * The total wait is capped so a webhook is never held for long.
 */

const MAX_PARTS = 3;
const SINGLE_MESSAGE_LIMIT = 240;
const MIN_PART = 60;
const TOTAL_CAP_MS = 4500;

const looksLikeList = (text: string) => /^\s*([-*•]|\d+[.)])\s/m.test(text);

/** Splits a reply into at most three short messages. Never splits a list, a link, or a short reply. */
export function splitForChat(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= SINGLE_MESSAGE_LIMIT || looksLikeList(text)) return [text];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    // Merge the shortest neighbours until there are at most MAX_PARTS.
    const parts = [...paragraphs];
    while (parts.length > MAX_PARTS) {
      let best = 0;
      let bestLen = Infinity;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const len = parts[i]!.length + parts[i + 1]!.length;
        if (len < bestLen) {
          bestLen = len;
          best = i;
        }
      }
      parts.splice(best, 2, `${parts[best]}\n\n${parts[best + 1]}`);
    }
    return parts;
  }

  // One long paragraph: split once at the sentence boundary nearest the middle, if both halves are substantial.
  const boundaries: number[] = [];
  const re = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) boundaries.push(m.index);
  const middle = text.length / 2;
  const cut = boundaries
    .filter((i) => i >= MIN_PART && text.length - i >= MIN_PART && !/https?:\/\/\S*$/.test(text.slice(0, i)))
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  if (cut === undefined) return [text];
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

/** How long a person would take to read the last message and type this one, with some natural variation. */
export function typingDelayMs(text: string, first: boolean, random: () => number = Math.random): number {
  const base = (first ? 700 : 400) + text.length * 22;
  const clamped = Math.min(Math.max(base, first ? 800 : 600), 2200);
  return Math.round(clamped * (0.85 + 0.3 * random()));
}

export function planNaturalMessages(text: string, random: () => number = Math.random): { text: string; delayMs: number }[] {
  let spent = 0;
  return splitForChat(text).map((part, i) => {
    const delayMs = Math.min(typingDelayMs(part, i === 0, random), Math.max(0, TOTAL_CAP_MS - spent));
    spent += delayMs;
    return { text: part, delayMs };
  });
}

export function pacingEnabled(): boolean {
  const flag = process.env.HUMAN_PACING;
  if (flag === "on") return true;
  if (flag === "off") return false;
  return whatsappMode() === "cloud";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends a reply the way a person would. Returns whether every part went out. */
export async function sendNatural(ctx: ServiceContext, customer: Customer, text: string): Promise<{ sent: boolean }> {
  const pace = pacingEnabled();
  const parts = pace ? planNaturalMessages(text) : [{ text: text.trim(), delayMs: 0 }];
  let allSent = true;
  for (const part of parts) {
    if (pace && part.delayMs > 0) await sleep(part.delayMs);
    const result = await sendFreeform(ctx, customer, part.text);
    if (!result.sent) allSent = false;
  }
  return { sent: allSent };
}
