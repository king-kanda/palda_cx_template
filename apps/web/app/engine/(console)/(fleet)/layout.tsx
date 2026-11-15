import { requireEngineAdmin } from "@/lib/engine-auth";
import { EngineTopbar } from "../../components/topbar";
import { engineLogoutAction } from "../../login/actions";

export const dynamic = "force-dynamic";

/** Fleet pages (Overview, Customers, Data sources, New customer): a full-width top bar, no sidebar. */
export default async function FleetLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireEngineAdmin();
  return (
    <div className="min-h-screen">
      <EngineTopbar variant="full" adminName={admin.name} logout={engineLogoutAction} />
      {children}
    </div>
  );
}
