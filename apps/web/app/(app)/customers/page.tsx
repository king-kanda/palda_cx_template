import Link from "next/link";
import { redirect } from "next/navigation";
import { customersFor, kes } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { shortDate } from "@/lib/format";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { createCustomerAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; segment?: string; error?: string; erased?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const segment =
    params.segment === "repeat" || params.segment === "vip" || params.segment === "lapsed"
      ? params.segment
      : undefined;
  const rows = await customersFor(principalOf(session), {
    search: params.q,
    tag: params.tag,
    segment,
    limit: 200,
  });

  const totalValue = rows.reduce((sum, row) => sum + row.lifetimeValueKes, 0);
  const repeat = rows.filter((row) => row.bookingCount > 1).length;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Your CRM: history, notes, tags and lifetime value."
      />

      {params.error ? (
        <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{params.error}</p>
      ) : null}

      {params.erased ? (
        <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Customer personal data erased. Booking and payment totals were kept for accounting.
        </p>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Customers" value={rows.length} />
        <StatCard label="Repeat customers" value={repeat} />
        <StatCard label="Lifetime value" value={kes(totalValue)} accent />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="card overflow-hidden">
          <form className="flex flex-wrap items-center gap-2 border-b border-[#e7e5e0] p-3" action="/customers">
            <input
              className="input max-w-xs"
              name="q"
              placeholder="Search name, phone or email…"
              defaultValue={params.q}
            />
            <input className="input max-w-40" name="tag" placeholder="Tag" defaultValue={params.tag} />
            <select className="input max-w-40" name="segment" defaultValue={segment ?? ""}>
              <option value="">All customers</option>
              <option value="repeat">Repeat</option>
              <option value="vip">VIP (KES 100k+)</option>
              <option value="lapsed">Lapsed (90d+)</option>
            </select>
            <button className="btn btn-secondary">Search</button>
            <Link className="text-xs text-[#78716c] underline" href="/customers">
              Reset
            </Link>
          </form>

          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No customers yet"
                body="Add a customer here, or create a booking and they will appear automatically."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Tags</th>
                    <th>Bookings</th>
                    <th>Lifetime value</th>
                    <th>Last booking</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.customer.id}>
                      <td>
                        <Link
                          className="font-medium hover:text-[#c2410c]"
                          href={`/customers/${row.customer.id}`}
                        >
                          {row.customer.name}
                        </Link>
                        {row.customer.email ? (
                          <div className="text-[11px] text-[#a8a29e]">{row.customer.email}</div>
                        ) : null}
                      </td>
                      <td className="font-mono text-xs">{row.customer.phoneE164}</td>
                      <td className="space-x-1">
                        {row.customer.tags.length
                          ? row.customer.tags.map((tag) => (
                              <span key={tag} className="pill bg-[#fff7ed] text-[#c2410c]">
                                {tag}
                              </span>
                            ))
                          : "—"}
                      </td>
                      <td>{row.bookingCount}</td>
                      <td className="font-medium">{kes(row.lifetimeValueKes)}</td>
                      <td className="text-xs text-[#78716c]">{shortDate(row.lastBookingAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold">Add a customer</h2>
          <form action={createCustomerAction} className="space-y-2">
            <input className="input" name="name" placeholder="Full name" required />
            <input className="input" name="phone" placeholder="+254712345678" required />
            <input className="input" name="email" type="email" placeholder="Email (optional)" />
            <div className="flex gap-2">
              <select className="input" name="language" defaultValue="en">
                <option value="en">English</option>
                <option value="sw">Swahili</option>
              </select>
              <input className="input" name="tags" placeholder="vip, wedding" />
            </div>
            <button className="btn btn-primary w-full">Add customer</button>
          </form>
        </section>
      </div>
    </div>
  );
}
