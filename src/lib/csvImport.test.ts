import { describe, expect, it } from "vitest";
import {
  buildTemplate,
  csvEscape,
  IMPORT_COLUMNS,
  IMPORT_ENTITIES,
  IMPORT_ROW_LIMIT,
  parseCsv,
} from "./csvImport";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    const { headers, rows } = parseCsv("name,city\nAsha,Delhi\nRavi,Patna\n");
    expect(headers).toEqual(["name", "city"]);
    expect(rows).toEqual([
      ["Asha", "Delhi"],
      ["Ravi", "Patna"],
    ]);
  });

  it("handles quoted fields with commas and doubled quotes", () => {
    const { headers, rows } = parseCsv(
      'name,notes\n"Sharma & Co, LLP","Said ""settle quickly"" on record"',
    );
    expect(headers).toEqual(["name", "notes"]);
    expect(rows).toEqual([["Sharma & Co, LLP", 'Said "settle quickly" on record']]);
  });

  it("treats CRLF and bare CR as record separators", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r3,4\n");
    expect(rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps empty fields and skips fully blank lines", () => {
    const { rows } = parseCsv("a,b,c\n,,\n\n1,,x");
    expect(rows).toEqual([["1", "", "x"]]);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const { headers } = parseCsv("\uFEFFname,city\nA,Delhi");
    expect(headers).toEqual(["name", "city"]);
  });

  it("returns empty rows for a header-only file", () => {
    const { headers, rows } = parseCsv("name,city\r\n");
    expect(headers).toEqual(["name", "city"]);
    expect(rows).toEqual([]);
  });
});

describe("csvEscape", () => {
  it("guards spreadsheet formula injection prefixes", () => {
    for (const malicious of ["=cmd", "+1", "-2", "@x", "\tTab", "\rCR"]) {
      // Guarded with a leading apostrophe (then quoted if it contains
      // control characters, which is why the CR case is quoted too).
      expect(csvEscape(malicious)).toMatch(/^"?'/);
    }
  });

  it("wraps cells containing commas or quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("leaves ordinary text untouched", () => {
    expect(csvEscape("Asha Devi")).toBe("Asha Devi");
  });
});

describe("templates & specs", () => {
  it("templates contain exactly the header row", () => {
    for (const entity of IMPORT_ENTITIES) {
      const csv = buildTemplate(entity);
      const lines = csv.trim().split("\r\n");
      expect(lines).toHaveLength(1);
      const { headers, rows } = parseCsv(csv);
      expect(headers.length).toBeGreaterThan(0);
      expect(rows).toEqual([]);
      // Every required column in the spec appears in the template.
      const required = IMPORT_COLUMNS[entity]
        .filter((c) => c.required)
        .map((c) => c.header);
      for (const col of required) expect(headers).toContain(col);
    }
  });

  it("round-trips a template through the parser", () => {
    const csv = buildTemplate("clients");
    const { headers } = parseCsv(csv);
    expect(headers[0]).toBe("name");
  });

  it("caps batch size at a sane limit", () => {
    expect(IMPORT_ROW_LIMIT).toBeGreaterThan(0);
    expect(IMPORT_ROW_LIMIT).toBeLessThanOrEqual(1000);
  });
});
