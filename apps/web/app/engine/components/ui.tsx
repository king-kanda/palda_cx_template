import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { AttentionItem, Bucket, RunOutcome } from "@garden/services";

/** Chart colours, from the palda-homes palette (UI-SPEC 2.1): brand-800, danger-600, #4A7F6E, #A6CF8B. */
export const CHART = {
  runs: "#1E4D3F",
  attention: "#D64545",
  cost: "#4A7F6E",
  response: "#A6CF8B",
} as const;

export const fmtKes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export function fmtMs(ms: number): string {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;
}

export function ago(value: Date | string | null): string {
  if (!value) return "no recorded runs";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Small uppercase mono label, as in the reference console. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted ${className}`}>{children}</p>;
}

export function PageHeader({
  crumbs,
  title,
  subtitle,
  action,
}: {
  crumbs?: { label: string; href?: string }[];
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-2 font-mono text-xs text-ink-muted">
          {crumbs.map((c, i) => (
            <span key={c.label}>
              {i > 0 ? " / " : ""}
              {c.href ? (
                <Link href={c.href} className="hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                c.label
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-8">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

/** palda-homes KPI tile: 40 px icon tile, 28 px bold tabular value, muted label (UI-SPEC section 4). */
export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "warn" | "danger";
}) {
  const valueColor = tone === "danger" ? "text-danger-600" : tone === "warn" ? "text-warning-600" : "text-ink";
  return (
    <div className="card min-w-0 p-5">
      {Icon ? (
        <span className="grid size-10 place-items-center rounded-xl bg-surface-muted text-brand-800">
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      ) : null}
      <p className={`${Icon ? "mt-4" : ""} text-sm text-ink-muted`}>{label}</p>
      <p className={`mt-1 text-[28px] font-bold leading-9 tabular ${valueColor}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card min-w-0 p-5 ${className}`}>
      {title || aside ? (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {aside ? <div className="text-sm text-ink-muted">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A row of link-pills, one active. Used for the Today / Week / Month switch and the filter chips. */
export function PillTabs({
  items,
  className = "",
}: {
  items: { label: string; href: string; active: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
            item.active
              ? "border-brand-800 bg-brand-800 text-white"
              : "border-line bg-surface text-ink hover:bg-surface-muted"
          }`}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className={`font-mono text-xs ${item.active ? "text-white/80" : "text-ink-muted"}`}>{item.count}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

const OUTCOME: Record<RunOutcome, { label: string; className: string }> = {
  succeeded: { label: "succeeded", className: "bg-success-100 text-success-600" },
  handoff: { label: "handed over", className: "bg-info-100 text-info-600" },
  flagged: { label: "flagged", className: "bg-danger-100 text-danger-600" },
  looping: { label: "looping", className: "bg-danger-100 text-danger-600" },
  blocked: { label: "blocked", className: "bg-warning-100 text-warning-600" },
  limit: { label: "hit a limit", className: "bg-warning-100 text-warning-600" },
};

export function OutcomePill({ outcome }: { outcome: RunOutcome }) {
  const o = OUTCOME[outcome];
  return <span className={`inline-flex items-center rounded-full px-3 py-1 font-mono text-xs ${o.className}`}>{o.label}</span>;
}

/**
 * A bar chart that renders on the server (no chart library): one bar per bucket, a hairline baseline, the first and
 * last labels underneath. `secondary` draws the attention share inside each bar in a darker tone.
 */
export function BarChart({
  buckets,
  value,
  secondary,
  color = CHART.runs,
  secondaryColor = CHART.attention,
  format = (n: number) => String(n),
}: {
  buckets: Bucket[];
  value: (b: Bucket) => number;
  secondary?: (b: Bucket) => number;
  color?: string;
  secondaryColor?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...buckets.map(value));
  const HEIGHT = 130;
  return (
    <div>
      <div className="flex items-end gap-[3px] border-b border-line" style={{ height: HEIGHT }} role="img" aria-label="Chart">
        {buckets.map((b) => {
          const v = value(b);
          const h = v === 0 ? 3 : Math.max(5, Math.round((v / max) * (HEIGHT - 6)));
          const s = secondary ? Math.min(secondary(b), v) : 0;
          return (
            <div
              key={b.key}
              title={`${b.label}: ${format(v)}${secondary && s ? ` (${s} need attention)` : ""}`}
              className="flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-t-md"
              style={{ height: h, background: color, opacity: v === 0 ? 0.35 : 1 }}
            >
              {s > 0 ? <div style={{ height: `${Math.round((s / v) * 100)}%`, background: secondaryColor }} /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-xs text-ink-muted">
        <span>{buckets[0]?.label}</span>
        <span>{buckets.at(-1)?.label}</span>
      </div>
    </div>
  );
}

const SEVERITY: Record<AttentionItem["severity"], { dot: string; label: string }> = {
  high: { dot: "bg-danger-600", label: "High" },
  medium: { dot: "bg-warning-600", label: "Medium" },
  low: { dot: "bg-ink-subtle", label: "Low" },
};

/** The ranked "what needs a decision" list. `showCustomer` is off inside a single customer's workspace. */
export function AttentionList({
  items,
  showCustomer = true,
  empty = "Nothing needs a decision right now.",
}: {
  items: AttentionItem[];
  showCustomer?: boolean;
  empty?: string;
}) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-success-100 px-4 py-3 text-sm text-success-600">
        <span className="size-2 rounded-full bg-success-600" /> {empty}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item, i) => (
        <li key={`${item.customerId}-${i}`}>
          <Link href={item.href} className="group flex items-start gap-3 py-3 hover:bg-surface-muted">
            <span className="mt-1.5 flex shrink-0 items-center gap-2" title={`${SEVERITY[item.severity].label} priority`}>
              <span className={`size-2.5 rounded-full ${SEVERITY[item.severity].dot}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">
                {showCustomer ? <span className="text-ink-muted">{item.customerName} · </span> : null}
                {item.title}
              </span>
              <span className="block text-xs text-ink-muted">{item.detail}</span>
            </span>
            <span className="mt-0.5 shrink-0 text-xs font-medium text-brand-800 opacity-0 transition-opacity group-hover:opacity-100">
              Open →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
