"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  ClipboardList,
  LayoutGrid,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Settings,
  Star,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/ui";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/invoices", label: "Invoices & Payments", icon: ReceiptText },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/reviews", label: "Reviews", icon: Star },
  { href: "/wambo", label: "Wambo", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

const EXTRA_TITLES: Record<string, string> = { "/approvals": "Approvals" };

const iconButton =
  "relative grid size-10 place-items-center rounded-full bg-surface-muted text-ink-muted hover:bg-neutral-100 hover:text-ink";

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

// Sidebar collapsed preference, persisted like palda-homes (localStorage via useSyncExternalStore).
const COLLAPSE_KEY = "shell:collapsed";
const listeners = new Set<() => void>();
const collapsedStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  get() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  },
  server: () => false,
  toggle() {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsedStore.get() ? "0" : "1");
    } catch {
      /* storage unavailable: preference just doesn't persist */
    }
    listeners.forEach((l) => l());
  },
};

function SidebarContent({
  businessName,
  navLabels,
  collapsed,
  onNavigate,
  onToggle,
  onClose,
}: {
  businessName: string;
  navLabels: Record<string, string>;
  collapsed: boolean;
  onNavigate: () => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-18 items-center gap-2 px-5 ${collapsed ? "justify-center px-0" : ""}`}>
        <LogoMark />
        {!collapsed && (
          <span className="truncate text-lg font-bold tracking-tight text-ink">
            {businessName.toUpperCase()}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-2 text-ink-muted hover:bg-surface-muted md:hidden"
          aria-label="Close navigation"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav aria-label="Main" className={`flex-1 space-y-1 overflow-y-auto px-4 py-2 ${collapsed ? "px-3" : ""}`}>
        {NAV.map((item) => {
          const active = matches(pathname, item.href);
          const Icon = item.icon;
          const label = navLabels[item.href] ?? item.label;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              aria-current={active ? "page" : undefined}
              className={`group flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-lime-400 text-brand-900"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.75} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`space-y-3 p-4 ${collapsed ? "px-3" : ""}`}>
        {!collapsed && (
          <div className="relative overflow-hidden rounded-2xl bg-brand-800 p-4 text-white">
            <LogoMark className="pointer-events-none absolute -right-4 -top-4 size-24 text-white/10" />
            <p className="text-sm font-semibold">Wambo</p>
            <p className="mt-1 text-xs text-white/70">
              Your AI concierge handles WhatsApp inquiries, holds and payments. Sensitive actions wait
              for your approval.
            </p>
            <Link
              href="/wambo"
              onClick={onNavigate}
              className="mt-4 inline-flex h-9 items-center rounded-xl bg-lime-400 px-4 text-sm font-semibold text-brand-900 hover:bg-lime-300"
            >
              Open inbox
            </Link>
          </div>
        )}
        <button
          type="button"
          onClick={onToggle}
          className={`hidden h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-ink-muted hover:bg-surface-muted md:flex ${
            collapsed ? "justify-center px-0" : ""
          }`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </div>
  );
}

function UserMenu({
  userName,
  role,
  businessName,
  signOut,
}: {
  userName: string;
  role: string;
  businessName: string;
  signOut: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex items-center gap-3 rounded-full p-0.5 hover:bg-surface-muted md:pr-3"
      >
        <span className="grid size-10 place-items-center rounded-full bg-lime-400 text-sm font-bold text-brand-900">
          {initials(userName)}
        </span>
        <span className="hidden text-left xl:block">
          <span className="block text-sm font-semibold leading-tight">{userName}</span>
          <span className="block text-xs capitalize text-ink-muted">{role}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-semibold">{userName}</p>
            <p className="mt-1 text-xs capitalize text-ink-muted">
              {role} · {businessName}
            </p>
          </div>
          <div className="my-1 h-px bg-line" />
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-danger-600 outline-none hover:bg-surface-muted"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  businessName,
  navLabels = {},
  userName,
  role,
  signOut,
  children,
}: {
  businessName: string;
  /** Vertical-specific names for nav entries, keyed by href (e.g. "/bookings": "Jobs"). */
  navLabels?: Record<string, string>;
  userName: string;
  role: string;
  signOut: () => void | Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(collapsedStore.subscribe, collapsedStore.get, collapsedStore.server);
  const [mobileOpen, setMobileOpen] = useState(false);

  const current = [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((r) => matches(pathname, r.href));
  const title =
    (current ? (navLabels[current.href] ?? current.label) : undefined) ??
    Object.entries(EXTRA_TITLES).find(([href]) => matches(pathname, href))?.[1] ??
    "Dashboard";

  return (
    <div className="flex min-h-screen">
      {/* Desktop / tablet */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-line bg-surface transition-[width] md:block ${
          collapsed ? "w-[72px]" : "w-64"
        }`}
      >
        <SidebarContent
          businessName={businessName}
          navLabels={navLabels}
          collapsed={collapsed}
          onNavigate={() => setMobileOpen(false)}
          onToggle={collapsedStore.toggle}
          onClose={() => setMobileOpen(false)}
        />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-lg">
            <SidebarContent
              businessName={businessName}
              navLabels={navLabels}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              onToggle={collapsedStore.toggle}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-18 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className={`${iconButton} md:hidden`}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="truncate text-xl font-bold md:text-2xl">{title}</h1>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <Link href="/wambo" className={iconButton} aria-label="Wambo inbox">
              <MessageCircle className="size-5" />
            </Link>
            <Link href="/approvals" className={iconButton} aria-label="Approvals">
              <Bell className="size-5" />
            </Link>
            <UserMenu userName={userName} role={role} businessName={businessName} signOut={signOut} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6">{children}</main>

        <footer className="flex flex-wrap gap-x-6 gap-y-1 px-6 py-4 text-xs text-ink-subtle">
          <span>© 2026 {businessName}</span>
          <span>Africa/Nairobi</span>
        </footer>
      </div>
    </div>
  );
}
