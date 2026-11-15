import { z } from "zod";

/**
 * Business branding. Set up by the Palda team in the Engine and applied across the customer's app, their public pages and
 * their invoices. A brand is two colours, a logo, a website, social links and contact details.
 *
 * The app's design uses a few colour variables (a dark brand green with lighter tints, and a light accent). A tenant brand
 * replaces them with tints derived from the two chosen colours, so every screen picks the brand up without per-page work.
 * Colours are checked for readable contrast, because a pale "brand" colour under white button text would be unreadable.
 */

export const BRAND_DEFAULTS = { primary: "#1E4D3F", accent: "#B6EB8F" } as const;

/** Logos are small data URLs (png, jpeg or webp), like agent pictures. The PDF renderer only supports png and jpeg. */
export const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const LOGO_MAX_CHARS = 280_000;

const HEX = /^#[0-9a-fA-F]{6}$/;

/* ───────────────────────────────── colour maths ───────────────────────────────── */

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mixes `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/* ───────────────────────────────────── theme ───────────────────────────────────── */

/** The CSS variables a brand overrides. Keys are the app's own token names. */
export function deriveTheme(primary: string, accent: string): Record<string, string> {
  return {
    "--color-brand-900": mix(primary, "#000000", 0.28),
    "--color-brand-800": primary.toLowerCase(),
    "--color-brand-700": mix(primary, "#ffffff", 0.16),
    "--color-brand-100": mix(primary, "#ffffff", 0.88),
    "--color-lime-400": accent.toLowerCase(),
    "--color-lime-300": mix(accent, "#ffffff", 0.35),
    "--color-lime-100": mix(accent, "#ffffff", 0.85),
  };
}

/** Why a pair of colours can't be used, in plain words. Empty when it is fine. */
export function checkBrandColors(primary: string, accent: string): string[] {
  const problems: string[] = [];
  if (!HEX.test(primary) || !HEX.test(accent)) return ["Use colours written like #1E4D3F."];
  if (contrast(primary, "#FFFFFF") < 4.5) {
    problems.push("The main colour is too light: white text on it would be hard to read. Pick a darker one.");
  }
  const dark = deriveTheme(primary, accent)["--color-brand-900"]!;
  if (contrast(accent, dark) < 4.5) {
    problems.push("The accent colour is too close to the main colour: active menu items would be hard to read. Pick a lighter accent or a darker main colour.");
  }
  if (contrast(accent, "#FFFFFF") < 1.15) problems.push("The accent colour is almost white and would disappear on the page.");
  return problems;
}

/** Ready-made palettes for the Engine. Every one passes `checkBrandColors`. */
export const BRAND_PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: "Forest", primary: "#1E4D3F", accent: "#B6EB8F" },
  { name: "Ocean", primary: "#0F4C81", accent: "#8FD3F4" },
  { name: "Plum", primary: "#5B2A6B", accent: "#F3B6E8" },
  { name: "Terracotta", primary: "#8A3B1E", accent: "#F7C78B" },
  { name: "Slate", primary: "#2F3E4E", accent: "#A8E6CF" },
  { name: "Berry", primary: "#8C1D40", accent: "#FFC9D6" },
  { name: "Mustard", primary: "#6B4E00", accent: "#F4D35E" },
];

/* ───────────────────────────────────── schema ───────────────────────────────────── */

const https = (label: string) =>
  z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https:\/\/[^\s]+\.[^\s]+$/i.test(v), { message: `${label} must start with https://` })
    .default("");

export const brandSchema = z.object({
  /** null removes the logo; undefined leaves it as it is. */
  logo: z
    .string()
    .max(LOGO_MAX_CHARS, "That logo is too large")
    .regex(LOGO_PATTERN, "Use a PNG, JPEG or WebP logo")
    .nullable()
    .optional(),
  primary: z.string().trim().regex(HEX, "Use a colour like #1E4D3F").default(BRAND_DEFAULTS.primary),
  accent: z.string().trim().regex(HEX, "Use a colour like #B6EB8F").default(BRAND_DEFAULTS.accent),
  website: https("The website"),
  tagline: z.string().trim().max(90, "Keep the tagline under 90 characters").default(""),
  instagram: https("The Instagram link"),
  facebook: https("The Facebook link"),
  tiktok: https("The TikTok link"),
  linkedin: https("The LinkedIn link"),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Enter a valid email address" })
    .default(""),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v === "" || /^\+?[0-9][0-9 ()-]{6,24}$/.test(v), { message: "Enter a phone number like +254 700 000 000" })
    .default(""),
});

export type BrandInput = z.input<typeof brandSchema>;

/** What the rest of the app reads. Always complete: missing values fall back to the defaults. */
export type Brand = {
  logo: string | null;
  primary: string;
  accent: string;
  /** True when the business has chosen its own colours (so the app should override the default theme). */
  custom: boolean;
  website: string;
  tagline: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  linkedin: string;
  email: string;
  phone: string;
};

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const hexOr = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);

/** Reads the stored brand JSON defensively. Anything malformed falls back to the default. */
export function parseBrand(raw: Record<string, unknown> | null | undefined): Brand {
  const b = raw ?? {};
  const primary = hexOr(b.accent, BRAND_DEFAULTS.primary); // historical key: onboarding stored the main colour as "accent"
  const stored = (b.colors ?? {}) as Record<string, unknown>;
  const mainColour = hexOr(stored.primary, primary);
  const accentColour = hexOr(stored.accent, BRAND_DEFAULTS.accent);
  const custom = typeof stored.primary === "string" && HEX.test(stored.primary);
  const logo = typeof b.logo === "string" && LOGO_PATTERN.test(b.logo) && b.logo.length <= LOGO_MAX_CHARS ? b.logo : null;
  return {
    logo,
    primary: custom ? mainColour : BRAND_DEFAULTS.primary,
    accent: custom ? accentColour : BRAND_DEFAULTS.accent,
    custom: custom && checkBrandColors(mainColour, accentColour).length === 0,
    website: str(b.website),
    tagline: str(b.tagline, 90),
    instagram: str(b.instagram),
    facebook: str(b.facebook),
    tiktok: str(b.tiktok),
    linkedin: str(b.linkedin),
    email: str(b.email, 120),
    phone: str(b.phone, 30),
  };
}

/** The CSS to inject for a brand, or "" when it uses the default theme. Only validated hex values ever reach it. */
export function brandCss(brand: Brand): string {
  if (!brand.custom) return "";
  const vars = deriveTheme(brand.primary, brand.accent);
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}
