"use client";

import { useActionState, useState } from "react";
import { AvatarPicker } from "../../components/avatar-picker";
import { saveAgentAction, type EngineFormState } from "./actions";

const NAME_IDEAS = ["Zuri", "Amani", "Imani", "Neema", "Baraka", "Tumaini", "Wambo"];

export function AgentForm({
  tenantId,
  agent,
}: {
  tenantId: string;
  agent: { name: string; tone: string; notes: string; intro: "name" | "none"; avatar: string | null };
}) {
  const [state, action, pending] = useActionState<EngineFormState, FormData>(saveAgentAction, {});
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState<string | null>(agent.avatar);
  const [changed, setChanged] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="avatarChanged" value={changed ? "1" : "0"} />
      <input type="hidden" name="avatar" value={avatar ?? ""} />

      <div>
        <label htmlFor="agent-name" className="mb-1.5 block text-sm font-medium">
          Agent name
        </label>
        <input
          id="agent-name"
          name="name"
          className="input"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {NAME_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setName(idea)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
            >
              {idea}
            </button>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium">First message of a new chat</legend>
        <div className="space-y-2">
          {[
            { value: "name", title: "Say hello with the name", hint: "e.g. “Hi, it’s " + "{name}" + "”. Said once, in passing." },
            { value: "none", title: "Don’t introduce, just carry on", hint: "Starts straight in on what the customer needs." },
          ].map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-brand-800 has-[:checked]:bg-surface-muted">
              <input type="radio" name="intro" value={o.value} defaultChecked={agent.intro === o.value} className="mt-1 accent-[#1E4D3F]" />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-ink-muted">{o.hint.replace("{name}", name || "Zuri")}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-muted">The agent never calls itself an AI or a bot. If a customer sincerely asks what they are talking to, it won’t claim to be a person.</p>
      </fieldset>

      <div>
        <span className="mb-1.5 block text-sm font-medium">Picture</span>
        <AvatarPicker
          name={name}
          value={avatar}
          onChange={(next) => {
            setAvatar(next);
            setChanged(true);
          }}
        />
      </div>

      <div>
        <label htmlFor="agent-tone" className="mb-1.5 block text-sm font-medium">
          Voice
        </label>
        <input
          id="agent-tone"
          name="tone"
          className="input"
          defaultValue={agent.tone}
          placeholder="warm, concise, Kenyan English with a little Swahili"
        />
      </div>

      <div>
        <label htmlFor="agent-notes" className="mb-1.5 block text-sm font-medium">
          Extra instructions
        </label>
        <textarea
          id="agent-notes"
          name="notes"
          className="input min-h-28"
          maxLength={1500}
          defaultValue={agent.notes}
          placeholder="Anything specific to this customer. The agent follows these in every conversation."
        />
        <p className="mt-1 text-xs text-ink-muted">
          Added to the agent&apos;s instructions on top of the ones that come with the type of business.
        </p>
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
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save agent"}
        </button>
      </div>
    </form>
  );
}
