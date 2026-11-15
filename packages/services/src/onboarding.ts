import { eq } from "drizzle-orm";
import { getDb, schema, withTenant } from "@garden/db";
import { passwordHash } from "@garden/integrations";
import { getPreset, VERTICAL_IDS, type WorkingHours } from "@garden/verticals";
import { z } from "zod";
import { findAccountsByEmail, generateTempPassword } from "./accounts";
import { ValidationError } from "./types";

/** Addresses that would collide with app routes or look official. */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "intake",
  "login",
  "logout",
  "onboarding",
  "signup",
  "www",
  "wambo",
  "support",
  "system",
]);

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const day = z
  .object({ open: time, close: time })
  .refine((d) => d.close > d.open, { message: "Closing time must be after opening time" })
  .nullable();

/** A small image embedded in the agent profile. Kept tiny (the browser resizes it before upload). */
export const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const AVATAR_MAX_CHARS = 280_000; // ~200 KB of image once base64-decoded

export const agentProfileSchema = z.object({
  name: z.string().trim().min(2, "Give the agent a name").max(40),
  tone: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(1500).default(""),
  /** "name": may say hello with its first name on the first message of a chat. "none": never introduces itself. */
  intro: z.enum(["name", "none"]).default("name"),
  avatar: z
    .string()
    .max(AVATAR_MAX_CHARS, "That picture is too large")
    .regex(AVATAR_PATTERN, "Use a PNG, JPEG or WebP picture")
    .nullable()
    .optional(),
});

