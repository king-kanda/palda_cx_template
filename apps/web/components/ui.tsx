import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

/** Logo mark: four-leaf glyph from palda-homes. */
export function LogoMark({ className = "size-7 text-brand-800" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="currentColor"
        d="M11 3a8 8 0 0 0-8 8h8V3Zm2 0v8h8a8 8 0 0 0-8-8Zm-2 10H3a8 8 0 0 0 8 8v-8Zm2 0v8a8 8 0 0 0 8-8h-8Z"
      />
    </svg>
  );
}

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
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

// Tone classes are palda's Pill tones (border + 100 background + 600 text).
const tones = {
  success: "bg-success-100 text-success-600",
  warning: "bg-warning-100 text-warning-600",
  danger: "bg-danger-100 text-danger-600",
  info: "bg-info-100 text-info-600",
  neutral: "bg-neutral-100 text-neutral-600",
  brand: "bg-brand-100 text-brand-800",
} as const;

const statusTone: Record<string, keyof typeof tones> = {
  confirmed: "success",
  hold: "warning",
  inquiry: "info",
  completed: "neutral",
  cancelled: "danger",
  no_show: "danger",
  paid: "success",
  sent: "info",
  partial: "warning",
  overdue: "danger",
  draft: "neutral",
  void: "neutral",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  expired: "neutral",
  executed: "success",
  open: "warning",
  resolved: "success",
  whatsapp: "success",
  staff: "neutral",
  web: "info",
  internal: "neutral",
  free: "success",
  booked: "brand",
  blocked: "neutral",
  human: "danger",
  wambo: "brand",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${tones[statusTone[status] ?? "neutral"]}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** KPI tile (palda): icon tile, value, label. `accent` renders the brand-800 hero card. */
export function StatCard({
  label,
  value,
  hint,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  icon?: LucideIcon;
}) {
  if (accent) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-brand-800 p-5 text-white">
        {Icon ? <Icon className="size-6 text-lime-400" strokeWidth={1.75} /> : null}
        <p className={`${Icon ? "mt-4" : ""} text-xs text-white/70`}>{label}</p>
        <p className="mt-1 text-[1.75rem] font-bold leading-9 tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-white/70">{hint}</p> : null}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      {Icon ? (
        <span className="grid size-10 place-items-center rounded-xl bg-surface-muted text-brand-800">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      ) : null}
      <p className={`${Icon ? "mt-4" : ""} text-[1.75rem] font-bold leading-9 tabular-nums`}>{value}</p>
      <p className="text-sm text-ink-muted">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
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
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-lime-100 text-brand-800">
        <Inbox className="size-7" strokeWidth={1.75} />
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>
      {href && cta ? (
        <Link className="btn btn-primary mt-5" href={href}>
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

/** Card with palda's header row (h2 title left, actions right). */
export function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
