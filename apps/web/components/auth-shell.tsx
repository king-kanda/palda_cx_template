import type { ReactNode } from "react";
import { LogoMark } from "@/components/ui";

/**
 * The frame every sign-in screen uses: one rounded card on the canvas, an art panel on the left with a short line about the
 * product, and the form on the right. On phones the art panel is hidden and the form takes the card.
 */
export function AuthShell({
  kicker,
  headline,
  badge,
  children,
}: {
  kicker: string;
  headline: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-8 sm:px-8">
      <div className="grid w-full max-w-[64rem] overflow-hidden rounded-[1.75rem] bg-surface p-3 shadow-[0_24px_64px_-24px_rgb(20_32_27/0.28)] lg:grid-cols-2">
        <aside className="auth-art relative hidden min-h-[38rem] flex-col justify-between overflow-hidden rounded-[1.25rem] p-8 text-white lg:flex">
          <LogoMark className="relative z-10 size-10 text-white" />
          <div className="relative z-10">
            <p className="text-sm text-white/80">{kicker}</p>
            <p className="mt-2 max-w-sm text-[1.875rem] font-semibold leading-tight">{headline}</p>
          </div>
        </aside>

        <section className="flex flex-col justify-center px-5 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-sm">
            <div className="flex items-center gap-2">
              <LogoMark className="size-7 text-brand-800" />
              {badge}
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
