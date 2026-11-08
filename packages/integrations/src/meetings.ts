export function createMeetingLink(input: { topic: string; startsAt: Date }): string {
  const mode = process.env.MEETINGS_MODE ?? "mock";
  if (mode === "mock") {
    const slug = input.topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24);
    return `https://meet.jit.si/palda-${slug || "session"}-${input.startsAt.getTime().toString(36)}`;
  }
  // Production: swap for Google Calendar / Zoom API integration.
  throw new Error("Meeting provider not configured. Set MEETINGS_MODE=mock or implement a provider.");
}

export function intakeFormLink(sessionId: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/intake/${sessionId}`;
}
