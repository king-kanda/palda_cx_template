"use client";

export type Hours = Record<string, { open: string; close: string } | null>;

const DAY_ORDER = ["1", "2", "3", "4", "5", "6", "0"] as const;
const DAY_NAMES: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
};

/** The first problem with a week of opening hours, or null when it is fine. */
export function hoursProblem(hours: Hours): string | null {
  for (const day of DAY_ORDER) {
    const h = hours[day];
    if (h && !(h.close > h.open)) return `${DAY_NAMES[day]}: closing time must be after opening time.`;
  }
  if (Object.values(hours).every((h) => h === null || h === undefined)) return "Open on at least one day.";
  return null;
}

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (next: Hours) => void }) {
  return (
    <ul className="space-y-2">
      {DAY_ORDER.map((day) => {
        const h = value[day] ?? null;
        return (
          <li key={day} className="flex flex-wrap items-center gap-3">
            <label className="flex w-36 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-brand-800"
                checked={h !== null}
                onChange={(e) => onChange({ ...value, [day]: e.target.checked ? { open: "09:00", close: "17:00" } : null })}
              />
              {DAY_NAMES[day]}
            </label>
            {h ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  className="input w-32"
                  aria-label={`${DAY_NAMES[day]} opens`}
                  value={h.open}
                  onChange={(e) => onChange({ ...value, [day]: { ...h, open: e.target.value } })}
                />
                <span className="text-ink-muted">to</span>
                <input
                  type="time"
                  className="input w-32"
                  aria-label={`${DAY_NAMES[day]} closes`}
                  value={h.close}
                  onChange={(e) => onChange({ ...value, [day]: { ...h, close: e.target.value } })}
                />
              </div>
            ) : (
              <span className="text-sm text-ink-subtle">Closed</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
