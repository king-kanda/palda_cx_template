import Link from "next/link";
import { redirect } from "next/navigation";
import {
  customersFor,
  getSettings,
  kes,
  listAllOfferings,
  listResources,
  withPrincipal,
} from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { PageHeader } from "@/components/ui";
import { createBookingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; resourceId?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const principal = principalOf(session);

  const [offerings, resources, customers, settings] = await Promise.all([
    withPrincipal(principal, (ctx) => listAllOfferings(ctx)),
    withPrincipal(principal, (ctx) => listResources(ctx)),
    customersFor(principal, { limit: 200 }),
    withPrincipal(principal, (ctx) => getSettings(ctx)),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`New ${settings.labels.booking.toLowerCase()}`}
        subtitle="Staff bookings can be confirmed immediately; customer bookings always start as a hold."
        action={
          <Link className="btn btn-secondary" href="/bookings">
            ← Back
          </Link>
        }
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      <form action={createBookingAction} className="card space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Existing customer
            </label>
            <select className="input" name="customerId" defaultValue="">
              <option value="">— New customer —</option>
              {customers.map((row) => (
                <option key={row.customer.id} value={row.customer.id}>
                  {row.customer.name} · {row.customer.phoneE164}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                New name
              </label>
              <input className="input" name="customerName" placeholder="Wanjiku Kamau" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
                New phone
              </label>
              <input className="input" name="customerPhone" placeholder="+254712345678" />
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              {settings.labels.offering}
            </label>
            <select className="input" name="offeringId" required defaultValue={offerings[0]?.id ?? ""}>
              {offerings.map((offering) => (
                <option key={offering.id} value={offering.id}>
                  {offering.name} · {kes(offering.basePriceKes)} · {offering.durationMin} min
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              {settings.labels.resource}
            </label>
            <select
              className="input"
              name="resourceId"
              required
              defaultValue={params.resourceId ?? resources[0]?.id ?? ""}
            >
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                  {resource.capacity ? ` · up to ${resource.capacity}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Date
            </label>
            <input
              className="input"
              type="date"
              name="date"
              required
              defaultValue={params.date ?? today}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Start time
            </label>
            <input className="input" type="time" name="time" required defaultValue="09:00" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              {settings.labels.partySize}
            </label>
            <input className="input" type="number" min={1} name="partySize" defaultValue={1} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Event type
            </label>
            <select className="input" name="eventType" defaultValue="wedding">
              <option value="wedding">Wedding</option>
              <option value="corporate">Corporate</option>
              <option value="birthday">Birthday</option>
              <option value="picnic">Picnic</option>
              <option value="photoshoot">Photoshoot</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
            Status
          </label>
          <select className="input max-w-xs" name="status" defaultValue="hold">
            <option value="hold">Hold (auto-expires)</option>
            <option value="confirmed">Confirmed</option>
            <option value="inquiry">Inquiry</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
            Notes
          </label>
          <textarea className="input min-h-24" name="notes" placeholder="Setup, decor, access notes…" />
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link className="btn btn-secondary" href="/bookings">
            Cancel
          </Link>
          <button className="btn btn-primary">Create booking</button>
        </div>
      </form>
    </div>
  );
}
