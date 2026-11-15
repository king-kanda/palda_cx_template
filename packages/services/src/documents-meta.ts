/** Constants shared by the server and the browser. No database imports, so client components can use it. */

export const DOCUMENT_KINDS = [
  { value: "brochure", label: "Brochure" },
  { value: "price_list", label: "Price list" },
  { value: "terms", label: "Terms and policies" },
  { value: "contract", label: "Contract" },
  { value: "template", label: "Template (quote, letter, form)" },
  { value: "other", label: "Other" },
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];

export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Allowed file types by extension. The stored type comes from here, never from what the browser claims. */
export const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/plain",
  csv: "text/csv",
};

export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_TYPES).map((e) => `.${e}`).join(",");

export function kindLabel(kind: string): string {
  return DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? "Other";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
