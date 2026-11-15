import { deflateSync, crc32 } from "node:zlib";
import { eq } from "drizzle-orm";
import { closeDb, getDb, loadEnv, schema } from "@garden/db";
import { BRAND_PRESETS, addBusinessDocument, listBusinessDocuments, updateBrand } from "@garden/services";

loadEnv();

/**
 * Gives the demo customers their own, clearly different branding (logo, colours, website, contact) and a few sample documents,
 * so the Engine and each customer's app look like different businesses. Safe to re-run: it sets the same values each time and
 * skips documents that already exist.
 *
 *   pnpm engine:demo-brands                       # the built-in demo customers
 *   pnpm engine:demo-brands --slug acme --preset Plum   # one customer, any preset
 */
function arg(name: string): string | undefined {
  const inline = process.argv.find((v) => v.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/* ───────── a tiny PNG generator, so the demo logos need no image library ───────── */

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A 192x192 transparent logo mark: a coloured shape with a lighter shape inside it. */
function logoPng(primary: string, accent: string, shape: "circle" | "rounded" | "hex"): string {
  const size = 192;
  const [p, a] = [hex(primary), hex(accent)];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const inside = (x: number, y: number, r: number) => {
    const dx = x - c;
    const dy = y - c;
    if (shape === "circle") return dx * dx + dy * dy <= r * r;
    if (shape === "rounded") {
      const k = r * 0.35;
      const ax = Math.max(Math.abs(dx) - (r - k), 0);
      const ay = Math.max(Math.abs(dy) - (r - k), 0);
      return ax * ax + ay * ay <= k * k;
    }
    // hexagon-ish: a diamond clipped by a circle
    return Math.abs(dx) + Math.abs(dy) <= r * 1.35 && dx * dx + dy * dy <= r * r * 1.1;
  };
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const o = row + 1 + x * 4;
      let px: Rgb | null = null;
      if (inside(x, y, 88)) px = p;
      if (inside(x, y, 46)) px = a;
      if (px) {
        raw[o] = px[0];
        raw[o + 1] = px[1];
        raw[o + 2] = px[2];
        raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

/* ───────────────────────────── the demo customers ───────────────────────────── */

type Demo = {
  slug: string;
  preset: string;
  shape: "circle" | "rounded" | "hex";
  tagline: string;
  website: string;
  instagram: string;
  facebook: string;
  email: string;
  phone: string;
  docs: { title: string; kind: string; filename: string; text: string }[];
};

const DEMOS: Demo[] = [
  {
    slug: "palda",
    preset: "Terracotta",
    shape: "circle",
    tagline: "Gardens for every occasion",
    website: "https://www.paldagardens.example",
    instagram: "https://instagram.com/paldagardens",
    facebook: "https://facebook.com/paldagardens",
    email: "events@paldagardens.example",
    phone: "+254 700 111 222",
    docs: [
      {
        title: "2026 venue price list",
        kind: "price_list",
        filename: "palda-gardens-price-list-2026.txt",
        text: "PALDA GARDENS - 2026 VENUE PRICES\n\nHalf Day (up to 5 hours): KES 25,000\nFull Day (up to 10 hours): KES 45,000\nWhole Garden Weekend: KES 80,000\n\nDeposit: 30% to hold the date.\nPrices exclude catering and sound.\n",
      },
      {
        title: "Terms and cancellation policy",
        kind: "terms",
        filename: "palda-gardens-terms.txt",
        text: "PALDA GARDENS - TERMS\n\n1. A date is held for 48 hours until the deposit is paid.\n2. Cancel free of charge up to 72 hours before the event.\n3. Music ends at 22:00.\n4. The hirer is responsible for any damage.\n",
      },
    ],
  },
  {
    slug: "sparkle",
    preset: "Ocean",
    shape: "rounded",
    tagline: "A spotless home, every time",
    website: "https://www.sparklecleaners.example",
    instagram: "https://instagram.com/sparklecleaners",
    facebook: "https://facebook.com/sparklecleaners",
    email: "hello@sparklecleaners.example",
    phone: "+254 711 333 444",
    docs: [
      {
        title: "Cleaning price guide",
        kind: "price_list",
        filename: "sparkle-price-guide.txt",
        text: "SPARKLE CLEANERS - PRICE GUIDE\n\nStandard clean (about 3 hours): KES 3,000\nDeep clean (about 5 hours): KES 6,000\nMove-out clean: KES 9,000\n\nWe bring our own supplies and equipment.\n",
      },
      {
        title: "Service agreement template",
        kind: "template",
        filename: "sparkle-service-agreement.txt",
        text: "SPARKLE CLEANERS - SERVICE AGREEMENT\n\nClient: ______________________\nAddress: ______________________\nService: ______________________\nDate and time: ______________________\n\nPlease give at least 24 hours notice to reschedule or cancel.\n",
      },
    ],
  },
];

async function apply(demo: Demo, adminId: string, presetName: string) {
  const preset = BRAND_PRESETS.find((p) => p.name.toLowerCase() === presetName.toLowerCase());
  if (!preset) throw new Error(`Unknown palette "${presetName}". Choose one of: ${BRAND_PRESETS.map((p) => p.name).join(", ")}.`);
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, demo.slug) });
  if (!tenant) {
    console.log(`skip  ${demo.slug}: no such customer`);
    return;
  }
  await updateBrand(adminId, tenant.id, {
    logo: logoPng(preset.primary, preset.accent, demo.shape),
    primary: preset.primary,
    accent: preset.accent,
    website: demo.website,
    tagline: demo.tagline,
    instagram: demo.instagram,
    facebook: demo.facebook,
    email: demo.email,
    phone: demo.phone,
  });
  const existing = new Set((await listBusinessDocuments(tenant.id)).map((d) => d.title));
  let added = 0;
  for (const doc of demo.docs) {
    if (existing.has(doc.title)) continue;
    await addBusinessDocument(adminId, tenant.id, { title: doc.title, kind: doc.kind, filename: doc.filename, bytes: new TextEncoder().encode(doc.text) });
    added += 1;
  }
  console.log(`done  ${demo.slug}: ${preset.name} (${preset.primary} / ${preset.accent}), logo, ${added} new document${added === 1 ? "" : "s"}`);
}

async function main() {
  const admin = await getDb().query.platformAdmins.findFirst();
  if (!admin) {
    console.error("There is no Engine admin yet. Create one with: pnpm engine:admin");
    process.exit(1);
  }
  const slug = arg("slug");
  if (slug) {
    const base = DEMOS.find((d) => d.slug === slug) ?? {
      slug,
      preset: arg("preset") ?? "Forest",
      shape: "circle" as const,
      tagline: "",
      website: "",
      instagram: "",
      facebook: "",
      email: "",
      phone: "",
      docs: [],
    };
    await apply(base, admin.id, arg("preset") ?? base.preset);
  } else {
    for (const demo of DEMOS) await apply(demo, admin.id, demo.preset);
  }
  await closeDb();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});
