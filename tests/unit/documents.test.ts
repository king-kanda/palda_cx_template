import { describe, expect, it } from "vitest";
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES, formatBytes, kindLabel } from "../../packages/services/src/documents-meta";
import { contentMatches, safeFilename } from "../../packages/services/src/documents";

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);

describe("allowed types", () => {
  it("covers business paperwork and nothing a browser could run", () => {
    for (const ext of ["pdf", "docx", "xlsx", "png", "jpg", "jpeg", "webp", "txt", "md", "csv"]) expect(DOCUMENT_TYPES[ext]).toBeTruthy();
    for (const ext of ["html", "htm", "svg", "js", "exe", "sh", "bat", "php", "xml", "zip", "dll", "scr", "jar"]) {
      expect(DOCUMENT_TYPES[ext], ext).toBeUndefined();
    }
    expect(DOCUMENT_ACCEPT).toContain(".pdf");
    expect(DOCUMENT_ACCEPT).not.toContain(".html");
  });
});

describe("contentMatches (the file is what its name says)", () => {
  it("accepts real headers", () => {
    expect(contentMatches("pdf", text("%PDF-1.7\n..."))).toBe(true);
    expect(contentMatches("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(contentMatches("jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatches("jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatches("webp", Uint8Array.from([...text("RIFF"), 0, 0, 0, 0, ...text("WEBPVP8 ")]))).toBe(true);
    expect(contentMatches("docx", bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe(true);
    expect(contentMatches("xlsx", bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe(true);
    expect(contentMatches("txt", text("Price list\nStandard: KES 3,000"))).toBe(true);
    expect(contentMatches("csv", text("name,price\nclean,3000"))).toBe(true);
  });

  it("rejects a file renamed to something it is not", () => {
    expect(contentMatches("pdf", text("<html><script>alert(1)</script></html>"))).toBe(false);
    expect(contentMatches("pdf", bytes(0x4d, 0x5a, 0x90, 0))).toBe(false); // a Windows executable
    expect(contentMatches("png", text("<svg onload=alert(1)>"))).toBe(false);
    expect(contentMatches("jpg", text("not a jpeg"))).toBe(false);
    expect(contentMatches("docx", text("plain text"))).toBe(false);
    expect(contentMatches("txt", bytes(0x4d, 0x5a, 0x90, 0x00, 0x03))).toBe(false); // binary pretending to be text
    expect(contentMatches("exe", bytes(0x4d, 0x5a))).toBe(false);
  });
});

describe("safeFilename", () => {
  it.each([
    ["price list.pdf", "price list.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\terms.pdf", "terms.pdf"],
    ['evil"; filename="x.exe.pdf', "evil filename=x.exe.pdf"],
    ["new\nline\r\n.pdf", "newline.pdf"],
    ["<script>.pdf", "script.pdf"],
    ["...hidden.pdf", "hidden.pdf"],
    ["", "document"],
    ["   ", "document"],
  ])("cleans %j", (input, expected) => expect(safeFilename(input)).toBe(expected));

  it("bounds the length and keeps the extension", () => {
    const out = safeFilename("a".repeat(500) + ".pdf");
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("labels", () => {
  it("formats sizes and kinds", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(kindLabel("price_list")).toBe("Price list");
    expect(kindLabel("nonsense")).toBe("Other");
  });
});
