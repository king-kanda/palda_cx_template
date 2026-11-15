"use client";

import { useActionState, useState } from "react";
import { HoursEditor, hoursProblem, type Hours } from "../../components/hours-editor";
import { saveBusinessAction, type EngineFormState } from "./actions";

export type BusinessFormValues = {
  name: string;
  location: string;
  description: string;
  reviewLink: string;
  workingHours: Hours;
  depositPct: number;
  cancellationNoticeHours: number;
};

export function BusinessForm({ tenantId, values }: { tenantId: string; values: BusinessFormValues }) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(saveBusinessAction, {});
  const [hours, setHours] = useState<Hours>(
    Object.fromEntries(Object.entries(values.workingHours).map(([k, v]) => [String(k), v ?? null])),
  );
  const problem = hoursProblem(hours);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="workingHours" value={JSON.stringify(hours)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="biz-name" className="mb-1.5 block text-sm font-medium">
            Business name
          </label>
          <input id="biz-name" name="name" className="input" defaultValue={values.name} required />
        </div>
        <div>
          <label htmlFor="biz-location" className="mb-1.5 block text-sm font-medium">
            Location
          </label>
          <input
            id="biz-location"
            name="location"
            className="input"
            defaultValue={values.location}
            placeholder="e.g. Kilimani, Nairobi"
          />
        </div>
      </div>

      <div>
        <label htmlFor="biz-description" className="mb-1.5 block text-sm font-medium">
          What the agent says about them
        </label>
        <textarea id="biz-description" name="description" className="input min-h-24" defaultValue={values.description} />
      </div>

      <div>
        <label htmlFor="biz-review" className="mb-1.5 block text-sm font-medium">
          Google review link
        </label>
        <input
          id="biz-review"
          name="reviewLink"
          type="url"
          className="input"
          defaultValue={values.reviewLink}
          placeholder="https://g.page/r/their-business/review"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="biz-deposit" className="mb-1.5 block text-sm font-medium">
            Deposit to confirm (%)
          </label>
          <input
            id="biz-deposit"
            name="depositPct"
            type="number"
            min={0}
            max={100}
            className="input"
            defaultValue={values.depositPct}
          />
        </div>
        <div>
          <label htmlFor="biz-cancel" className="mb-1.5 block text-sm font-medium">
            Cancellation notice (hours)
          </label>
          <input
            id="biz-cancel"
            name="cancellationNoticeHours"
            type="number"
            min={0}
            max={720}
            className="input"
            defaultValue={values.cancellationNoticeHours}
          />
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium">Opening hours</span>
        <HoursEditor value={hours} onChange={setHours} />
        {problem ? <p className="mt-2 text-xs text-danger-600">{problem}</p> : null}
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-xl border border-success-600/30 bg-success-100 px-3 py-2 text-sm text-success-600">
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button className="btn btn-primary" disabled={pending || problem !== null}>
          {pending ? "Saving…" : "Save business"}
        </button>
      </div>
    </form>
  );
}
