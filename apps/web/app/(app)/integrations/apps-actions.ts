"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ServiceError, appInfo, disconnectApp, isAppId, withPrincipal } from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

/** The owner disconnects an app they connected (Google / Zoho). The grant is also revoked with the vendor. */
export async function disconnectAppAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const app = String(formData.get("app") ?? "");
  if (!isAppId(app)) redirect("/integrations");
  let message: string;
  try {
    await withPrincipal(principalOf(session), (ctx) => disconnectApp(ctx, app));
    message = `appOk=${encodeURIComponent(`${appInfo(app).name} is disconnected.`)}`;
  } catch (error) {
    message = `appError=${encodeURIComponent(error instanceof ServiceError ? error.message : "Couldn't disconnect. Please try again.")}`;
  }
  revalidatePath("/integrations");
  redirect(`/integrations?${message}`);
}