export const onboardingSchema = z.object({
  /** "setup": the Palda team is still preparing it, and the owner cannot sign in. "active": live. */
  status: z.enum(["setup", "active"]).default("active"),
  agent: agentProfileSchema.optional(),
  vertical: z.enum(VERTICAL_IDS),
  businessName: z.string().trim().min(2, "Enter your business name").max(120),
  /**
   * Internal short name, used in public intake links and callback URLs. People never type it: when omitted
   * it is generated from the business name (and made unique).
   */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
      "Use 3-40 letters, numbers or hyphens (no spaces), starting and ending with a letter or number",
    )
    .optional(),
  location: z.string().trim().max(160).default(""),
  description: z.string().trim().max(600).default(""),
  reviewLink: z.union([z.literal(""), z.string().trim().url("Enter a full link starting with https://").max(300)]).default(""),
  resources: z
    .array(
      z.object({
        name: z.string().trim().min(2, "Name each team member or space").max(80),
        kind: z.enum(["space", "staff", "room", "equipment"]),
        capacity: z.number().int().positive().max(100000).nullable().optional(),
      }),
    )
    .min(1, "Add at least one")
    .max(30),
  offerings: z
    .array(
      z.object({
        name: z.string().trim().min(2, "Name each service").max(120),
        resourceKind: z.enum(["space", "staff", "room", "equipment"]),
        durationMin: z.number().int().min(5).max(1440 * 3),
        basePriceKes: z.number().int().min(0).max(100_000_000),
        depositPct: z.number().int().min(0).max(100).nullable().optional(),
        bufferBeforeMin: z.number().int().min(0).max(240).default(0),
        bufferAfterMin: z.number().int().min(0).max(240).default(0),
        attributes: z.record(z.unknown()).default({}),
      }),
    )
    .min(1, "Add at least one service")
    .max(40),
  workingHours: z.object({ "0": day, "1": day, "2": day, "3": day, "4": day, "5": day, "6": day }),
  depositPct: z.number().int().min(0).max(100),
  cancellationNoticeHours: z.number().int().min(0).max(720),
  owner: z.object({
    name: z.string().trim().min(2, "Enter your name").max(100),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
    /** Omit it when the Palda team sets the account up: a password is issued at rollout instead. */
    password: z.string().min(8, "Use at least 8 characters").max(200).optional(),
  }),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;

export type OnboardingResult = {
  tenantId: string;
  slug: string;
  vertical: string;
  status: "setup" | "active";
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
};

/** "Sparkle Cleaners Ltd." -> "sparkle-cleaners-ltd" (3-32 chars). */
export function slugifyBusinessName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "business"}-cx`.slice(0, 32);
}

async function pickSlug(businessName: string): Promise<string> {
  const base = slugifyBusinessName(businessName);
  if (await isSlugAvailable(base)) return base;
  for (let n = 2; n <= 9; n += 1) {
    const candidate = `${base.slice(0, 30)}-${n}`;
    if (await isSlugAvailable(candidate)) return candidate;
  }
  return `${base.slice(0, 26)}-${crypto.randomUUID().slice(0, 4)}`;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const clean = slug.trim().toLowerCase();
  if (RESERVED_SLUGS.has(clean)) return false;
  const existing = await getDb().query.tenants.findFirst({
    where: eq(schema.tenants.slug, clean),
    columns: { id: true },
  });
  return !existing;
}

function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : "";
  const code = (error as { code?: string } | null)?.code ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "23505" || /duplicate key|unique constraint/i.test(text);
}

/**
 * Creates a new business (tenant) from a vertical preset: config, owner login, team, services and add-ons.
 * No demo bookings or customers are created. The tenant row is inserted with a pre-generated id and the RLS
 * tenant context set first, so this also works under the restricted application role.
 */
export async function createBusiness(raw: OnboardingInput): Promise<OnboardingResult> {
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new ValidationError(`${where}${first?.message ?? "Invalid details"}`, parsed.error.flatten());
  }
  const input = parsed.data;
  const preset = getPreset(input.vertical);

  for (const resource of input.resources) {
    if (!preset.resourceKinds.includes(resource.kind)) {
      throw new ValidationError(`${preset.title} businesses can't have a "${resource.kind}" resource.`);
    }
  }
  for (const offering of input.offerings) {
    if (!input.resources.some((r) => r.kind === offering.resourceKind)) {
      throw new ValidationError(
        `"${offering.name}" needs at least one ${offering.resourceKind} resource, but none were added.`,
      );
    }
  }
  // One email = one business, so people can sign in with just their email and password.
  if ((await findAccountsByEmail(input.owner.email)).length > 0) {
    throw new ValidationError("That email is already registered. Sign in instead, or use a different email.");
  }
  let slug: string;
  if (input.slug) {
    if (RESERVED_SLUGS.has(input.slug)) throw new ValidationError(`"${input.slug}" is reserved. Choose a different name.`);
    if (!(await isSlugAvailable(input.slug))) throw new ValidationError(`The short name "${input.slug}" is taken.`);
    slug = input.slug;
  } else {
    slug = await pickSlug(input.businessName);
  }

  const tenantId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const workingHours = Object.fromEntries(
    Object.entries(input.workingHours).map(([key, value]) => [Number(key), value]),
  ) as WorkingHours;
  const opens = Object.values(workingHours)
    .filter((d): d is { open: string; close: string } => d !== null)
    .map((d) => d.open)
    .sort();

  // FAQ: keep only entries that are safe for any business, then add ones generated from this business's own answers.
  const faq: { q: string; a: string }[] = preset.faq
    .filter((f) => !f.needsReview && !/cancellation/i.test(f.q))
    .map(({ q, a }) => ({ q, a }));
  faq.push({
    q: "What is your cancellation policy?",
    a: `Please give at least ${input.cancellationNoticeHours} hours notice to reschedule or cancel.`,
  });
  if (input.location) faq.unshift({ q: "Where are you located?", a: `We are in ${input.location}.` });

  const facts =
    input.description ||
    `${input.businessName} is a ${preset.title.toLowerCase()}${input.location ? ` in ${input.location}` : ""}.`;

  try {
    await withTenant(tenantId, async (tx) => {
      await tx.insert(schema.tenants).values({
        id: tenantId,
        slug,
        name: input.businessName,
        vertical: input.vertical,
        timezone: "Africa/Nairobi",
        currency: "KES",
        status: input.status,
      });
      await tx.insert(schema.tenantVertical).values({
        tenantId,
        vertical: input.vertical,
        presetVersion: preset.version,
      });
      await tx.insert(schema.tenantConfig).values([
        {
          tenantId,
          key: "policies",
          value: {
            depositPct: input.depositPct,
            taxPct: preset.defaults.taxPct,
            holdHours: preset.defaults.holdHours,
            cancellationNoticeHours: input.cancellationNoticeHours,
          },
        },
        {
          tenantId,
          key: "business",
          value: {
            workingHours,
            slotIntervalMin: preset.defaults.slotIntervalMin,
            arrivalTime: opens[0] ?? "09:00",
            facts,
            faq,
            ...(input.location ? { location: input.location } : {}),
            ...(input.reviewLink ? { reviewLink: input.reviewLink } : {}),
          },
        },
        {
          tenantId,
          key: "brand",
          value: {
            agentName: input.agent?.name ?? preset.agent.name,
            accent: "#1E4D3F",
            ...(input.agent?.tone ? { tone: input.agent.tone } : {}),
            ...(input.agent?.notes ? { agentNotes: input.agent.notes } : {}),
            ...(input.agent?.intro === "none" ? { agentIntro: "none" } : {}),
            ...(input.agent?.avatar ? { agentAvatar: input.agent.avatar } : {}),
          },
        },
      ]);
      await tx.insert(schema.users).values({
        id: ownerId,
        tenantId,
        email: input.owner.email,
        name: input.owner.name,
        // Without a password the account gets an unguessable one nobody knows; rollout issues the real one.
        passwordHash: passwordHash(input.owner.password ?? generateTempPassword() + generateTempPassword()),
        role: "owner",
      });
      await tx.insert(schema.resources).values(
        input.resources.map((r, index) => ({
          tenantId,
          kind: r.kind,
          name: r.name,
          capacity: r.capacity ?? null,
          attributes: {},
          sortOrder: index,
        })),
      );
      await tx.insert(schema.offerings).values(
        input.offerings.map((o) => ({
          tenantId,
          name: o.name,
          resourceKind: o.resourceKind,
          durationMin: o.durationMin,
          basePriceKes: o.basePriceKes,
          depositPct: o.depositPct ?? null,
          bufferBeforeMin: o.bufferBeforeMin,
          bufferAfterMin: o.bufferAfterMin,
          attributes: o.attributes,
        })),
      );
      if (preset.addons.length > 0) {
        await tx.insert(schema.addons).values(preset.addons.map((a) => ({ tenantId, ...a })));
      }
      await tx.insert(schema.auditLog).values({
        tenantId,
        actor: `user:${ownerId}`,
        action: "tenant.onboarded",
        entity: "tenant",
        entityId: tenantId,
        diff: {
          vertical: input.vertical,
          resources: input.resources.length,
          offerings: input.offerings.length,
          addons: preset.addons.length,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationError("Someone just took that business name or email. Please try again.");
    }
    throw error;
  }

  return {
    tenantId,
    slug,
    vertical: input.vertical,
    status: input.status,
    ownerId,
    ownerName: input.owner.name,
    ownerEmail: input.owner.email,
  };
}
