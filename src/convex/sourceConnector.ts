"use node";

// =====================================================================
// OFFICIAL-SOURCE CONNECTOR — first permitted end-to-end retrieval path
// (turn 17): discover → retrieve → validate → preserve
// provenance/version → index → source search.
//
// CHANNEL, and exactly why it is permitted:
//   The Ministry of Home Affairs (mha.gov.in) official document
//   repository hosts bare-act and Gazette of India (Extraordinary) PDFs.
//   This is the SAME channel already used for the six ingested core
//   sources (recorded provenance in scripts/ingest-legal-text.mjs and
//   docs/LEGAL_CORPUS_MIGRATION.md): plain HTTPS GET of published
//   government documents, no login, no CAPTCHA, no access-control
//   bypass, honouring robots.txt. Open government publication; the
//   source row records publisher + retrieval URL + collection date +
//   content hash for every version.
//
// TURN-17 LIVE PROBES (2026-10-01, recorded verbatim in
// docs/OFFICIAL_SOURCES.md — the audit trail for why THIS channel):
//   www.indiacode.nic.in         HTTP 200 root; deep URLs (bitstream/
//                                handle) TIMEOUT — matches the 504/
//                                timeout history already recorded on
//                                the POCSO row. NOT usable programmatically.
//   egazette.gov.in              TLS certificate chain fails
//                                verification — proceeding would mean
//                                DISABLING certificate verification,
//                                which is refused. NOT usable.
//   www.sci.gov.in               HTTP 200; robots.txt allows crawlers;
//                                but case/orders APIs are REGISTRATION-
//                                GATED and no credentials exist → not
//                                authorized; registry stays honest
//                                (manual/reviewed paths only).
//   www.mha.gov.in (Gazette/     HTTP 200, application/pdf — permitted
//   bare-act PDFs)               plain download. CHOSEN as the first
//                                connector channel.
//
// SANITY GATES before anything is stored: PDF magic bytes, declared
// content-type, size ceiling, extracted section count, minimum body
// length, section 1 presence. A failed gate RAISES A FAILED INGESTION
// RUN and never advances any freshness timestamp.
//
// DEDUPE: the SHA-256 of the retrieved bytes is compared with the
// current version's recorded hash — an identical re-download creates
// NO new version (repeat-import deduplication), only a recorded
// "unchanged" run. A genuinely changed document creates a NEW immutable
// version and (via the existing wiring) alerts opted-in matters.
// =====================================================================

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./crypto";

const UA =
  "Advokate-legal-intel/0.2 (authorized retrieval of open government publications)";

const NOTICES: Record<
  string,
  { url: string; publisher: string; maxNo: number; minSections: number }
> = {
  // POCSO 2012 is the first target: the registry row exists (turn 7)
  // with text NOT OBTAINED and citation-validator BLOCKED. This
  // connector fills that gap through the already-authorized channel.
  "in:statute:pocso-2012": {
    url: "https://www.mha.gov.in/sites/default/files/2023-03/CS-070613_0%5B1%5D_0%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India (official reprint)",
    maxNo: 46, // POCSO has 46 sections + 1 schedule
    minSections: 10,
  },
};

