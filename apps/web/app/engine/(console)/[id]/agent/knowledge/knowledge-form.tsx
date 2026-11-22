"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { FileUp, PenLine } from "lucide-react";
import { addKnowledgeAction, type EngineFormState } from "../../actions";

const MAX = 40_000;

/** Add a document by writing/pasting it, or by uploading a .txt / .md file (read in the browser into the same fields). */
export function KnowledgeForm({ tenantId }: { tenantId: string }) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<EngineFormState, FormData>(async (prev, formData) => {
    const result = await addKnowledgeAction(prev, formData);
    if (result.ok) {
      setTitle("");
      setBody("");
      setFileNote(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    return result;
  }, {});

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name) && !file.type.startsWith("text/")) {
      setFileNote("Only plain text (.txt) or Markdown (.md) files. For Word or PDF, copy the text and paste it under Write.");
      return;
    }
    if (file.size > 400_000) {
      setFileNote("That file is too big. Split it into smaller documents (up to 40,000 characters each).");
      return;
    }
    const text = await file.text();
    setBody(text.slice(0, MAX));
    if (!title.trim()) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, "").replace(/[-_]+/g, " ").slice(0, 120));
    setFileNote(text.length > MAX ? `Loaded the first 40,000 characters of ${file.name}.` : `Loaded ${file.name}. Check the text below, then add it.`);
  };

  return (
    <form
      // Not `action={action}`: React 19 clears every field after an action returns, even on an error. Submitting by hand keeps
      // what was typed; the success path clears it on purpose.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="tenantId" value={tenantId} />

      <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="tablist" aria-label="How to add">
        {(
          [
            ["write", "Write or paste", PenLine],
            ["upload", "Upload a file", FileUp],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              mode === id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void readFile(e.dataTransfer.files[0]);
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface-muted px-4 py-8 text-center transition-colors hover:border-brand-700/40"
        >
          <span className="text-sm font-medium">Drop a .txt or .md file, or click to choose</span>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="sr-only"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>
      ) : null}
      {fileNote ? <p className="text-xs text-ink-muted">{fileNote}</p> : null}

      <div>
        <label htmlFor="kd-title" className="mb-1.5 block text-sm font-medium">
          Title
        </label>
        <input
          id="kd-title"
          name="title"
          className="input"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Cancellation and rescheduling policy"
          required
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="kd-body" className="text-sm font-medium">
            Text
          </label>
          <span className={`text-xs tabular ${body.length > MAX * 0.95 ? "text-warning-600" : "text-ink-subtle"}`}>
            {body.length.toLocaleString("en-KE")} / {MAX.toLocaleString("en-KE")}
          </span>
        </div>
        <textarea
          id="kd-body"
          name="body"
          className="input min-h-56 leading-relaxed"
          maxLength={MAX}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"Paste the policy, FAQ or how-to.\n\nSeparate topics with a blank line: each becomes a section the agent can find on its own."}
          required
        />
        <p className="mt-1 text-xs text-ink-muted">Facts that change often (prices, hours) belong in Business details, not here.</p>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p className="rounded-xl bg-lime-100 px-3 py-2 text-sm text-brand-900">{state.message}</p> : null}
      <button className="btn btn-primary h-11 w-full" disabled={pending || !title.trim() || body.trim().length < 20}>
        {pending ? "Indexing…" : "Add to knowledge"}
      </button>
    </form>
  );
}
