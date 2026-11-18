"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlaskConical, SendHorizontal } from "lucide-react";

/** Message pane that opens scrolled to the newest message, like WhatsApp. */
export function ThreadScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return (
    <div ref={ref} className="wa-wallpaper min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-[6%]">
      {children}
    </div>
  );
}

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The message bar, with two modes:
 *  - Reply: a staff message that goes out on WhatsApp (and pauses the agent in this chat),
 *  - Test as customer: pretends to be the customer so you can see how the agent answers. In mock mode nothing leaves the
 *    app; with live WhatsApp the agent's answer IS delivered to the real customer, and the bar says so.
 * Enter sends, Shift+Enter adds a new line.
 */
export function Composer({
  replyAction,
  testAction,
  conversationId,
  customerFirstName,
  agentName,
  human,
  live,
}: {
  live: boolean;
  replyAction: Action;
  testAction: Action;
  conversationId: string;
  customerFirstName: string;
  agentName: string;
  human: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"reply" | "test">("reply");
  const test = mode === "test";

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 pb-3 pt-2.5">
      <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Message mode">
        {(
          [
            ["reply", "Reply"],
            ["test", "Test as customer"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === id ? (id === "test" ? "bg-info-100 text-info-600" : "bg-brand-100 text-brand-800") : "text-ink-muted hover:bg-surface-muted"
            }`}
          >
            {id === "test" ? <FlaskConical className="size-3.5" /> : null}
            {label}
          </button>
        ))}
      </div>

      <form ref={formRef} key={mode} action={test ? testAction : replyAction} className="flex items-end gap-2">
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="text"
          required
          rows={1}
          autoFocus={false}
          placeholder={test ? `Type as ${customerFirstName}, e.g. “Is the gazebo free on Saturday?”` : `Message ${customerFirstName}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (e.currentTarget.value.trim()) formRef.current?.requestSubmit();
            }
          }}
          className={`max-h-32 min-h-[2.625rem] flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-ink-subtle focus:bg-surface ${
            test ? "border-info-600/30 bg-info-100/40 focus:border-info-600" : "border-line bg-surface-muted focus:border-brand-700"
          }`}
        />
        <button
          type="submit"
          aria-label={test ? `Run ${agentName}` : "Send"}
          className={`grid size-[2.625rem] shrink-0 place-items-center rounded-full text-white transition-colors ${
            test ? "bg-info-600 hover:opacity-90" : "bg-brand-800 hover:bg-brand-900"
          }`}
        >
          <SendHorizontal className="size-[1.125rem]" />
        </button>
      </form>

      <p className={`mt-1.5 text-[0.6875rem] ${test && live ? "font-medium text-warning-600" : "text-ink-subtle"}`}>
        {test
          ? live
            ? `Careful: WhatsApp is live, so ${agentName}'s answer will be sent to ${customerFirstName}.`
            : `${agentName} answers as if ${customerFirstName} had written this. Mock mode: nothing leaves the app.`
          : human
            ? `Goes out on WhatsApp. ${agentName} stays paused in this chat until you hand it back.`
            : `Goes out on WhatsApp and pauses ${agentName} in this chat.`}{" "}
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
