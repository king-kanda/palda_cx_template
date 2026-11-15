"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

/** Crops to a centred square and shrinks to 256px JPEG, so what we store is ~20-40 KB whatever was uploaded. */
async function toSquareDataUrl(file: File, size = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP picture.");
  if (file.size > 8_000_000) throw new Error("That picture is too large. Pick one under 8 MB.");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't process pictures.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AgentAvatar({ src, name, className = "size-16" }: { src: string | null; name: string; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`${name} picture`} className={`${className} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-full bg-lime-400 text-sm font-bold text-brand-900`}>
      {initials}
    </span>
  );
}

export function AvatarPicker({
  value,
  onChange,
  name,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  name: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await toSquareDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that picture.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <AgentAvatar src={value} name={name || "Agent"} className="size-20" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()} disabled={busy}>
            <ImagePlus className="size-4" /> {value ? "Change picture" : "Upload picture"}
          </button>
          {value ? (
            <button type="button" className="btn btn-secondary" onClick={() => onChange(null)}>
              <Trash2 className="size-4" /> Remove
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Agent picture"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      <p className="mt-2 text-xs text-ink-muted">A square works best. We crop it and shrink it for you.</p>
      {error ? <p role="alert" className="mt-1 text-xs text-danger-600">{error}</p> : null}
    </div>
  );
}
