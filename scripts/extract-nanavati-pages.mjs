// Nanavati (1961) has no numbered paragraphs — use PAGE anchors.
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { pathToFileURL } from "url";

const pdfjs = await import(
  pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href
);

const PAGES = [1, 2, 30, 31]; // bounded: header/metadata + substantive middle
const pdf = "/tmp/nanavati.pdf";

function extractParas(items) {
  const lines = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    let dev = 0, lat = 0;
    for (const ch of it.str) {
      const c = ch.codePointAt(0);
      if (c >= 0x0900 && c <= 0x097f) dev++;
      else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) lat++;
    }
    if (dev > 0 && dev >= lat) continue;
    const x = it.transform[4], y = it.transform[5];
    let L = lines.get(y);
    if (!L) { L = []; lines.set(y, L); }
    L.push({ x, w: it.width ?? 0, s: it.str });
  }
  const out = [];
  for (const [y, L] of [...lines.entries()].sort((a, b) => b[0] - a[0])) {
    L.sort((a, b) => a.x - b.x);
    let text = "", prevEnd = null;
    for (const seg of L) {
      const endGap = prevEnd === null ? 0 : seg.x - prevEnd;
      if (endGap > 1.5 && text && !/\s$/.test(text) && !/^\s/.test(seg.s)) text += " ";
      text += seg.s;
      prevEnd = seg.x + (seg.w ?? 0);
    }
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

(async () => {
  const pdfBytes = readFileSync(pdf);
  const sha = createHash("sha256").update(pdfBytes).digest("hex");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, disableFontFace: true }).promise;
  let bounded = `EXCERPTS FROM RETRIEVED JUDGMENT (bounded ingestion; not the complete text)\nDocument: in:judgment:sc-nanavati-1961\nSource PDF: sha256 ${sha.slice(0, 16)}…, ${doc.numPages} pages (full PDF retained for audit)\nExcerpts are PAGE-anchored (this 1961 judgment has no numbered paragraphs).\n\n`;
  const sections = [];
  for (const p of PAGES) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const pageText = extractParas(tc.items).join("\n");
    const start = bounded.length;
    bounded += `— page ${p} —\n${pageText}\n\n`;
    sections.push({ anchor: `page ${p}`, heading: `Judgment PDF, page ${p}`, start });
  }
  writeFileSync("/tmp/legal_json/in_judgment_sc-nanavati-1961.json",
    JSON.stringify({ key: "in:judgment:sc-nanavati-1961", body: bounded, sections }));
  console.log(`nanavati: pages-anchored=${sections.length} chars=${bounded.length}`);
  console.log("NANAVATI_EXTRACT_DONE");
})();
