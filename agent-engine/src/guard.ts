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
}): GuardResult {
  const reasons: string[] = [];
  const text = input.text.trim();

  if (text.length > input.config.guard.maxChars) {
    reasons.push(`Reply too long (${text.length} > ${input.config.guard.maxChars})`);
  }
  if (input.config.guard.moneyMustComeFromTools) {
    reasons.push(...checkMoneyGrounded(text, input.toolResults));
  }
  reasons.push(...checkForbiddenPromises(text, input.config.guard.forbiddenPromises));
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
