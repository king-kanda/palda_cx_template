import type { InvoicePdfData } from "./pdf";

/**
 * Lazily load the PDF renderer. @react-pdf/renderer is a large, browser-flavoured
 * dependency; importing it eagerly would make every server process (web, worker,
 * agent service) pay for it at boot and breaks plain Node/tsx resolution.
 */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const { renderInvoicePdf: render } = await import("./pdf");
  return render(data);
}

export type { InvoicePdfData } from "./pdf";
