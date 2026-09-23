import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCsv, rowsToCsv, type ReportRow } from "./reportExports";

describe("rowsToCsv", () => {
  it("renders headers from the first row and fills missing cells", () => {
    const rows: ReportRow[] = [
      { Matter: "ADV/2026/0001", Status: "open" },
      { Matter: "ADV/2026/0002", Status: null },
    ];
    const csv = rowsToCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Matter,Status");
    expect(lines[1]).toBe("ADV/2026/0001,open");
    expect(lines[2]).toBe("ADV/2026/0002,");
  });

  it("quotes and escapes cells containing commas and quotes", () => {
    const csv = rowsToCsv([{ Note: 'Said "settle, quickly" now' }]);
    expect(csv).toContain('"Say ""settle, quickly"" now"'.replace("Say", "Said"));
  });

  it("neutralises formula injection prefixes", () => {
    const csv = rowsToCsv([{ Ref: "=HYPERLINK(\"http://evil\")" }]);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("returns an empty string for no rows", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("formats numbers without locale commas", () => {
    const csv = rowsToCsv([{ Amount: 125000 }]);
    expect(csv).toContain("125000");
  });
});

describe("downloadCsv", () => {
  beforeEach(() => {
    const created: string[] = [];
    vi.stubGlobal(
      "URL",
      {
        createObjectURL: vi.fn(() => "blob:mock"),
        revokeObjectURL: vi.fn((u: string) => {
          created.push(u);
        }),
      } as unknown as typeof URL,
    );
    vi.stubGlobal(
      "Blob",
      class {
        constructor(public parts: unknown[], public opts: unknown) {}
      },
    );
  });

  it("prepends a BOM so Excel opens UTF-8 correctly", () => {
    const spy = vi.fn();
    vi.stubGlobal("Blob", class {
      constructor(parts: BlobPart[]) {
        expect(parts[0]).toMatch(/^\uFEFF/);
        spy();
      }
    });
    downloadCsv("report.csv", [{ A: "x" }]);
    expect(spy).toHaveBeenCalled();
  });
});
