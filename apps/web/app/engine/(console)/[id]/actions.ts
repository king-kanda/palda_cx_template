"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ServiceError,
  resetOwnerPassword,
  rolloutCustomer,
  activateAgentVersion,
  addExternalServer,
  addKnowledgeDocument,
  deleteExternalServer,
  setExternalServerStatus,
  setExternalToolsEnabled,
  syncExternalServer,
  deleteKnowledgeDocument,
  deleteMemoryAsAdmin,
  publishAgentOverride,
  reindexKnowledge,
  reindexMemories,
  setCustomerStatus,
  startImpersonation,
  updateAgentProfile,
  updateBusinessProfile,
  type Credentials,
  type CustomerStatus,
} from "@garden/services";
import { createSession } from "@/lib/auth";
import { requireEngineAdmin } from "@/lib/engine-auth";

export type EngineFormState = { ok?: boolean; error?: string; message?: string; credentials?: Credentials };

function messageOf(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  console.error("[engine] action failed", error);
  return "Something went wrong. Please try again.";
}

const idOf = (formData: FormData) => String(formData.get("tenantId") ?? "");

export async function saveAgentAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    await updateAgentProfile(admin.id, tenantId, {
      name: String(formData.get("name") ?? ""),
      tone: String(formData.get("tone") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      intro: formData.get("intro") === "none" ? "none" : "name",
      // Only touch the picture when it was changed: "" means removed, absent means keep.
      avatar: formData.get("avatarChanged") === "1" ? String(formData.get("avatar") ?? "") || null : undefined,
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(`/engine/${tenantId}`);
  return { ok: true, message: "Agent saved." };
}

export async function saveBusinessAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  let workingHours: unknown;
  try {
    workingHours = JSON.parse(String(formData.get("workingHours") ?? ""));
  } catch {
    return { error: "Couldn't read the opening hours. Please try again." };
  }
  try {
    await updateBusinessProfile(admin.id, tenantId, {
      name: String(formData.get("name") ?? ""),
      location: String(formData.get("location") ?? ""),
      description: String(formData.get("description") ?? ""),
      reviewLink: String(formData.get("reviewLink") ?? ""),
      workingHours: workingHours as Parameters<typeof updateBusinessProfile>[2]["workingHours"],
      depositPct: Number(formData.get("depositPct") ?? 0),
      cancellationNoticeHours: Number(formData.get("cancellationNoticeHours") ?? 24),
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(`/engine/${tenantId}`);
  return { ok: true, message: "Business details saved." };
}

export async function rolloutAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    const credentials = await rolloutCustomer(admin.id, tenantId);
    revalidatePath(`/engine/${tenantId}`);
    revalidatePath("/engine");
    return { ok: true, credentials };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function resetPasswordAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  try {
    return { ok: true, credentials: await resetOwnerPassword(admin.id, idOf(formData)) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  const next = String(formData.get("status") ?? "") as CustomerStatus;
  if (!["setup", "active", "suspended"].includes(next)) redirect(`/engine/${tenantId}`);
  try {
    await setCustomerStatus(admin.id, tenantId, next);
  } catch (error) {
    redirect(`/engine/${tenantId}?error=${encodeURIComponent(messageOf(error))}`);
  }
  revalidatePath(`/engine/${tenantId}`);
  revalidatePath("/engine");
  redirect(`/engine/${tenantId}`);
}

/** Opens the customer's own app as their owner, so the team can finish setup with the normal Settings screens. */
export async function openCustomerAppAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  const to = String(formData.get("to") ?? "/dashboard");
  let target: Awaited<ReturnType<typeof startImpersonation>>;
  try {
    target = await startImpersonation(admin.id, tenantId);
  } catch (error) {
    redirect(`/engine/${tenantId}?error=${encodeURIComponent(messageOf(error))}`);
  }
  await createSession({
    userId: target.userId,
    tenantId: target.tenantId,
    tenantSlug: target.tenantSlug,
    role: "owner",
    email: target.email,
    name: target.name,
    impersonator: { adminId: admin.id, name: admin.name },
  });
  redirect(to.startsWith("/") && !to.startsWith("//") ? to : "/dashboard");
}

/** Publish this customer's tool settings as a new agent version. `blocked` is the list of tools switched OFF. */
export async function publishToolsAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  const agentId = String(formData.get("agentId") ?? "wambo");
  const blocked = formData.getAll("blocked").map(String);
  const max = Number(formData.get("maxToolCalls") ?? 6);
  try {
    const { version } = await publishAgentOverride(
      admin.id,
      tenantId,
      agentId,
      { toolPolicy: { blockedTools: blocked, maxToolCalls: max } },
      String(formData.get("note") ?? ""),
    );
    revalidatePath(`/engine/${tenantId}/agent/tools`);
    return { ok: true, message: `Published as version ${version}. It applies from the next message.` };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** Switch to an earlier version, or back to the shipped defaults when `versionId` is empty. */
export async function activateVersionAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  const agentId = String(formData.get("agentId") ?? "wambo");
  const versionId = String(formData.get("versionId") ?? "") || null;
  await activateAgentVersion(admin.id, tenantId, agentId, versionId);
  revalidatePath(`/engine/${tenantId}/agent/tools`);
}

/** Add a knowledge document for this customer's agent. */
export async function addKnowledgeAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    const res = await addKnowledgeDocument(admin.id, tenantId, {
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    revalidatePath(`/engine/${tenantId}/agent/knowledge`);
    if (res.status === "failed") return { error: `Saved, but indexing failed: ${res.error}. Use Reindex once it is fixed.` };
    return { ok: true, message: `Added and indexed (${res.chunks} section${res.chunks === 1 ? "" : "s"}).` };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function deleteKnowledgeAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  await deleteKnowledgeDocument(admin.id, tenantId, String(formData.get("docId") ?? ""));
  revalidatePath(`/engine/${tenantId}/agent/knowledge`);
}

export async function reindexKnowledgeAction(formData: FormData): Promise<void> {
  await requireEngineAdmin();
  const tenantId = idOf(formData);
  await reindexKnowledge(tenantId);
  await reindexMemories(tenantId);
  revalidatePath(`/engine/${tenantId}/agent/knowledge`);
}

/** Connect an external MCP server for this customer. Connects once to prove it works; every tool starts switched off. */
export async function addExternalServerAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    const res = await addExternalServer(admin.id, tenantId, {
      name: String(formData.get("name") ?? ""),
      url: String(formData.get("url") ?? ""),
      token: String(formData.get("token") ?? ""),
    });
    revalidatePath(`/engine/${tenantId}/agent/integrations`);
    return { ok: true, message: `Connected. Found ${res.toolCount} tool${res.toolCount === 1 ? "" : "s"}. Review them below and switch on the ones this agent should use.` };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function syncExternalServerAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    const res = await syncExternalServer(admin.id, tenantId, String(formData.get("serverId") ?? ""));
    revalidatePath(`/engine/${tenantId}/agent/integrations`);
    return {
      ok: true,
      message: res.changed.length
        ? `Synced. ${res.changed.length} tool${res.changed.length === 1 ? " was" : "s were"} changed by the server and switched off until you review ${res.changed.length === 1 ? "it" : "them"}.`
        : `Synced. ${res.toolCount} tools, nothing changed.`,
    };
  } catch (error) {
    revalidatePath(`/engine/${tenantId}/agent/integrations`);
    return { error: messageOf(error) };
  }
}

export async function saveExternalToolsAction(_prev: EngineFormState, formData: FormData): Promise<EngineFormState> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  try {
    const { enabled } = await setExternalToolsEnabled(
      admin.id,
      tenantId,
      String(formData.get("serverId") ?? ""),
      formData.getAll("enabled").map(String),
    );
    revalidatePath(`/engine/${tenantId}/agent/integrations`);
    return { ok: true, message: `Saved. ${enabled} tool${enabled === 1 ? " is" : "s are"} on. It applies from the next message.` };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

export async function setExternalServerStatusAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  const status = String(formData.get("status")) === "disabled" ? "disabled" : "active";
  await setExternalServerStatus(admin.id, tenantId, String(formData.get("serverId") ?? ""), status);
  revalidatePath(`/engine/${tenantId}/agent/integrations`);
}

export async function deleteExternalServerAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  await deleteExternalServer(admin.id, tenantId, String(formData.get("serverId") ?? ""));
  revalidatePath(`/engine/${tenantId}/agent/integrations`);
}

export async function deleteMemoryAction(formData: FormData): Promise<void> {
  const admin = await requireEngineAdmin();
  const tenantId = idOf(formData);
  await deleteMemoryAsAdmin(admin.id, tenantId, String(formData.get("memoryId") ?? ""));
  revalidatePath(`/engine/${tenantId}/agent/memory`);
}
