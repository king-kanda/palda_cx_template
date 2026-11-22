"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlaskConical, Reply, SendHorizontal } from "lucide-react";

/** Message pane that opens scrolled to the newest message. */
export function ThreadScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return (
    <div ref={ref} className="wa-wallpaper min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 md:px-[5%]">
      {children}
    </div>
  );
}

type Action = (formData: FormData) => void | Promise<void>;

/**
 * The message box, with two modes:
 *  - Reply: a staff message that goes out on WhatsApp (and pauses the agent in this chat),
 *  - Test as customer: pretends to be the customer so you can see how the agent answers. In mock mode nothing leaves the
 *    app; with live WhatsApp the agent's answer IS delivered to the real customer, and the box says so.
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
  const [text, setText] = useState("");
  const test = mode === "test";

  const note = test
    ? live
      ? `Careful: WhatsApp is live, so ${agentName}'s answer will be sent to ${customerFirstName}.`
      : `${agentName} answers as if ${customerFirstName} wrote this. Mock mode: nothing leaves the app.`
    : human
      ? `Goes out on WhatsApp. ${agentName} stays paused here until you hand the chat back.`
      : `Goes out on WhatsApp and pauses ${agentName} in this chat.`;

  return (
    <div className="shrink-0 bg-canvas px-4 pb-4 pt-1 md:px-[5%]">
      <form
        ref={formRef}
        key={mode}
        action={async (data) => {
          setText("");
          await (test ? testAction : replyAction)(data);
        }}
        className={`rounded-3xl border bg-surface px-4 pb-2.5 pt-3 shadow-sm transition-colors focus-within:border-brand-700 ${
          test ? "border-info-600/40" : "border-line"
        }`}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <label htmlFor="composer-text" className="sr-only">
          {test ? `Message as ${customerFirstName}` : `Message ${customerFirstName}`}
        </label>
        <textarea
          id="composer-text"
          name="text"
          required
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={test ? `Type as ${customerFirstName}, e.g. “Are you free on Saturday?”` : `Message ${customerFirstName}…`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (e.currentTarget.value.trim()) formRef.current?.requestSubmit();
            }
          }}
          className="block max-h-40 min-h-12 w-full resize-none bg-transparent text-[0.9375rem] leading-6 outline-none placeholder:text-ink-subtle"
        />

        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Message mode">
            {(
              [
                ["reply", "Reply", Reply],
                ["test", "Test as customer", FlaskConical],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === id
                    ? id === "test"
                      ? "bg-info-100 text-info-600"
                      : "bg-brand-100 text-brand-800"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <span className="ml-auto hidden text-xs text-ink-subtle md:inline">Enter to send · Shift+Enter for a new line</span>
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label={test ? `Run ${agentName}` : "Send"}
            className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors disabled:bg-transparent disabled:text-ink-subtle max-md:ml-auto ${
              test ? "bg-info-600 text-white hover:opacity-90" : "bg-brand-800 text-white hover:bg-brand-900"
            }`}
          >
            <SendHorizontal className="size-[1.125rem]" />
          </button>
        </div>
      </form>

      <p className={`mt-1.5 px-4 text-[0.6875rem] ${test && live ? "font-medium text-warning-600" : "text-ink-subtle"}`}>{note}</p>
    </div>
  );
}
