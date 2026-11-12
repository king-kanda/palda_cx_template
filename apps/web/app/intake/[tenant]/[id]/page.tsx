import { notFound } from "next/navigation";
import { getIntakeForm, getTenantBySlug, systemPrincipal, withPrincipal } from "@garden/services";
import { dateTime } from "@/lib/format";
import { submitIntakeAction } from "./actions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const metadata = { title: "Session intake · Garden Booking OS" };

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const { tenant: tenantSlug, id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) notFound();

  let form: Awaited<ReturnType<typeof getIntakeForm>>;
  try {
    form = await withPrincipal(systemPrincipal(tenant.id, "intake-form"), (ctx) =>
      getIntakeForm(ctx, id),
    );
  } catch {
    notFound();
  }

  if (form.cancelled) {
    return (
      <main className="min-h-screen grid place-items-center px-4 py-12">
        <div className="w-full max-w-xl card p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#c2410c] text-2xl">
            🌿
          </div>
          <h1 className="text-xl font-semibold">This booking was cancelled</h1>
          <p className="mt-2 text-sm text-[#78716c]">
            The form is closed. Contact {form.businessName} if you need a new session.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#c2410c] text-2xl">
            🌿
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Session intake</h1>
          <p className="mt-1 text-sm text-[#78716c]">
            {form.businessName} · {form.offeringName} · {dateTime(form.startsAt)}
          </p>
        </div>

        <form action={submitIntakeAction} className="card p-6 space-y-4">
          <input type="hidden" name="bookingId" value={form.bookingId} />
          <input type="hidden" name="tenant" value={tenant.slug} />

          <p className="text-sm text-[#57534e]">
            Hi {form.customerName.split(" ")[0] || "there"} — a few quick questions so the session
            starts on time. Only {form.businessName} sees these answers.
          </p>

          {query.submitted ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Thank you — your answers were received. You can update them below if something
              changes.
            </p>
          ) : null}
          {query.error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {query.error}
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              What is the session about?
            </label>
            <input
              className="input"
              name="topic"
              required
              minLength={3}
              maxLength={160}
              defaultValue={form.answers.topic}
              placeholder="e.g. Q1 planning workshop for the leadership team"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Who will attend?
            </label>
            <input
              className="input"
              name="attendees"
              maxLength={200}
              defaultValue={form.answers.attendees}
              placeholder="Names or roles, and how many people"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              What should we prepare?
            </label>
            <textarea
              className="input min-h-24"
              name="goals"
              maxLength={1000}
              defaultValue={form.answers.goals}
              placeholder="Outcomes you want, decisions to make, material to review"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Anything else? <span className="font-normal normal-case">(optional)</span>
            </label>
            <textarea
              className="input min-h-20"
              name="notes"
              maxLength={2000}
              defaultValue={form.answers.notes}
              placeholder="Access needs, dietary notes, links"
            />
          </div>

          <label className="flex items-start gap-2 text-sm text-[#57534e]">
            <input className="mt-1 h-4 w-4" type="checkbox" name="consent" required />
            <span>
              {form.businessName} may use these answers to prepare for this session. They are
              stored encrypted and are not sent to the booking assistant.
            </span>
          </label>

          <button className="btn btn-primary w-full">
            {form.submittedAt ? "Update answers" : "Send answers"}
          </button>

          {form.submittedAt ? (
            <p className="text-center text-xs text-[#78716c]">
              Last sent {dateTime(form.submittedAt)}.
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
