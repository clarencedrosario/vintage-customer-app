// Extract text + section anchors from downloaded bare-act PDFs (v3).
// - Gap math uses segment END (x+width) so "144" + "." + "(1)" joins to
//   "144. (1) ..." (pdfjs splits these into separate items in gazettes).
// - MHA IPC reprint: left margin column (x<48) holds section headings, but
//   body continuation lines ALSO start at x<48 — margin text is merged
//   back BEFORE body text of the same line, never dropped.
// - Gazette sanhitas: margin band (x<110 or x>520) holds "N. Heading.";
//   running headers (y>765) and underscore rules are stripped.
// - Sequential-window filter (with lettered-section tolerance) rejects
//   page-number artifacts. Missing headings fall back to the first
//   subsequent line containing ".--"/".—".
import { createRequire } from "module";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { pathToFileURL } from "url";

const pdfjs = await import(
  pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href
);

const TODAY = "2026-09-28";
const OUT = "/tmp/legal_json";
mkdirSync(OUT, { recursive: true });

const SOURCES = [
  { key: "in:statute:ipc-1860", pdf: "/tmp/ipc_mha.pdf", mode: "leftMargin", startAt: 1, maxNo: 511,
    sourceUrl: "https://www.mha.gov.in/sites/default/files/2022-09/IPC1860%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India" },
  { key: "in:statute:crpc-1973", pdf: "/tmp/crpc_mha.pdf", mode: "plain", startAt: 1, maxNo: 484,
    sourceUrl: "https://www.mha.gov.in/sites/default/files/2022-09/ccp1973%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India" },
  { key: "in:statute:evidence-1872", pdf: "/tmp/iea_final.pdf", mode: "plain", startAt: 1, maxNo: 167,
    sourceUrl: "https://www.indiacode.nic.in/bitstream/123456789/15351/1/iea_1872.pdf (India Code text; retrieved via verified reproduction at lawvisionattorneys.com after India Code returned HTTP 504)",
    publisher: "India Code (Legislative Dept.) — third-party verified reproduction" },
  { key: "in:code:bns-2023", pdf: "/tmp/bns_mha.pdf", mode: "gazette", startAt: 1, maxNo: 358,
    sourceUrl: "https://www.mha.gov.in/sites/default/files/250883_english_01042024.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA" },
  { key: "in:code:bnss-2023", pdf: "/tmp/bnss_mha.pdf", mode: "gazette", startAt: 1, maxNo: 531,
    sourceUrl: "https://www.mha.gov.in/sites/default/files/2024-04/250884_2_english_01042024.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA" },
  { key: "in:code:bsa-2023", pdf: "/tmp/bsa_mha.pdf", mode: "gazette", startAt: 1, maxNo: 170,
    sourceUrl: "https://www.mha.gov.in/sites/default/files/2024-04/250882_english_01042024_0.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA" },
  { key: "in:constitution:constitution-of-india", pdf: "/tmp/const_s3waas.pdf", mode: "plain", startAt: 1, maxNo: 400,
    sourceUrl: "https://cdnbbsr.s3waas.gov.in/s380537a945c7aaa788ccfcdf1b99b5d8f/uploads/2023/05/2023050195.pdf",
    publisher: "Government of India (official Constitution as amended up to date of edition)" },
];

const isDev = (s) => {
  let dev = 0, lat = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0x0900 && c <= 0x097f) dev++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) lat++;
  }
  return dev > 0 && dev >= lat;
};

/** Group a page's items into rendered lines per mode. */
function buildLines(items, mode) {
  const clean = items.filter((it) => it.str && it.str.trim() && !isDev(it.str));
  const lines = new Map(); // y -> {margin:[], body:[]}
  for (const it of clean) {
    const x = it.transform[4], y = it.transform[5];
    const seg = { x, w: it.width ?? 0, s: it.str };
    let L = lines.get(y);
    if (!L) { L = { margin: [], body: [] }; lines.set(y, L); }
    if (mode === "leftMargin" && x < 48) L.margin.push(seg);
    else if (mode === "gazette" && (x < 110 || x > 520)) L.margin.push(seg);
    else L.body.push(seg);
  }
  const out = [];
  for (const [y, L] of [...lines.entries()].sort((a, b) => b[0] - a[0])) {
    if (mode === "gazette" && y > 765) continue; // running header
    const render = (arr) => {
      arr.sort((a, b) => a.x - b.x);
      let text = "", prevEnd = null;
      for (const seg of arr) {
        const endGap = prevEnd === null ? 0 : seg.x - prevEnd;
        // Join ONLY true continuations (end-to-start gap <= 1.5pt, e.g.
        // "144"+"."+"(" or mid-word splits). Normal word gaps (2.5-5pt)
        // get a space. This is what makes gazette section numbers parse
        // while keeping prose words separated.
        if (endGap > 1.5 && text && !/\s$/.test(text) && !/^\s/.test(seg.s)) text += " ";
        text += seg.s;
        prevEnd = seg.x + (seg.w ?? 0);
      }
      return text.replace(/\s+/g, " ").trim();
    };
    // width is attached for gap math (pdfjs gives it per item).
    const withW = (arr) => arr;
    const marginText = render(withW(L.margin));
    const bodyText = render(withW(L.body));
    if (/^_+$/.test(bodyText.replace(/\s/g, "").slice(0, 40)) && bodyText.length > 20) continue;
    if (mode === "gazette") {
      if (marginText && /^\d{1,3}[A-Z]?\./.test(marginText)) {
        out.push(`${marginText} ${bodyText}`.trim());
      } else if (bodyText) out.push(bodyText);
      else if (marginText && /^\d{1,3}[A-Z]?\./.test(marginText)) out.push(marginText);
    } else if (mode === "leftMargin") {
      // Margin items are either headings OR the line's first word(s);
      // merge in reading order so nothing is lost.
      const text = `${marginText} ${bodyText}`.trim();
      if (text) out.push(text);
    } else {
      if (bodyText) out.push(bodyText);
    }
  }
  return out;
}

