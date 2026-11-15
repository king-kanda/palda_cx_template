import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { brandCss, getSettings, withPrincipal } from "@garden/services";
import { AppShell } from "@/components/shell";
import { logoutAction } from "@/app/login/actions";
import { exitImpersonationAction } from "./impersonation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  let settings;
  try {
    settings = await withPrincipal(principalOf(session), (ctx) => getSettings(ctx));
  } catch {
    redirect("/login");
  }

  // The business's own colours, set in the Engine. Empty (so the default theme) unless a valid brand was chosen. Only validated
  // hex colours ever reach this string.
  const css = brandCss(settings.brand);

  return (
    <>
    {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
    <AppShell
      businessName={settings.tenant.name}
      logo={settings.brand.logo}
      navLabels={{
        "/bookings": settings.labels.bookings,
        "/customers": settings.labels.customers,
      }}
      agent={{ name: settings.agentName, avatar: settings.agentAvatar }}
      impersonation={
        session.impersonator
          ? { adminName: session.impersonator.name, exit: exitImpersonationAction }
          : undefined
      }
      userName={session.name}
      role={session.role}
      signOut={logoutAction}
    >
      {children}
    </AppShell>
    </>
  );
}