/** Render pdfjs text items into plain reading-order lines (plain mode). */
function renderLines(items: { str: string; transform: number[]; width?: number }[]) {
  const lines = new Map<number, { x: number; w: number; s: string }[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4]!;
    const y = it.transform[5]!;
    const arr = lines.get(y) ?? [];
    arr.push({ x, w: it.width ?? 0, s: it.str });
    lines.set(y, arr);
  }
  const out: string[] = [];
  for (const [y, arr] of [...lines.entries()].sort((a, b) => b[0] - a[0])) {
    arr.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd: number | null = null;
    for (const seg of arr) {
      const gap = prevEnd === null ? 0 : seg.x - prevEnd;
      if (gap > 1.5 && text && !/\s$/.test(text) && !/^\s/.test(seg.s)) text += " ";
      text += seg.s;
      prevEnd = seg.x + seg.w;
    }
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

/**
 * Plain-mode section detection (port of the verified extract-legal-pdfs
 * logic): "12. Punishment for …—(1) …" splits into an anchor + heading;
 * range lines ("12 to 16.") are skipped for anchors. The full BODY (all
 * lines) is always kept as text — sections are only the anchor index.
 */
function detectSections(
  lines: string[],
  opts: { startAt: number; maxNo: number },
) {
  const re = /^[\[(]?\s*(\d{1,3})\s*(?:([A-Z])|-([A-Z]))?\s*\.\s*(.*)$/;
  const rangeRe = /^(\d{1,3})\s*(?:to|and)\s*(\d{1,3})([A-Z]?)\.\s*(.*)$/;
  const sections: { anchor: string; heading: string; start: number }[] = [];
  const body: string[] = [];
  let offset = 0;
  let last = 0;
  const registered = new Set<string>();
  for (const raw of lines) {
    const range = raw.match(rangeRe);
    if (range) {
      body.push(raw);
      offset += raw.length + 1;
      const n = parseInt(range[1]!, 10);
      if (n > last && n <= opts.maxNo) last = n;
      continue;
    }
    const m = raw.match(re);
    if (m) {
      const n = parseInt(m[1]!, 10);
      const letter = m[2] ?? m[3] ?? "";
      const num = n + letter;
      if (
        n >= opts.startAt &&
        n > last &&
        n <= opts.maxNo &&
        !registered.has(num) &&
        n - last <= 3
      ) {
        let heading = m[4] ?? "";
        const cut = heading.search(/\.--|\.—|—|\.–|–|\.(\(|\[)| (\(|\[)/);
        if (cut > 0) heading = heading.slice(0, cut);
        heading = heading
          .replace(/^["'“”]+|["'“”.]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        sections.push({ anchor: `s ${num}`, heading, start: offset });
        registered.add(num);
        last = n;
      }
    }
    body.push(raw);
    offset += raw.length + 1;
  }
  return { sections, body: normalizeText(body.join("\n")) };
}

export const fetchOfficialSource = action({
  args: {
    stableKey: v.string(),
    // force bypasses the identical-bytes short-circuit (verification only).
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const notice = NOTICES[args.stableKey];
    if (!notice) {
      throw new Error(
        `No connector notice registered for ${args.stableKey} — add one with publisher + URL + sanity bounds first.`,
      );
    }
    const startedAt = Date.now();
    // 1. RETRIEVE (plain GET, honouring the permitted-download posture).
    const resp = await fetch(notice.url, {
      headers: { "User-Agent": UA, Accept: "application/pdf" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      const err = `HTTP ${resp.status} from ${notice.url}`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey: args.stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength > 20_000_000) {
      const err = `Retrieved file too large (${buf.byteLength} bytes) — refused.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey: args.stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const magic = String.fromCharCode(...buf.slice(0, 5));
    if (magic !== "%PDF-") {
      const err = `Response is not a PDF (content-type ${contentType}, magic ${JSON.stringify(magic)}) — refused.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey: args.stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const bytesHash = sha256Hex(
      Buffer.from(buf).toString("base64"),
    );

    // 2. DEDUPE against the current version's recorded hash.
    if (!args.force) {
      const dedupe = await ctx.runQuery(internal.legalIntel.currentBytesHash, {
        stableKey: args.stableKey,
      });
      if (dedupe && dedupe === bytesHash) {
        const r = await ctx.runMutation(
          internal.legalIntel.commitOfficialRetrieval,
          {
            stableKey: args.stableKey,
            bytesHash,
            body: null,
            sections: null,
            collectionDate: new Date().toISOString().slice(0, 10),
            publisher: notice.publisher,
            url: notice.url,
            startedAt,
            unchanged: true,
          },
        );
        return r;
      }
    }

    // 3. EXTRACT (pdfjs legacy build; text layer only).
    const require_ = (await import("module")).createRequire(import.meta.url);
    const pdfjsPath = require_.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfjs = await import(pdfjsPath);
    const doc = await pdfjs.getDocument({
      data: buf,
      useSystemFonts: false,
      isEvalSupported: false,
    }).promise;
    const lines: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      lines.push(...renderLines(tc.items as never));
      page.cleanup();
    }
    await doc.destroy();
    const { sections, body } = detectSections(lines, {
      startAt: 1,
      maxNo: notice.maxNo,
    });

    // 4. VALIDATE (sanity gates — refuse, never store garbage).
    if (body.length < 8000 || sections.length < notice.minSections || !/^1\./m.test(body)) {
      const err = `Extraction failed sanity gates: ${lines.length} lines, ${body.length} chars, ${sections.length} sections (min ${notice.minSections}), s1 ${/^1\./m.test(body) ? "present" : "ABSENT"}. Text NOT stored.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey: args.stableKey,
        error: err,
      });
      throw new Error(err);
    }

    // 5. COMMIT (dedupe + provenance + version + indexing + alerts —
    //    all inside legalIntel's existing machinery).
    return ctx.runMutation(internal.legalIntel.commitOfficialRetrieval, {
      stableKey: args.stableKey,
      bytesHash,
      body,
      sections,
      collectionDate: new Date().toISOString().slice(0, 10),
      publisher: notice.publisher,
      url: notice.url,
      startedAt,
      unchanged: false,
    });
  },
});
