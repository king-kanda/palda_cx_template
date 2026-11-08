import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-[#78716c]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  hold: "bg-amber-50 text-amber-700",
  inquiry: "bg-sky-50 text-sky-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-50 text-rose-700",
  no_show: "bg-rose-50 text-rose-700",
  paid: "bg-emerald-50 text-emerald-700",
  sent: "bg-sky-50 text-sky-700",
  partial: "bg-amber-50 text-amber-700",
  overdue: "bg-rose-50 text-rose-700",
  draft: "bg-slate-100 text-slate-600",
  void: "bg-slate-100 text-slate-500",
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-700",
  expired: "bg-slate-100 text-slate-500",
  executed: "bg-emerald-50 text-emerald-700",
  open: "bg-amber-50 text-amber-700",
  resolved: "bg-emerald-50 text-emerald-700",
  whatsapp: "bg-emerald-50 text-emerald-700",
  staff: "bg-slate-100 text-slate-600",
  web: "bg-sky-50 text-sky-700",
  internal: "bg-slate-100 text-slate-600",
  free: "bg-emerald-50 text-emerald-700",
  booked: "bg-[#fff7ed] text-[#c2410c]",
  blocked: "bg-slate-100 text-slate-500",
  human: "bg-rose-50 text-rose-700",
  wambo: "bg-[#fff7ed] text-[#c2410c]",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${statusStyles[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[#78716c]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ? "text-[#c2410c]" : ""}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[#a8a29e]">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="card grid place-items-center p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-[#78716c]">{body}</p>
      {href && cta ? (
        <Link className="btn btn-primary mt-4" href={href}>
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

export function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
