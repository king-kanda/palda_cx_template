"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  MessageCircle,
  ReceiptText,
  Settings,
  Sparkles,
  Star,
  Users,
  Wallet,
} from "lucide-react";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/invoices", label: "Invoices & Payments", icon: ReceiptText },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/reviews", label: "Reviews", icon: Star },
  { href: "/wambo", label: "Wambo", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SideNav({ businessName, vertical }: { businessName: string; vertical: string }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-[#e7e5e0] bg-[#fbfaf8] px-3 py-5 lg:flex">
      <div className="mb-7 flex items-center gap-2 px-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#c2410c] text-lg text-white">
          🌿
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{businessName}</p>
          <p className="truncate text-xs capitalize text-[#78716c]">{vertical}</p>
        </div>
      </div>

      <nav className="space-y-1">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-[#fff7ed] text-[#c2410c]"
                  : "text-[#57534e] hover:bg-white hover:text-[#1c1917]"
              }`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-[#e7e5e0] bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#c2410c]">
          <Sparkles size={14} /> Wambo
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[#78716c]">
          Your AI concierge handles WhatsApp inquiries, holds and payments. Sensitive actions wait
          for your approval.
        </p>
      </div>
    </aside>
  );
}

export function MobileNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-[#e7e5e0] bg-[#fbfaf8] px-3 py-2 lg:hidden">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-[#57534e]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function CreditIcon() {
  return <CreditCard size={16} />;
}
