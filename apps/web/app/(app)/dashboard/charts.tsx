"use client";

import { useState } from "react";
import { compactKes } from "@/lib/activity";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** Largest round number (1, 2, 2.5, 5 × 10ⁿ) step that splits `max` into about four bands. */
function niceScale(max: number, bands = 4) {
  if (max <= 0) return { top: bands, step: 1 };
  const raw = max / bands;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return { top: step * bands, step };
}

type MoneyPoint = { month: string; label: string; collectedKes: number; billedKes: number };

/**
 * Money in, by month: collected (brand green) beside invoiced (lime), one shared KES axis. Hovering or focusing a month
 * shows both exact figures; a visually hidden table carries the same numbers for screen readers.
 */
export function MoneyChart({ data, currentMonth }: { data: MoneyPoint[]; currentMonth: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...data.flatMap((d) => [d.collectedKes, d.billedKes]));
  const { top, step } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => top - i * step);
  const pct = (v: number) => `${Math.max(0, (v / top) * 100)}%`;

  if (max === 0) {
    return (
      <div className="grid h-[15rem] place-items-center rounded-xl border border-dashed border-line text-center text-sm text-ink-muted">
        <p className="max-w-xs">No payments or invoices in the last 12 months yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-[15rem]">
        {/* Y axis */}
        <div className="relative w-12 shrink-0 text-[0.6875rem] text-ink-subtle tabular">
          {ticks.map((t) => (
            <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: pct(top - t) }}>
              {compactKes(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" onMouseLeave={() => setActive(null)}>
          {/* Grid */}
          {ticks.map((t) => (
            <div
              key={t}
              aria-hidden
              className={`absolute inset-x-0 h-px ${t === 0 ? "bg-line" : "bg-line/60"}`}
              style={{ top: pct(top - t) }}
            />
          ))}

          {/* Bars */}
          <div className="absolute inset-0 flex items-stretch">
            {data.map((d, i) => {
              const on = active === i;
              return (
                <button
                  key={d.month}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  aria-label={`${d.label}: collected ${kes(d.collectedKes)}, invoiced ${kes(d.billedKes)}`}
                  className={`relative flex min-w-0 flex-1 items-end justify-center gap-[2px] rounded-md outline-offset-0 ${
                    on ? "bg-surface-muted" : ""
                  }`}
                >
                  <span
                    className="w-[38%] max-w-4 rounded-t-[0.25rem] bg-brand-800"
                    style={{ height: pct(d.collectedKes) }}
                  />
                  <span className="w-[38%] max-w-4 rounded-t-[0.25rem] bg-lime-400" style={{ height: pct(d.billedKes) }} />
                  {on ? (
                    <span
                      role="tooltip"
                      className={`pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-lg ${
                        i > data.length - 4 ? "right-0" : i < 3 ? "left-0" : "left-1/2 -translate-x-1/2"
                      }`}
                    >
                      <span className="block text-xs font-semibold text-ink">{d.label}</span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                        <span className="size-2 rounded-full bg-brand-800" /> Collected
                        <span className="ml-auto pl-4 font-semibold text-ink tabular">{kes(d.collectedKes)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                        <span className="size-2 rounded-full bg-lime-400 ring-1 ring-brand-800/20" /> Invoiced
                        <span className="ml-auto pl-4 font-semibold text-ink tabular">{kes(d.billedKes)}</span>
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* X axis */}
      <div className="ml-12 flex">
        {data.map((d) => (
          <span
            key={d.month}
            className={`flex-1 pt-2 text-center text-[0.6875rem] ${d.month === currentMonth ? "font-semibold text-ink" : "text-ink-subtle"}`}
          >
            {d.label}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>Money collected and invoiced per month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Collected</th>
            <th>Invoiced</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{d.label}</td>
              <td>{kes(d.collectedKes)}</td>
              <td>{kes(d.billedKes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type DonutSlice = { key: string; label: string; count: number; color: string };

/**
 * Share of a whole (where this month's bookings came from). Segments are separated by a surface-coloured gap; the legend
 * beside it always carries the label, share and count, so colour is never the only cue.
 */
export function Donut({ slices, centreLabel }: { slices: DonutSlice[]; centreLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.count, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.count > 0).length > 1 ? 1.6 : 0;
  let offset = 0;
  const shown = active ? slices.find((s) => s.key === active) : null;

  return (
    <div>
      <div className="relative mx-auto size-[11.5rem]">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${centreLabel}: ${total}`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-muted)" strokeWidth="13" />
          {total > 0
            ? slices.map((s) => {
                if (s.count === 0) return null;
                const len = (s.count / total) * c;
                const el = (
                  <circle
                    key={s.key}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={active === s.key ? 15 : 13}
                    strokeDasharray={`${Math.max(0.01, len - gap)} ${c}`}
                    strokeDashoffset={-offset}
                    onMouseEnter={() => setActive(s.key)}
                    onMouseLeave={() => setActive(null)}
                    className="transition-[stroke-width] duration-150"
                  >
                    <title>{`${s.label}: ${s.count}`}</title>
                  </circle>
                );
                offset += len;
                return el;
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xs text-ink-muted">{shown ? shown.label : centreLabel}</p>
            <p className="text-[2rem] font-bold leading-tight tabular">{shown ? shown.count : total}</p>
          </div>
        </div>
      </div>

      <ul className="mt-5 space-y-2.5">
        {slices.map((s) => {
          const share = total ? Math.round((s.count / total) * 100) : 0;
          return (
            <li
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              className="flex items-center gap-3 text-sm"
            >
              <span
                className={`w-11 rounded-md py-0.5 text-center text-xs font-semibold tabular ${
                  active === s.key ? "bg-brand-800 text-white" : "bg-surface-muted text-ink"
                }`}
              >
                {share}%
              </span>
              <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="font-semibold tabular">{s.count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
