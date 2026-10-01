// LOCAL DIAGNOSTIC (debug tool, not part of the deployment): replicate
// the connector's extraction on an already-retrieved official PDF and
// report what came out, so sanity-gate tuning is grounded in observed
// text rather than guesses.
import { readFileSync } from "fs";
import { renderLines, detectSections } from "../src/lib/pdfExtract.ts";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(readFileSync("/tmp/pocso_dp.pdf"));
const doc = pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false });
const pdf = await doc.promise;
console.log("pages:", pdf.numPages);
const lines = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const tc = await page.getTextContent();
  lines.push(...renderLines(tc.items));
  page.cleanup();
}
await doc.destroy();
console.log("lines:", lines.length);
const { sections, body } = detectSections(lines, { startAt: 1, maxNo: 46 });
console.log("sections:", sections.length, sections.slice(0, 20));
console.log("bodyChars:", body.length);
console.log("--- first 25 lines ---");
for (const l of lines.slice(0, 25)) console.log(JSON.stringify(l.slice(0, 110)));
console.log("--- last 8 lines ---");
for (const l of lines.slice(-8)) console.log(JSON.stringify(l.slice(0, 110)));
