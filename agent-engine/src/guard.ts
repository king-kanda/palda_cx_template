import type { AgentConfig, GuardResult, RunResult } from "./types";

const MONEY_RE = /(?:KES|Ksh|Kshs|Sh)\s?([\d,]+(?:\.\d{1,2})?)/gi;

function normaliseAmount(raw: string): string {
  return raw.replace(/,/g, "").replace(/\.00$/, "");
}

function collectAmounts(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(MONEY_RE)) out.add(normaliseAmount(match[1] ?? ""));
    return;
  }
  if (typeof value === "number") {
    out.add(String(Math.round(value)));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAmounts(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectAmounts(item, out);
  }
}

/** Every KES figure in the reply must exist somewhere in the tool results. */
export function checkMoneyGrounded(text: string, toolResults: unknown[]): string[] {
  const grounded = new Set<string>();
  collectAmounts(toolResults, grounded);
  const failures: string[] = [];
  for (const match of text.matchAll(MONEY_RE)) {
    const amount = normaliseAmount(match[1] ?? "");
    if (!amount) continue;
    if (!grounded.has(amount)) failures.push(`Ungrounded amount: ${match[0]}`);
  }
  return failures;
}

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const HUMAN_DATE_RE =
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b/gi;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

function canonicalDate(year: string | number, month: string | number, day: string | number): string {
  const y = String(year);
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function collectDates(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(ISO_DATE_RE)) {
      out.add(canonicalDate(match[1]!, match[2]!, match[3]!));
    }
    for (const match of value.matchAll(HUMAN_DATE_RE)) {
      const month = MONTHS[match[2]!.toLowerCase()];
      if (month) out.add(canonicalDate(match[3]!, month, match[1]!));
    }
    for (const match of value.matchAll(SLASH_DATE_RE)) {
      out.add(canonicalDate(match[3]!, match[2]!, match[1]!));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDates(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectDates(item, out);
  }
}

/**
 * PLAN §6.4: a date written in the reply must come from a tool result this
 * turn. Only explicit calendar dates are checked (ISO, "20 December 2026" or
 * "20/12/2026"); relative phrases like "Saturday" are derived from the clock
 * and stay the model's job.
 */
export function checkDatesGrounded(text: string, toolResults: unknown[]): string[] {
  const grounded = new Set<string>();
  collectDates(toolResults, grounded);

  const failures: string[] = [];
  const seen = new Set<string>();
  const check = (canonical: string, raw: string) => {
    if (seen.has(canonical)) return;
    seen.add(canonical);
    if (!grounded.has(canonical)) failures.push(`Ungrounded date: ${raw}`);
  };

  for (const match of text.matchAll(ISO_DATE_RE)) {
    check(canonicalDate(match[1]!, match[2]!, match[3]!), match[0]);
  }
  for (const match of text.matchAll(HUMAN_DATE_RE)) {
    const month = MONTHS[match[2]!.toLowerCase()];
    if (month) check(canonicalDate(match[3]!, month, match[1]!), match[0]);
  }
  for (const match of text.matchAll(SLASH_DATE_RE)) {
    check(canonicalDate(match[3]!, match[2]!, match[1]!), match[0]);
  }
  return failures;
}

const LINK_RE = /https?:\/\/[^\s)>\]"']+/gi;

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * PLAN §6.4: links may only point at our own domain, a pay link, a review link
 * or a link that a tool returned this turn. Anything else is rejected.
 */
export function checkLinks(
  text: string,
  toolResults: unknown[],
  extraAllowed: string[] = [],
): string[] {
  const urls = [...text.matchAll(LINK_RE)].map((match) => match[0]!.replace(/[.,;:]+$/, ""));
  if (urls.length === 0) return [];

  const allowedHosts = new Set<string>();
  for (const url of extraAllowed) {
    const host = hostOf(url);
    if (host) allowedHosts.add(host);
  }

  // A link is allowed if the exact URL appears in a tool result (e.g. a Jitsi
  // meeting link or a payment link) or its host was explicitly allowed.
  const toolText = JSON.stringify(toolResults ?? []);
  const failures: string[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    const inToolResult = toolText.includes(url);
    if (inToolResult) continue;
    if (host && allowedHosts.has(host)) continue;
    failures.push(`Unapproved link: ${url}`);
  }
  return failures;
}

export function checkForbiddenPromises(text: string, phrases: string[]): string[] {
  const lower = text.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase())).map((p) => `Forbidden promise: ${p}`);
}

export function checkPii(text: string): string[] {
  const failures: string[] = [];
  if (/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) failures.push("Possible card number in reply");
  if (/\b(pin|password|otp)\s*[:=]\s*\d+/i.test(text)) failures.push("Possible credential in reply");
  return failures;
}

export function checkRepeat(text: string, recentOutbound: string[], maxRepeats: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const recent = recentOutbound.filter((m) => m.trim() === trimmed).length;
  return recent >= maxRepeats ? ["Repeated outbound message"] : [];
}

export function guardOutput(input: {
  text: string;
  config: AgentConfig;
  toolResults: unknown[];
  recentOutbound: string[];
  /** Hosts the tenant allows links to (own app, review page, pay page). */
  allowedLinks?: string[];
}): GuardResult {
  const reasons: string[] = [];
  const text = input.text.trim();

  if (text.length > input.config.guard.maxChars) {
    reasons.push(`Reply too long (${text.length} > ${input.config.guard.maxChars})`);
  }
  if (input.config.guard.moneyMustComeFromTools) {
    reasons.push(...checkMoneyGrounded(text, input.toolResults));
    reasons.push(...checkDatesGrounded(text, input.toolResults));
  }
  reasons.push(...checkForbiddenPromises(text, input.config.guard.forbiddenPromises));
  reasons.push(...checkLinks(text, input.toolResults, input.allowedLinks));
  reasons.push(...checkPii(text));
  reasons.push(...checkRepeat(text, input.recentOutbound, input.config.guard.maxRepeats));

  return { ok: reasons.length === 0, reasons, text };
}

/** Safe fallback used when the guard rejects a reply. */
export function guardFallback(config: AgentConfig): string {
  return config.handoff.enabled
    ? "Let me get a team member to help with that. One moment please."
    : "I do not have a verified answer for that yet. Please check the dashboard or the exact figures in the source record.";
}

/**
 * Marks a run flagged (never silently drops the reply) so the eval dashboard and
 * daily digest can catch regressions.
 */
export function applyGuard(result: RunResult, guarded: GuardResult, config: AgentConfig): RunResult {
  if (guarded.ok) return result;
  return {
    ...result,
    text: guardFallback(config),
    flagged: true,
    flagReasons: [...result.flagReasons, ...guarded.reasons],
    stoppedReason: "guard",
  };
}

export function containsHandoffKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  return keywords.find((keyword) => lower.includes(keyword.toLowerCase())) ?? null;
}
