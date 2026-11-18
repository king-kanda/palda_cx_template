"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { Separator } from "@/components/shadcn/separator";
import { SidebarTrigger } from "@/components/shadcn/sidebar";
import { LogoMark } from "@/components/ui";

const TABS = [
  { href: "/engine", label: "Overview", match: (p: string) => p === "/engine" },
  {
    href: "/engine/customers",
    label: "Customers",
    match: (p: string) => p === "/engine/customers" || p === "/engine/new" || /^\/engine\/[0-9a-f-]{36}/.test(p),
  },
  { href: "/engine/sources", label: "Data sources", match: (p: string) => p.startsWith("/engine/sources") },
  { href: "/engine/settings", label: "Settings", match: (p: string) => p.startsWith("/engine/settings") },
];

/**
 * The Engine header, in palda-homes proportions (72 px, hairline bottom border, translucent surface).
 *  - "full": fleet pages. Logo, tabs, account menu, spanning the page.
 *  - "workspace": a customer's workspace. The sidebar carries the logo, so this is the content column's header:
 *    sidebar toggle, tabs, account menu.
 */
export function EngineTopbar({
  adminName,
  logout,
  variant,
}: {
  adminName: string;
  logout: () => void | Promise<void>;
  variant: "full" | "workspace";
}) {
  const pathname = usePathname();
  const signOut = useRef<HTMLFormElement>(null);
  const initials =
    adminName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
      <div
        className={`flex h-18 items-center gap-3 px-4 md:px-6 ${variant === "full" ? "mx-auto max-w-[90rem]" : ""}`}
      >
        {variant === "workspace" ? (
          <>
            <SidebarTrigger aria-label="Toggle the workspace menu" className="-ml-1 size-10 rounded-full text-ink-muted hover:bg-surface-muted" />
            <Separator orientation="vertical" className="mr-1 !h-5" />
          </>
        ) : (
          <Link href="/engine" className="mr-3 flex items-center gap-2">
            <LogoMark className="size-7 text-brand-800" />
            <span className="text-lg font-bold tracking-tight">palda cx</span>
            <span className="rounded-md bg-lime-400 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-brand-900">
              engine
            </span>
          </Link>
        )}

        <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Engine">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-lime-400 text-brand-900" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto">
          {/* shadcn DropdownMenu (Radix): focus management, arrow keys, Escape to close. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className="grid size-10 place-items-center rounded-full bg-lime-400 text-sm font-bold text-brand-900 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-2xl p-2">
              <DropdownMenuLabel className="px-3 py-2 font-normal">
                <span className="block text-sm font-semibold">{adminName}</span>
                <span className="block text-xs text-ink-muted">Palda CX team</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="rounded-xl px-3 py-2" onSelect={() => signOut.current?.requestSubmit()}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <form ref={signOut} action={logout} hidden />
        </div>
      </div>
    </header>
  );
}
