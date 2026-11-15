import { describe, expect, it } from "vitest";
import {
  BRAND_DEFAULTS,
  BRAND_PRESETS,
  brandCss,
  brandSchema,
  checkBrandColors,
  checkSidebar,
  contrast,
  deriveSidebar,
  deriveTheme,
  hexToRgb,
  mix,
  parseBrand,
  rgbToHex,
} from "../../packages/services/src/brand";
import { renderInvoicePdf, type InvoicePdfData } from "../../packages/integrations/src/pdf";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("colour maths", () => {
  it("converts and mixes", () => {
    expect(hexToRgb("#1E4D3F")).toEqual([30, 77, 63]);
    expect(rgbToHex([30, 77, 63])).toBe("#1e4d3f");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#123456", 0.7)).toBe("#123456");
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#1E4D3F", "#FFFFFF")).toBeGreaterThan(8);
  });
});

describe("brand colours are checked for readability", () => {
  it("every shipped palette passes, and so does the default", () => {
    for (const p of BRAND_PRESETS) expect(checkBrandColors(p.primary, p.accent), p.name).toEqual([]);
    expect(checkBrandColors(BRAND_DEFAULTS.primary, BRAND_DEFAULTS.accent)).toEqual([]);
  });

  it("derived text/background pairs are readable for every palette", () => {
    for (const p of BRAND_PRESETS) {
      const t = deriveTheme(p.primary, p.accent);
      expect(contrast("#FFFFFF", t["--color-brand-800"]!), `${p.name} white on main`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--color-lime-400"]!, t["--color-brand-900"]!), `${p.name} dark on accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rejects a main colour too light for white text", () => {
    expect(checkBrandColors("#DDDDDD", "#B6EB8F")[0]).toMatch(/too light/);
    expect(checkBrandColors("#F4D35E", "#B6EB8F")[0]).toMatch(/too light/);
  });

  it("rejects an accent too close to the main colour", () => {
    expect(checkBrandColors("#1E4D3F", "#245A49").join(" ")).toMatch(/accent/i);
  });

  it("rejects malformed colours", () => {
    expect(checkBrandColors("green", "#B6EB8F")[0]).toMatch(/Use colours/);
    expect(checkBrandColors("#12345", "#B6EB8F")[0]).toMatch(/Use colours/);
  });

  it("derives the exact variables the app uses", () => {
    expect(Object.keys(deriveTheme("#0F4C81", "#8FD3F4")).sort()).toEqual(
      ["--color-brand-100", "--color-brand-700", "--color-brand-800", "--color-brand-900", "--color-lime-100", "--color-lime-300", "--color-lime-400"].sort(),
    );
  });
});

describe("sidebar colour", () => {
  it("is optional: the default is the white sidebar and emits no sidebar CSS", () => {
    expect(brandCss(parseBrand({ colors: { primary: "#0F4C81", accent: "#8FD3F4" } }))).not.toContain("--sb-");
    expect(parseBrand(undefined).sidebar).toBe("");
  });

  it("picks white text on a dark sidebar and dark text on a light one, and keeps every pair readable", () => {
    const dark = deriveSidebar("#14201B");
    expect(dark["--sb-fg"]).toBe("#ffffff");
    const light = deriveSidebar("#F4EFE6");
    expect(light["--sb-fg"]).toBe("#14201b");
    for (const bg of ["#14201B", "#1E4D3F", "#0F4C81", "#5B2A6B", "#8A3B1E", "#F4EFE6", "#FFFFFF", "#E8F1FA", "#000000"]) {
      const t = deriveSidebar(bg);
      expect(contrast(t["--sb-fg"]!, t["--sb-bg"]!), `${bg} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["--sb-muted"]!, t["--sb-bg"]!), `${bg} muted text`).toBeGreaterThanOrEqual(4.5);
      expect(Object.keys(t).sort()).toEqual(["--sb-bg", "--sb-border", "--sb-fg", "--sb-hover", "--sb-muted"]);
    }
  });

  it("accepts dark and light sidebars and refuses mid-tones where neither text colour is readable", () => {
    expect(checkSidebar("#14201B", "#B6EB8F")).toEqual([]);
    expect(checkSidebar("#1E4D3F", "#B6EB8F")).toEqual([]);
    expect(checkSidebar("#FFFFFF", "#B6EB8F")).toEqual([]);
    expect(checkSidebar("#F4EFE6", "#8FD3F4")).toEqual([]); // cream with a sky-blue accent: the current page still stands out
    expect(checkSidebar("#F4EFE6", "#B6EB8F")[0]).toMatch(/accent/i); // cream with pale lime: it would barely show
    expect(checkSidebar("#808080", "#B6EB8F")[0]).toMatch(/middle/);
    expect(checkSidebar("#7C7C7C", "#B6EB8F")[0]).toMatch(/middle/); // the narrow band where white and dark text are both poor
    expect(checkSidebar("#7A8F85", "#B6EB8F")).toEqual([]); // dark text reads fine on this one (about 4.8:1), so it is allowed
    expect(checkSidebar("blue", "#B6EB8F")[0]).toMatch(/Use a sidebar colour/);
  });

  it("refuses a sidebar the accent would disappear on", () => {
    expect(checkSidebar("#B8EC92", "#B6EB8F")[0]).toMatch(/accent/i);
  });

  it("is included in the whole-brand check", () => {
    expect(checkBrandColors("#0F4C81", "#8FD3F4", "#14201B")).toEqual([]);
    expect(checkBrandColors("#0F4C81", "#8FD3F4", "#808080")[0]).toMatch(/middle/);
  });

  it("every palette works with a main-colour, darker and charcoal sidebar", () => {
    for (const p of BRAND_PRESETS) {
      for (const bg of [p.primary, mix(p.primary, "#000000", 0.45), "#14201B", "#FFFFFF"]) {
        expect(checkSidebar(bg, p.accent), `${p.name} on ${bg}`).toEqual([]);
      }
    }
  });

  it("emits only validated hex values, and ignores a tampered or unreadable stored sidebar", () => {
    const ok = brandCss(parseBrand({ colors: { primary: "#0F4C81", accent: "#8FD3F4" }, sidebar: "#14201B" }));
    expect(ok).toContain("--sb-bg:#14201b");
    expect(ok).toContain("--color-brand-800:#0f4c81");
    expect(ok).toMatch(/^:root\{(--[a-z0-9-]+:#[0-9a-f]{6};?)+\}$/);
    for (const bad of ["red;}body{display:none}", "#808080", "url(javascript:alert(1))", "#12345"]) {
      const css = brandCss(parseBrand({ sidebar: bad }));
      expect(css, bad).toBe("");
    }
  });

  it("works with the default colours too (a business that only chose a sidebar)", () => {
    const css = brandCss(parseBrand({ sidebar: "#14201B" }));
    expect(css).toContain("--sb-bg:#14201b");
    expect(css).not.toContain("--color-brand-800");
  });

  it("the schema accepts empty or a hex colour only", () => {
    const ok = { primary: "#0F4C81", accent: "#8FD3F4" };
    expect(brandSchema.safeParse({ ...ok, sidebar: "" }).success).toBe(true);
    expect(brandSchema.safeParse({ ...ok, sidebar: "#14201B" }).success).toBe(true);
    expect(brandSchema.safeParse({ ...ok, sidebar: "dark" }).success).toBe(false);
    expect(brandSchema.parse(ok).sidebar).toBe("");
  });
});

describe("parseBrand and brandCss", () => {
  it("falls back to the default theme and injects nothing when no brand was chosen", () => {
    const b = parseBrand(undefined);
    expect(b.custom).toBe(false);
    expect(b.primary).toBe(BRAND_DEFAULTS.primary);
    expect(b.logo).toBeNull();
    expect(brandCss(b)).toBe("");
    // onboarding historically stored the main colour under "accent": that alone is not a chosen brand
    expect(parseBrand({ agentName: "Zuri", accent: "#1E4D3F" }).custom).toBe(false);
  });

  it("uses a chosen palette and emits CSS only for valid colours", () => {
    const b = parseBrand({ colors: { primary: "#0F4C81", accent: "#8FD3F4" }, logo: PIXEL, website: "https://x.example" });
    expect(b.custom).toBe(true);
    expect(b.logo).toBe(PIXEL);
    const css = brandCss(b);
    expect(css).toMatch(/^:root\{/);
    expect(css).toContain("--color-brand-800:#0f4c81");
  });

  it("never injects CSS from a tampered or unreadable stored colour", () => {
    expect(brandCss(parseBrand({ colors: { primary: "red;}body{display:none}/*", accent: "#8FD3F4" } }))).toBe("");
    expect(brandCss(parseBrand({ colors: { primary: "#EEEEEE", accent: "#8FD3F4" } }))).toBe(""); // not readable: ignored
    const css = brandCss(parseBrand({ colors: { primary: "#0F4C81", accent: "#8FD3F4" } }));
    expect(css).not.toMatch(/<|@import|url\(|expression/i);
    expect(css).toMatch(/^:root\{(--[a-z0-9-]+:#[0-9a-f]{6};?)+\}$/);
  });

  it("ignores a stored logo that is not a safe image", () => {
    expect(parseBrand({ logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }).logo).toBeNull();
    expect(parseBrand({ logo: "javascript:alert(1)" }).logo).toBeNull();
    expect(parseBrand({ logo: "https://evil.example/x.png" }).logo).toBeNull();
  });
});

describe("brandSchema", () => {
  const ok = { primary: "#0F4C81", accent: "#8FD3F4" };

  it("accepts a normal brand and fills the defaults", () => {
    const r = brandSchema.safeParse({ ...ok, website: "https://www.example.co.ke", email: "a@b.co", phone: "+254 700 000 000" });
    expect(r.success).toBe(true);
  });

  it.each([
    [{ ...ok, website: "http://insecure.example" }, /https/],
    [{ ...ok, website: "javascript:alert(1)" }, /https/],
    [{ ...ok, instagram: "instagram.com/x" }, /https/],
    [{ ...ok, email: "not an email" }, /valid email/],
    [{ ...ok, phone: "call me" }, /phone/],
    [{ ...ok, tagline: "x".repeat(91) }, /tagline/i],
    [{ ...ok, primary: "blue" }, /colour/],
    [{ ...ok, logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }, /PNG, JPEG or WebP/],
    [{ ...ok, logo: "data:image/png;base64," + "A".repeat(300_000) }, /too large/],
  ])("rejects %j", (input, why) => {
    const r = brandSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toMatch(why);
  });

  it("null removes the logo and absent leaves it alone", () => {
    expect(brandSchema.parse({ ...ok, logo: null }).logo).toBeNull();
    expect(brandSchema.parse({ ...ok }).logo).toBeUndefined();
  });
});

describe("the invoice PDF wears the brand", () => {
  const base: InvoicePdfData = {
    businessName: "Sparkle Cleaners",
    invoiceNumber: "INV-2026-0001",
    kind: "deposit",
    status: "sent",
    issuedAt: new Date(),
    dueAt: new Date(),
    customerName: "Amina",
    customerPhone: "+254711000001",
    bookingDate: "20 Dec 2026",
    items: [{ description: "Deposit", qty: 1, unitPriceKes: 1000 }],
    subtotalKes: 1000,
    discountKes: 0,
    taxKes: 0,
    totalKes: 1000,
    paidKes: 0,
    balanceKes: 1000,
  };

  it("renders with a logo, colours and contact details", async () => {
    const buf = await renderInvoicePdf({
      ...base,
      businessAddress: "Westlands, Nairobi",
      brand: { primary: "#0F4C81", primaryLight: "#E7F0F8", logo: PIXEL, website: "https://www.sparkle.example", email: "hello@sparkle.example", phone: "+254 711 333 444", tagline: "A spotless home" },
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1500);
  });

  it("renders without a brand, and skips a logo it cannot draw (webp)", async () => {
    const plain = await renderInvoicePdf(base);
    expect(plain.subarray(0, 5).toString()).toBe("%PDF-");
    const webp = await renderInvoicePdf({ ...base, brand: { primary: "#0F4C81", primaryLight: "#E7F0F8", logo: "data:image/webp;base64,UklGRg==" } });
    expect(webp.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
