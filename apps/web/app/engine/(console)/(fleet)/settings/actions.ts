"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PLATFORM_KEYS, PLATFORM_KEY_SECTION, type PlatformKey } from "@garden/integrations";
import { ServiceError, checkPlatformMetaApp, newVerifyToken, savePlatformSettings } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";

const ALL = Object.keys(PLATFORM_KEYS) as PlatformKey[];

function back(kind: "ok" | "error", message: string): never {
  redirect(`/engine/settings?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Saves one Settings panel ("whatsapp" or "apps"). Only signed-in Palda admins reach this; values are never echoed back.
 * Only the keys of the submitted panel are read, so saving one panel never touches the other.
 */
export async function saveMetaSettingsAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const section = formData.get("section") === "apps" ? "apps" : "whatsapp";
  const fields = ALL.filter((k) => PLATFORM_KEY_SECTION[k] === section);
  const values: Partial<Record<PlatformKey, string>> = {};
  for (const key of fields) {
    const v = formData.get(key);
    if (typeof v === "string") values[key] = v.slice(0, 600);
  }
  if (section === "whatsapp" && formData.get("generateVerifyToken") === "1") values.WHATSAPP_VERIFY_TOKEN = newVerifyToken();
  const clear = fields.filter((k) => formData.get(`clear_${k}`) === "1");

  try {
    await savePlatformSettings(`engine:${admin.id}`, { values, clear });
  } catch (error) {
    if (error instanceof ServiceError) back("error", error.message);
    console.error("[settings] save failed", error instanceof Error ? error.message : error);
    back("error", "Couldn't save the settings. Please try again.");
  }
  revalidatePath("/engine/settings");
  back("ok", "Saved. The agent service and worker pick this up within 30 seconds.");
}

export async function checkMetaAppAction(): Promise<void> {
  await requireEngineAdmin();
  const result = await checkPlatformMetaApp();
  if (result.ok) back("ok", `Meta accepted the app ID and secret${result.name ? ` (app "${result.name}")` : ""}.`);
  back("error", `Meta check failed: ${result.error ?? "unknown error"}`);
}
