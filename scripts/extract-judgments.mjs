// Bounded judgment ingestion: paragraph-anchored excerpts from retrieved
// SCI judgment PDFs (official government hosts). Bounded by design: only
// specified paragraph ranges are ingested, with paragraph anchors for
// pinpoint citation. Metadata is NOT claimed beyond what the documents
// show; treatment is NOT asserted.
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { pathToFileURL } from "url";
import { execFileSync } from "child_process";

const pdfjs = await import(
  pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href
);

const TODAY = "2026-09-28";

const JUDGMENTS = [
  {
    pdf: "/tmp/tofan.pdf",
    stableKey: "in:judgment:sc-tofan-singh-2020",
    // Bounded excerpt ranges (paragraph numbers) — checked to exist in the PDF.
    ranges: [[1, 20], [65, 80], [160, 166]],
    paraMax: 170,
  },
  {
    pdf: "/tmp/nanavati.pdf",
    stableKey: "in:judgment:sc-nanavati-1961",
    ranges: [[1, 25], [95, 110]],
    paraMax: 120,
  },
];

function extractParas(items) {
  // Rebuild lines like the statute extractor (plain mode), then detect
  // paragraph starts "N. " with a sequential-window filter.
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

function detectParas(lines, paraMax) {
  const body = [];
  const paras = [];
  let offset = 0;
  let last = 0;
  for (const raw of lines) {
    const m = /^(\d{1,3})\.\s+(.+)$/.exec(raw);
    let num = null;
    if (m) {
      const n = parseInt(m[1], 10);
      const tol = 2 + Math.floor((n - last) * 0.02);
      if (n > last && n <= last + tol && n <= paraMax) num = n;
    }
    body.push(raw);
    if (num !== null) {
      paras.push({ anchor: `para ${num}`, heading: m[2].slice(0, 100), start: offset });
      last = num;
    }
    offset += raw.length + 1;
  }
  return { body: body.join("\n"), paras };
}

const summary = [];
for (const J of JUDGMENTS) {
  const pdfBytes = readFileSync(J.pdf);
  const sha = createHash("sha256").update(pdfBytes).digest("hex");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, disableFontFace: true }).promise;
  const allLines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    allLines.push(...extractParas(tc.items));
  }
  const { body, paras } = detectParas(allLines, J.paraMax);
  const byNum = new Map(paras.map((p) => [p.anchor, p]));

  // Build bounded body: intro + requested paragraph ranges.
  const intro = `EXCERPTS FROM RETRIEVED JUDGMENT (bounded ingestion; not the complete text)\nDocument: ${J.stableKey}\nSource PDF: sha256 ${sha.slice(0, 16)}…, ${doc.numPages} pages (full PDF retained for audit)\nExcerpt ranges selected: ${J.ranges.map(([a, b]) => `${a}-${b}`).join(", ")}\n\n`;
  let bounded = intro;
  const excerpts = [];
  const sorted = [...paras].sort((a, b) => a.start - b.start);
  for (const [a, b] of J.ranges) {
    const startP = byNum.get(`para ${a}`);
    if (!startP) { console.log(`WARN para ${a} not found in ${J.stableKey}`); continue; }
    const endP = sorted.find((p) => p.start > startP.start && parseInt(p.anchor.replace(/\D/g, ""), 10) === b + 1) ??
      sorted.find((p) => p.start > startP.start && parseInt(p.anchor.replace(/\D/g, ""), 10) > b) ?? { start: body.length };
    const chunk = body.slice(startP.start, endP.start).trimEnd();
    const offsetInBounded = bounded.length;
    bounded += chunk + "\n\n";
    excerpts.push({ from: a, to: b, offsetInBounded, chars: chunk.length });
  }
  const sections = sorted
    .filter((p) => J.ranges.some(([a, b]) => {
      const n = parseInt(p.anchor.replace(/\D/g, ""), 10);
      return n >= a && n <= b;
    }))
    .map((p) => {
      // offset within the bounded body = introLen + (p.start - excerptBase)
      return { anchor: p.anchor, heading: p.heading, start: 0 };
    });
  // Recompute section offsets against the bounded body: find each para
  // line's position by searching from the last hit (offsets are monotonic).
  const offsets = [];
  let searchFrom = intro.length;
  for (const p of sorted) {
    const n = parseInt(p.anchor.replace(/\D/g, ""), 10);
    const inRange = J.ranges.some(([a, b]) => n >= a && n <= b);
    if (!inRange) continue;
    const firstLine = body.slice(p.start, p.start + 60).split("\n")[0] ?? "";
    const idx = bounded.indexOf(firstLine, searchFrom);
    if (idx < 0) continue;
    offsets.push({ anchor: p.anchor, heading: p.heading, start: idx });
    searchFrom = idx + firstLine.length;
  }

  writeFileSync(`/tmp/legal_json/${J.stableKey.replace(/:/g, "_")}.json`,
    JSON.stringify({ key: J.stableKey, body: bounded, sections: offsets }));
  summary.push({ stableKey: J.stableKey, pdfPages: doc.numPages, sha256: sha, excerpts, paragraphsInBounded: offsets.length, bodyChars: bounded.length });
  console.log(`${J.stableKey}: pages=${doc.numPages} paras-anchored=${offsets.length} chars=${bounded.length}`);
}
writeFileSync("/tmp/legal_json/_judgment_manifest.json", JSON.stringify(summary, null, 2));
console.log("JUDGMENT_EXTRACT_DONE");
