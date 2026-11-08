import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { getSettings, withPrincipal } from "@garden/services";
import { MobileNav, SideNav } from "@/components/nav";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  let settings;
  try {
    settings = await withPrincipal(principalOf(session), (ctx) => getSettings(ctx));
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <SideNav businessName={settings.tenant.name} vertical={settings.vertical} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />
        <header className="flex items-center justify-between border-b border-[#e7e5e0] bg-white/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="text-xs text-[#78716c]">
            <span className="font-medium text-[#1c1917]">{settings.tenant.name}</span>
            <span className="mx-2">·</span>
            <span className="capitalize">{settings.vertical}</span>
            <span className="mx-2">·</span>
            <span>Africa/Nairobi</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold">{session.name}</p>
              <p className="text-[11px] capitalize text-[#78716c]">{session.role}</p>
            </div>
            <form action={logoutAction}>
              <button className="btn btn-secondary !px-3 !py-1.5 text-xs">Sign out</button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
