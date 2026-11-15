import { notFound } from "next/navigation";
import { NotFoundError, getEngineCustomer } from "@garden/services";
import { SidebarInset, SidebarProvider } from "@/components/shadcn/sidebar";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { EngineTopbar } from "../../components/topbar";
import { engineLogoutAction } from "../../login/actions";
import { openCustomerAppAction } from "./actions";
import { WorkspaceSidebar } from "./workspace-nav";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const admin = await requireEngineAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  let customer: Awaited<ReturnType<typeof getEngineCustomer>>;
  try {
    customer = await getEngineCustomer(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const summary = `${customer.agent.name} · ${customer.counts.resources} team · ${customer.counts.offerings} services`;
  return (
    // shadcn Sidebar (Radix): collapsible to an icon rail, and a sheet on phones. 256 px wide, like palda-homes.
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "4.5rem" } as React.CSSProperties}>
      <WorkspaceSidebar
        id={customer.id}
        name={customer.name}
        status={customer.status}
        summary={summary}
        agentName={customer.agent.name}
        agentAvatar={customer.agent.avatar}
        openApp={openCustomerAppAction}
      />
      <SidebarInset className="min-w-0 bg-canvas">
        <EngineTopbar variant="workspace" adminName={admin.name} logout={engineLogoutAction} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
