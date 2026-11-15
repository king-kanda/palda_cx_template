"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

/**
 * Shrinks a logo to fit in 420 x 420 (keeping its shape and any transparency) and returns it as a PNG data URL. PNG is used
 * because the invoice PDF renderer supports PNG and JPEG, and because logos usually need transparency. If it is still large it
 * is scaled down again until it fits the stored limit.
 */
async function toLogoDataUrl(file: File, maxChars: number): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG or WebP logo.");
  if (file.size > 8_000_000) throw new Error("That logo is too large. Pick one under 8 MB.");
  const bitmap = await createImageBitmap(file);
  let max = 420;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process images.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/png");
    if (url.length <= maxChars) {
      bitmap.close();
      return url;
    }
    max = Math.round(max * 0.7);
  }
  bitmap.close();
  throw new Error("That logo is too detailed to store. Try a simpler or smaller one.");
}

export function LogoPicker({
  value,
  onChange,
  maxChars,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  maxChars: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-dashed border-line bg-surface-muted">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Logo preview" className="max-h-full max-w-full object-contain p-1" />
          ) : (
            <ImagePlus className="size-6 text-ink-subtle" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary h-10 px-4" onClick={() => input.current?.click()}>
            {value ? "Change logo" : "Upload logo"}
          </button>
          {value ? (
            <button type="button" className="btn btn-secondary h-10 px-4" onClick={() => { setError(""); onChange(null); }}>
              <Trash2 className="size-4" /> Remove
            </button>
          ) : null}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            setError("");
            onChange(await toLogoDataUrl(file, maxChars));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't read that logo.");
          }
        }}
      />
      {error ? <p className="mt-2 text-xs text-danger-600">{error}</p> : null}
      <p className="mt-2 text-xs text-ink-muted">PNG, JPEG or WebP. A transparent PNG works best. It is shrunk to fit.</p>
    </div>
  );
}