function headingFrom(text) {
  let h = text.replace(/^\d{1,3}[A-Z]?\.\s*/, "");
  const cut = h.search(/\.--|\.—|—|\.–|–|\.\(| \(/);
  if (cut > 0) h = h.slice(0, cut);
  h = h.replace(/^["'“”]+|["'“”.]+$/g, "").replace(/\s+/g, " ").trim();
  return h.slice(0, 140);
}

function detectSections(lines, { startAt, maxNo }) {
  const bodyLines = [];
  const sections = [];
  let offset = 0;
  let lastAccepted = 0;
  const re = /^(\d{1,3})([A-Z]?)\.\s*(.*)$/;
  const rangeRe = /^(\d{1,3})\s*(?:to|and)\s*(\d{1,3})([A-Z]?)\.\s*(.*)$/;
  const anomalies = [];
  let pendingIdx = null; // section awaiting a heading
  let pendingScans = 0;
  for (const raw of lines) {
    let matched = null;
    let rangeMatch = null;
    const m = re.exec(raw);
    if (m) {
      const num = parseInt(m[1], 10);
      const letter = m[2] ?? "";
      const base = 3 + Math.floor((num - lastAccepted) * 0.02);
      const tol = letter ? Math.max(base, 6) : base;
      if (num > lastAccepted && num <= lastAccepted + tol && num <= maxNo) {
        matched = { num, letter, at: offset };
      }
    }
    if (!matched) {
      // Repeal/omission RANGE lines, e.g. "161 to 165A. Rep. by ..." —
      // the MHA IPC print carries repealed provisions ONLY as such ranges.
      // Register every number in the range (its text is the omission note)
      // so anchors exist and the sequential window resumes after the range.
      const rm = rangeRe.exec(raw);
      if (rm) {
        const n1 = parseInt(rm[1], 10);
        const n2 = parseInt(rm[2], 10);
        if (n1 > lastAccepted && n2 > n1 && n2 <= lastAccepted + 12 && n2 <= maxNo) {
          rangeMatch = { n1, n2, letter: rm[3] ?? "", note: rm[4] ?? "", at: offset };
        }
      }
    }
    bodyLines.push(raw);
    if (matched) {
      const heading = headingFrom(raw);
      sections.push({
        anchor: `§ ${matched.num}${matched.letter}`,
        heading: heading || `Section ${matched.num}${matched.letter}`,
        start: matched.at,
      });
      if (sections.length === 1 && matched.num !== startAt)
        anomalies.push(`first detected section is ${matched.num}, expected ${startAt}`);
      lastAccepted = matched.num;
      if (heading) { pendingIdx = null; pendingScans = 0; }
      else { pendingIdx = sections.length - 1; pendingScans = 5; }
    } else if (rangeMatch) {
      const note = headingFrom(rangeMatch.note) || "Omitted/repelled — see source marginal note";
      for (let n = rangeMatch.n1; n <= rangeMatch.n2 && n - rangeMatch.n1 <= 12; n++) {
        sections.push({
          anchor: `§ ${n}${rangeMatch.letter}`,
          heading: `[Omitted in source] ${note}`.slice(0, 140),
          start: rangeMatch.at,
        });
      }
      lastAccepted = rangeMatch.n2;
      pendingIdx = null; pendingScans = 0;
    } else if (pendingIdx !== null) {
      const s = sections[pendingIdx];
      if (/^\(/.test(raw) || !raw) { pendingIdx = null; pendingScans = 0; }
      else if (/\.--|\.—|\.–/.test(raw)) {
        s.heading = headingFrom(raw) || s.heading;
        pendingIdx = null; pendingScans = 0;
      } else {
        pendingScans -= 1;
        if (pendingScans <= 0) { pendingIdx = null; pendingScans = 0; }
      }
    }
    offset += raw.length + 1;
  }
  return { body: bodyLines.join("\n"), sections, anomalies };
}

const manifest = [];
for (const src of SOURCES) {
  const pdfBytes = readFileSync(src.pdf);
  const sha = createHash("sha256").update(pdfBytes).digest("hex");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes), isEvalSupported: false, disableFontFace: true,
  }).promise;
  const allLines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // attach widths for gap math
    const items = tc.items.map((it) => ({ ...it, w: it.width ?? 0 }));
    allLines.push(...buildLines(items, src.mode));
  }
  const { body, sections, anomalies } = detectSections(allLines, { startAt: src.startAt, maxNo: src.maxNo });
  const record = {
    key: src.key, sourceUrl: src.sourceUrl, publisher: src.publisher,
    pdfFile: path.basename(src.pdf), pdfSha256: sha, pdfPages: doc.numPages,
    textChars: body.length, sectionsCount: sections.length,
    firstAnchor: sections[0]?.anchor ?? null, lastAnchor: sections.at(-1)?.anchor ?? null,
    anomalies, collectedAt: TODAY,
  };
  writeFileSync(path.join(OUT, `${src.key.replace(/[:]/g, "_")}.json`),
    JSON.stringify({ key: src.key, body, sections }));
  manifest.push(record);
  console.log(`${src.key}: pages=${record.pdfPages} chars=${record.textChars} sections=${record.sectionsCount} ${record.firstAnchor}..${record.lastAnchor} anomalies=${JSON.stringify(anomalies)}`);
}
writeFileSync(path.join(OUT, "_manifest.json"), JSON.stringify(manifest, null, 2));
console.log("DONE");
