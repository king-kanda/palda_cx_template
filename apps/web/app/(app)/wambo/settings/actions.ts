"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateConfig, withPrincipal } from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function parseFaq(raw: string): { q: string; a: string }[] {
  if (!raw.trim()) return [];
  return raw
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      const question = (lines[0] ?? "").replace(/^Q:\s*/i, "").trim();
      const answer = lines.slice(1).join(" ").replace(/^A:\s*/i, "").trim();
      return question && answer ? { q: question, a: answer } : null;
    })
    .filter((entry): entry is { q: string; a: string } => entry !== null);
}

export async function saveWamboAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const facts = String(formData.get("facts") ?? "").trim();
  const faqRaw = String(formData.get("faq") ?? "");
  const reviewLink = String(formData.get("reviewLink") ?? "").trim();
  const agentEnabled = formData.get("agentEnabled") === "on";
  const arrivalTime = String(formData.get("arrivalTime") ?? "10:00");
  const managerPhone = String(formData.get("managerPhone") ?? "").trim();

  try {
    await withPrincipal(principalOf(session), (ctx) =>
      updateConfig(ctx, "business", {
        facts,
        faq: parseFaq(faqRaw),
        reviewLink: reviewLink || undefined,
        arrivalTime,
        managerPhone: managerPhone || null,
        agentEnabled,
      }),
    );
    revalidatePath("/wambo/settings");
    revalidatePath("/wambo");
  } catch (error) {
    fail("/wambo/settings", error);
  }
}

export async function saveBrandAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const agentName = String(formData.get("agentName") ?? "").trim();
  const tone = String(formData.get("tone") ?? "").trim();
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      updateConfig(ctx, "brand", { agentName: agentName || undefined, tone }),
    );
    revalidatePath("/wambo/settings");
  } catch (error) {
    fail("/wambo/settings", error);
  }
}
