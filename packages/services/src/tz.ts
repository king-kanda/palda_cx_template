/**
 * Nairobi is UTC+3 all year (no DST), so fixed-offset parsing is exact and
 * avoids pulling a timezone database into hot paths.
 */
export const NAIROBI_TZ = "Africa/Nairobi";
export const NAIROBI_OFFSET = "+03:00";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function nairobiParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const weekdayShort = get("weekday");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    minute: Number(get("minute")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** YYYY-MM-DD in Nairobi. */
export function dateKey(date: Date): string {
  const p = nairobiParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Parse a Nairobi-local date + HH:mm into a UTC instant. */
export function nairobiTime(dateKeyValue: string, time = "00:00"): Date {
  const [y, m, d] = dateKeyValue.split("-").map(Number);
  const [hh = NaN, mm = NaN] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) {
    throw new Error(`Invalid Nairobi date/time: ${dateKeyValue} ${time}`);
  }
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm, 0, 0));
}

export function addDays(dateKeyValue: string, days: number): string {
  const base = nairobiTime(dateKeyValue, "12:00");
  base.setUTCDate(base.getUTCDate() + days);
  return dateKey(base);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function startOfNairobiDay(dateKeyValue: string): Date {
  return nairobiTime(dateKeyValue, "00:00");
}

export function endOfNairobiDay(dateKeyValue: string): Date {
  return nairobiTime(addDays(dateKeyValue, 1), "00:00");
}

export function nextDateKeys(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

export function weekdayOf(dateKeyValue: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return nairobiParts(nairobiTime(dateKeyValue, "12:00")).weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function weekdayName(dateKeyValue: string): string {
  return WEEKDAY_NAMES[weekdayOf(dateKeyValue)] ?? "Sunday";
}

export function monthKeyOf(date: Date): string {
  const p = nairobiParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function monthBounds(monthKeyValue: string): { start: Date; end: Date; startKey: string; endKey: string } {
  const [y, m] = monthKeyValue.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1, -3, 0, 0));
  const nextMonth = new Date(Date.UTC(y!, m!, 1, -3, 0, 0));
  return {
    start,
    end: nextMonth,
    startKey: dateKey(start),
    endKey: dateKey(new Date(nextMonth.getTime() - 1)),
  };
}

export function monthMatrix(monthKeyValue: string): string[] {
  const { startKey, endKey } = monthBounds(monthKeyValue);
  const firstWeekday = weekdayOf(startKey);
  const totalDays = Number(endKey.slice(8, 10));
  const cells: string[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push("");
  for (let d = 1; d <= totalDays; d += 1) {
    cells.push(`${monthKeyValue}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push("");
  return cells;
}

export function formatNairobi(
  date: Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" },
): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: NAIROBI_TZ, ...options }).format(date);
}

export function formatNairobiTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatNairobiDateTime(date: Date): string {
  return `${formatNairobi(date)} · ${formatNairobiTime(date)}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function humanDateKey(dateKeyValue: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(nairobiTime(dateKeyValue, "12:00"));
}

export function isPast(date: Date, now = new Date()): boolean {
  return date.getTime() < now.getTime();
}
