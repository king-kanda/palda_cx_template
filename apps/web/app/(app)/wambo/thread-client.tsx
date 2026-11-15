"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { SendHorizontal } from "lucide-react";

/** Message pane that opens scrolled to the newest message, like WhatsApp. */
export function ThreadScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  });
  return (
    <div ref={ref} className="wa-wallpaper min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-[7%]">
      {children}
    </div>
  );
}

/** Message bar: Enter sends, Shift+Enter adds a new line. */
export function Composer({
  action,
  conversationId,
  placeholder,
}: {
  action: (formData: FormData) => void | Promise<void>;
  conversationId: string;
  placeholder: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={action}
      className="flex shrink-0 items-end gap-2 bg-[#f0f2f5] px-4 py-2.5"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea
        name="text"
        required
        rows={1}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (e.currentTarget.value.trim()) formRef.current?.requestSubmit();
          }
        }}
        className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg border-0 bg-white px-3.5 py-2.5 text-[15px] text-[#111b21] outline-none placeholder:text-[#667781]"
      />
      <button
        type="submit"
        aria-label="Send"
        className="grid size-[42px] shrink-0 place-items-center rounded-full bg-[#00a884] text-white transition-colors hover:bg-[#008069]"
      >
        <SendHorizontal className="size-5" />
      </button>
    </form>
  );
}
