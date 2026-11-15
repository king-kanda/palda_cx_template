import { requireEngineAdmin } from "@/lib/engine-auth";

export const dynamic = "force-dynamic";

/** Everything under the Engine console needs a signed-in Palda admin. The chrome (top bar, sidebar) is per area. */
export default async function EngineConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireEngineAdmin();
  return children;
}
