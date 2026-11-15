import { describe, expect, it } from "vitest";
import { WAMBO, applyAgentProfile } from "../../agent-engine/src/agents";
import { checkSelfReference, guardFallback, guardOutput } from "../../agent-engine/src/guard";
import { planNaturalMessages, splitForChat, typingDelayMs } from "../../packages/services/src/natural";

describe("checkSelfReference (what a customer-facing agent may say about itself)", () => {
  it.each([
    "Hello! I'm an AI assistant, how can I help?",
    "As an AI, I can't do that.",
    "I'm a virtual assistant for Palda Gardens.",
    "I am a chatbot and I'm here to help.",
    "I was programmed to answer booking questions.",
    "This is an automated response.",
    "I'm powered by a large language model.",
    "I'm ChatGPT.",
    "AI-powered booking help",
  ])("blocks it when the customer did not ask: %s", (text) => {
    expect(checkSelfReference(text, "Do you have a slot on Saturday?")).toContain("Brought up being software without being asked");
  });

  it("allows a brief honest answer when the customer asks what they are talking to", () => {
    const answer = "I'm Zuri, the virtual assistant for Palda Gardens. I can get someone from the team if you'd rather.";
    for (const asked of ["am I talking to a bot?", "are you a robot", "Is this AI?", "are you a real person?", "wait is this a machine", "who am I speaking with, a human?"]) {
      expect(checkSelfReference(answer, asked)).toEqual([]);
    }
  });

  it.each([
    "Yes, I'm a real person!",
    "I am a real human, born in Nairobi.",
    "No, I'm not a bot.",
    "I'm not an AI, I promise.",
    "I'm human, don't worry.",
    "Not a robot, just Zuri.",
  ])("never allows a claim to be a person, even when asked: %s", (text) => {
    expect(checkSelfReference(text, "are you a bot?")).toContain("Claimed to be a person");
    expect(checkSelfReference(text, "hello")).toContain("Claimed to be a person");
  });

  it("leaves normal replies alone", () => {
    for (const text of [
      "Hi, it's Zuri. What can I do for you?",
      "Saturday morning is free. Want me to hold it?",
      "I'm so sorry about that. Let me sort it out now.",
      "It's an annual deal, and the assistant manager approved the venue.", // 'assistant' alone is not software talk
      "We use an automated reminder the day before, so you won't forget.",
      "I'm real sorry about that, let me fix it now.",
      "Hi Claude, Saturday works. And Gemini is welcome to join too.",
      "I'm a man of my word, you'll have it by Friday.",
    ]) {
      expect(checkSelfReference(text, "hello")).toEqual([]);
    }
  });

  it("is enforced for the customer-facing agent only, through guardOutput", () => {
    const base = { text: "I'm an AI assistant.", toolResults: [], recentOutbound: [], userText: "hi" };
    expect(guardOutput({ ...base, config: WAMBO }).ok).toBe(false);
    expect(guardOutput({ ...base, config: { ...WAMBO, guard: { ...WAMBO.guard, naturalVoice: false } } }).ok).toBe(true);
  });

  it("the fallback shown to customers sounds like a person, not a system", () => {
    const text = guardFallback(WAMBO);
    for (const stiff of ["one moment please", "thank you for your patience", "verified", "team member"]) {
      expect(text.toLowerCase()).not.toContain(stiff);
    }
  });
});

describe("the persona carries the voice rules and the intro choice", () => {
  const profile = { agentName: "Zuri", businessName: "Palda Gardens" };

  it("forbids describing itself as software and stock assistant phrases", () => {
    const rules = WAMBO.rules.join(" ").toLowerCase();
    expect(rules).toContain("never refer to yourself as an ai");
    expect(rules).toContain("how may i assist you today");
    expect(rules).toContain("never claim to be a person");
  });

  it("intro 'name': may greet with its first name once, never re-introduces", () => {
    const persona = applyAgentProfile(WAMBO, { ...profile, intro: "name" }).persona;
    expect(persona).toContain("first name once");
    expect(persona).toContain("Never introduce yourself again");
  });

  it("intro 'none': never introduces itself unless asked", () => {
    const persona = applyAgentProfile(WAMBO, { ...profile, intro: "none" }).persona;
    expect(persona).toContain("Never introduce yourself");
    expect(persona).not.toContain("first name once");
  });

  it("defaults to the name intro, and never says what it is", () => {
    const persona = applyAgentProfile(WAMBO, profile).persona;
    expect(persona).toContain("first name once");
    expect(persona.toLowerCase()).not.toContain("you are an ai");
  });

  it("other agents are untouched", () => {
    const other = { ...WAMBO, id: "ops" };
    expect(applyAgentProfile(other, profile)).toBe(other);
  });
});

describe("natural pacing", () => {
  it("keeps a short reply as one message", () => {
    expect(splitForChat("Saturday morning is free. Want me to hold it?")).toHaveLength(1);
  });

  it("splits paragraphs into short messages, at most three", () => {
    const long = Array.from({ length: 5 }, (_, i) => `Paragraph ${i} has enough words to count as its own short chat message here.`.repeat(2)).join("\n\n");
    const parts = splitForChat(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(3);
    expect(parts.join("\n\n").replace(/\n+/g, " ")).toContain("Paragraph 4");
  });

  it("splits one long paragraph at a sentence, never inside a link", () => {
    const text =
      "The Standard clean takes about three hours and covers every room, including the kitchen and bathrooms, with supplies brought by the team. " +
      "The price is KES 3,000 and a deposit of KES 1,000 holds the slot. You can pay at https://pay.example.com/abc.def or by M-Pesa to the number I send.";
    const parts = splitForChat(text);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toContain("https://pay.example.com/abc.def");
  });

  it("never splits a list", () => {
    const list = "Here are the options:\n1. Standard clean, KES 3,000\n2. Deep clean, KES 6,000\n3. Move-out clean, KES 9,000\nWhich one suits you? " + "x".repeat(200);
    expect(splitForChat(list)).toHaveLength(1);
  });

  it("delays scale with length, vary, and stay within a human range", () => {
    const short = typingDelayMs("ok", false, () => 0.5);
    const long = typingDelayMs("x".repeat(200), false, () => 0.5);
    expect(long).toBeGreaterThan(short);
    expect(typingDelayMs("x".repeat(2000), true, () => 1)).toBeLessThanOrEqual(2200 * 1.15 + 1);
    expect(typingDelayMs("hello there", true, () => 0)).not.toBe(typingDelayMs("hello there", true, () => 1));
  });

  it("caps the total wait so a webhook is never held for long", () => {
    const text = Array.from({ length: 3 }, () => "word ".repeat(80)).join("\n\n");
    const total = planNaturalMessages(text, () => 1).reduce((sum, p) => sum + p.delayMs, 0);
    expect(total).toBeLessThanOrEqual(4500);
  });
});
