import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { schema } from "@garden/db";
import {
  getConfigMap,
  getSettings,
  kes,
  listAllAddons,
  listAllOfferings,
  listResources,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { titleCase } from "@/lib/format";
import { PageHeader, Section, StatusPill } from "@/components/ui";
import {
  createAddonAction,
  createOfferingAction,
  createResourceAction,
  deactivateResourceAction,
  saveBusinessAction,
  savePoliciesAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [settings, config, resources, offerings, addons] = await Promise.all([
    withPrincipal(principal, (ctx) => getSettings(ctx)),
    withPrincipal(principal, (ctx) => getConfigMap(ctx)),
    withPrincipal(principal, (ctx) => listResources(ctx)),
    withPrincipal(principal, (ctx) => listAllOfferings(ctx)),
    withPrincipal(principal, (ctx) => listAllAddons(ctx)),
  ]);

  const business = (config.business as Record<string, unknown> | undefined) ?? {};
  const team = await withPrincipal(principal, (ctx) =>
    ctx.db.query.users.findMany({
      where: eq(schema.users.tenantId, session.tenantId),
      columns: { id: true, name: true, email: true, role: true, active: true },
      orderBy: (u, { asc }) => [asc(u.name)],
    }),
  );

  const mcpUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/api/mcp`;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configuration, not code. Everything here is tenant-scoped."
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Policies">
          <form action={savePoliciesAction} className="grid gap-3 sm:grid-cols-2">
            <NumberField label="Deposit %" name="depositPct" value={settings.depositPct} />
            <NumberField label="Tax %" name="taxPct" value={settings.taxPct} />
            <NumberField label="Hold expiry (hours)" name="holdHours" value={settings.holdHours} />
            <NumberField
              label="Cancellation notice (hours)"
              name="cancellationNoticeHours"
              value={settings.cancellationNoticeHours}
            />
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn btn-primary text-xs">Save policies</button>
            </div>
          </form>
        </Section>

        <Section title="Business">
          <form action={saveBusinessAction} className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Slot interval (min)"
              name="slotIntervalMin"
              value={settings.slotIntervalMin}
            />
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                Arrival time
              </label>
              <input className="input" name="arrivalTime" defaultValue={settings.arrivalTime} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                Location
              </label>
              <input
                className="input"
                name="location"
                defaultValue={String(business.location ?? "Karen, Nairobi")}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button className="btn btn-secondary text-xs">Save business</button>
            </div>
          </form>
        </Section>

        <Section title={`${titleCase(settings.labels.resource)}s`}>
          <p className="mb-3 text-xs text-[#78716c]">
            Spaces, staff, rooms or equipment. Parent spaces block their children.
          </p>
          <ul className="mb-3 divide-y divide-[#f5f5f4]">
            {resources.map((resource) => (
              <li key={resource.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{resource.name}</p>
                  <p className="text-[11px] capitalize text-[#a8a29e]">
                    {resource.kind}
                    {resource.capacity ? ` · up to ${resource.capacity}` : ""}
                  </p>
                </div>
                <form action={deactivateResourceAction}>
                  <input type="hidden" name="resourceId" value={resource.id} />
                  <button className="text-[11px] font-medium text-rose-600">Disable</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={createResourceAction} className="grid gap-2 sm:grid-cols-2">
            <input className="input" name="name" placeholder="Name" required />
            <select className="input" name="kind" defaultValue="space">
              <option value="space">Space</option>
              <option value="staff">Staff</option>
              <option value="room">Room</option>
              <option value="equipment">Equipment</option>
            </select>
            <input className="input" type="number" name="capacity" placeholder="Capacity" />
            <select className="input" name="parentResourceId" defaultValue="">
              <option value="">No parent</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary text-xs sm:col-span-2">Add resource</button>
          </form>
        </Section>

        <Section title={`${titleCase(settings.labels.offering)}s & pricing`}>
          <ul className="mb-3 divide-y divide-[#f5f5f4]">
            {offerings.map((offering) => (
              <li key={offering.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{offering.name}</p>
                  <p className="text-[11px] text-[#a8a29e]">
                    {offering.durationMin} min · {offering.resourceKind}
                  </p>
                </div>
                <span className="font-medium">{kes(offering.basePriceKes)}</span>
              </li>
            ))}
          </ul>
          <form action={createOfferingAction} className="grid gap-2 sm:grid-cols-2">
            <input className="input sm:col-span-2" name="name" placeholder="Package name" required />
            <select className="input" name="resourceKind" defaultValue="space">
              <option value="space">Space</option>
              <option value="staff">Staff</option>
              <option value="room">Room</option>
              <option value="equipment">Equipment</option>
            </select>
            <input
              className="input"
              type="number"
              name="durationMin"
              placeholder="Duration (min)"
              defaultValue={60}
              required
            />
            <input
              className="input"
              type="number"
              name="basePriceKes"
              placeholder="Price KES"
              required
            />
            <input className="input" type="number" name="bufferBeforeMin" placeholder="Buffer before" defaultValue={0} />
            <input className="input" type="number" name="bufferAfterMin" placeholder="Buffer after" defaultValue={0} />
            <button className="btn btn-secondary text-xs sm:col-span-2">Add package</button>
          </form>
        </Section>

        <Section title="Add-ons">
          <ul className="mb-3 divide-y divide-[#f5f5f4]">
            {addons.map((addon) => (
              <li key={addon.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{addon.name}</span>
                <span className="font-medium">
                  {kes(addon.priceKes)} / {addon.unit}
                </span>
              </li>
            ))}
          </ul>
          <form action={createAddonAction} className="grid gap-2 sm:grid-cols-3">
            <input className="input" name="name" placeholder="Add-on name" required />
            <input className="input" type="number" name="priceKes" placeholder="Price KES" required />
            <input className="input" name="unit" placeholder="each" defaultValue="each" />
            <button className="btn btn-secondary text-xs sm:col-span-3">Add add-on</button>
          </form>
        </Section>

        <Section title="Team">
          <ul className="divide-y divide-[#f5f5f4]">
            {team.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-[11px] text-[#a8a29e]">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="pill bg-slate-100 capitalize text-slate-600">{member.role}</span>
                  {member.active ? (
                    <span className="pill bg-emerald-50 text-emerald-700">active</span>
                  ) : (
                    <span className="pill bg-rose-50 text-rose-700">inactive</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Integrations">
          <dl className="space-y-3 text-sm">
            <Integration
              label="WhatsApp"
              value={process.env.WHATSAPP_MODE === "cloud" ? "Cloud API" : "Mock mode"}
              hint="Set WHATSAPP_MODE=cloud and credentials in .env to go live."
            />
            <Integration
              label="M-Pesa"
              value={process.env.MPESA_MODE === "daraja" ? "Daraja" : "Mock mode"}
              hint="Daraja STK + C2B callbacks. Mock mode can simulate success."
            />
            <Integration
              label="MCP endpoint"
              value={mcpUrl}
              hint="Per-tenant bearer tokens. Issue with pnpm --filter @garden/mcp-server issue-token."
            />
            <Integration
              label="Agent model"
              value={
                process.env.OPENROUTER_API_KEY
                  ? `OpenRouter · ${process.env.WAMBO_MODEL ?? "default"}`
                  : "Mock model"
              }
              hint="Set OPENROUTER_API_KEY (and optionally WAMBO_MODEL) for real LLM calls."
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn btn-secondary text-xs" href="/wambo/settings">
              Wambo settings
            </Link>
            <Link className="btn btn-secondary text-xs" href="/api/mcp">
              MCP endpoint
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <StatusPill status={settings.vertical} />
            <span className="text-xs text-[#a8a29e]">
              Vertical preset {settings.preset.version} · {settings.labels.booking.toLowerCase()} terminology
            </span>
          </div>
        </Section>
      </div>
    </div>
  );
}

function NumberField({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
        {label}
      </label>
      <input className="input" type="number" name={name} defaultValue={value} />
    </div>
  );
}

function Integration({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-[#f5f5f4] p-3">
      <div className="flex items-center justify-between gap-2">
        <dt className="font-medium">{label}</dt>
        <dd className="text-xs font-mono text-[#57534e]">{value}</dd>
      </div>
      <p className="mt-1 text-[11px] text-[#a8a29e]">{hint}</p>
    </div>
  );
}
