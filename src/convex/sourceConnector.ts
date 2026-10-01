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
//   sources (provenance in scripts/ingest-legal-text.mjs and
//   docs/LEGAL_CORPUS_MIGRATION.md): plain HTTPS GET of published
//   government documents, no login, no CAPTCHA, no access-control
//   bypass, honouring robots.txt. Open government publication; every
//   version records publisher + retrieval URL + collection date + bytes
//   hash.
//
// TURN-17 LIVE PROBES (2026-10-01, verbatim in docs/OFFICIAL_SOURCES.md
// — the audit trail for why THIS channel):
//   www.indiacode.nic.in   HTTP 200 at root; deep URLs (bitstream/handle)
//                          TIMEOUT — matches the 504/timeout history on
//                          the POCSO row. Not usable programmatically.
//   egazette.gov.in        TLS certificate chain FAILS verification —
//                          proceeding would mean disabling certificate
//                          verification. Refused.
//   www.sci.gov.in         HTTP 200; robots.txt permissive; but
//                          case/orders APIs are REGISTRATION-GATED and
//                          no credentials exist → not authorized. The
//                          court-source registry stays honest (manual/
//                          reviewed paths only).
//   www.mha.gov.in         HTTP 200, application/pdf — permitted plain
//                          download. CHOSEN as the first channel.
//
// SANITY GATES before anything is stored: PDF magic bytes, size
// ceiling, extracted section count, minimum body length, section 1
// presence. A failed gate RAISES A FAILED INGESTION RUN and never
// advances a freshness timestamp.
//
// DEDUPE: SHA-256 of the retrieved bytes AND of the extracted text are
// compared against the current version's fingerprints — an identical
// re-download creates NO new version (repeat-import deduplication),
// only a recorded "unchanged" run. A genuinely changed document creates
// a NEW immutable version and (via existing wiring) alerts opted-in
// matters.
// =====================================================================

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex } from "./crypto";
import { OFFICIAL_SOURCE_NOTICES as NOTICES } from "./sourceNotices";

const UA =
  "Advokate-legal-intel/0.2 (authorized retrieval of open government publications)";

type CommitResult = {
  status: "updated" | "unchanged";
  version: number | null;
  versionId: string | null;
  bytesHash: string;
  alerted: number;
  runId: string;
  sourceTitle: string;
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
 * logic): "12. Punishment for …—(1) …" yields an anchor + heading; range
 * lines ("12 to 16.") update the sequence but add no anchor. The FULL
 * body is always kept — sections are only the anchor index.
 */
function detectSections(lines: string[], opts: { startAt: number; maxNo: number }) {
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
      const num = `${n}${letter}`;
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
          .replace(/^["'\u201c\u201d]+|["'\u201c\u201d.]+$/g, "")
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

/** Shared retrieve → validate → commit flow (fetch + gates). */
async function runFetch(
  ctx: { runQuery: Function; runMutation: Function },
  stableKey: string,
  force: boolean,
): Promise<CommitResult> {
  const notice = NOTICES[stableKey];
  if (!notice) {
    throw new Error(
      `No connector notice registered for ${stableKey} — add one with publisher + URL + sanity bounds first.`,
    );
  }
    // 1. RETRIEVE (plain GET, permitted-download posture).
    const resp = await fetch(notice.url, {
      headers: { "User-Agent": UA, Accept: "application/pdf" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      const err = `HTTP ${resp.status} from ${notice.url}`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength > 20_000_000) {
      const err = `Retrieved file too large (${buf.byteLength} bytes) — refused.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const magic = String.fromCharCode(...buf.slice(0, 5));
    if (magic !== "%PDF-") {
      const err = `Response is not a PDF (content-type ${contentType}, magic ${JSON.stringify(magic)}) — refused.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey,
        error: err,
      });
      throw new Error(err);
    }
    const bytesHash = sha256Hex(Buffer.from(buf).toString("base64"));

    // 2. DEDUPE PROBE against the current version (bytes-level).
    const fp = (await ctx.runQuery(internal.legalIntel.currentVersionFingerprint, {
      stableKey,
    })) as { bytesHash: string | null; textHash: string | null };
    if (!force && fp.bytesHash && fp.bytesHash === bytesHash) {
      // Identical BYTES re-downloaded: record "unchanged", create nothing.
      return (await ctx.runMutation(internal.legalIntel.commitOfficialRetrieval, {
        stableKey,
        bytesHash,
        body: null,
        sections: null,
        collectionDate: new Date().toISOString().slice(0, 10),
        publisher: notice.publisher,
        url: notice.url,
        unchanged: true,
      })) as CommitResult;
    }

    // 3. EXTRACT (pdfjs legacy build; text layer only). In the bundled
    // action environment the fake-worker file lookup fails, so the worker
    // module is imported explicitly and registered on globalThis — the
    // documented bundler workaround. (Canvas/DOMMatrix warnings are
    // harmless: we extract TEXT, nothing is rendered.)
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument: (src: { data: Uint8Array; useSystemFonts: boolean; isEvalSupported: boolean }) => {
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: unknown }>;
            cleanup: () => void;
          }>;
          destroy: () => Promise<void>;
        }>;
      };
    };
    const pdfjsWorker = (await import(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    )) as unknown as { WorkerMessageHandler?: unknown };
    (globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
    const doc = pdfjs.getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false });
    const pdf = await doc.promise;
    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = (await page.getTextContent()) as { items: { str: string; transform: number[]; width?: number }[] };
      lines.push(...renderLines(tc.items));
      page.cleanup();
    }
    await pdf.destroy();
    const { sections, body } = detectSections(lines, { startAt: 1, maxNo: notice.maxNo });

    // 4. VALIDATE (sanity gates — refuse, never store garbage).
    if (body.length < 8000 || sections.length < notice.minSections || !/^1\./m.test(body)) {
      const err = `Extraction failed sanity gates: ${lines.length} lines, ${body.length} chars, ${sections.length} sections (min ${notice.minSections}), s1 ${/^1\./m.test(body) ? "present" : "ABSENT"}. Text NOT stored.`;
      await ctx.runMutation(internal.legalIntel.recordConnectorFailure, {
        stableKey,
        error: err,
      });
      throw new Error(err);
    }

    // 5. DEDUPE (text-level, covers pre-connector versions) + COMMIT.
    const textHash = sha256Hex(body);
    const unchanged = !force && !!fp.textHash && fp.textHash === textHash;
    return (await ctx.runMutation(internal.legalIntel.commitOfficialRetrieval, {
      stableKey,
      bytesHash,
      body: unchanged ? null : body,
      sections: unchanged ? null : sections,
      collectionDate: new Date().toISOString().slice(0, 10),
      publisher: notice.publisher,
      url: notice.url,
      unchanged,
    })) as CommitResult;
}

/**
 * Scheduled connector sweep (turn 17): an internal ACTION (only actions
 * can run actions) that fetches every registered connector notice
 * SEQUENTIALLY — polite by design (one request per source per day, no
 * hammering). Per-source failures are caught and recorded so one broken
 * source cannot abort the sweep; the legalSweepLogs row records the
 * execution. Fired only from crons.ts; never exposed publicly.
 */
export const scheduledConnectorSweep = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ attempted: number; updated: number; unchanged: number; failed: number }> => {
    const notices = Object.entries(NOTICES).map(([stableKey]) => ({ stableKey }));
    let attempted = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    for (const n of notices) {
      attempted += 1;
      try {
        const r = (await ctx.runAction(internal.sourceConnector.runScheduledFetch, {
          stableKey: n.stableKey,
        })) as { status: string };
        if (r.status === "updated") updated += 1;
        else unchanged += 1;
      } catch (e) {
        failed += 1;
        // The action already recorded the failure against the source
        // where it could; a sweep-level record guarantees visibility.
        await ctx.runMutation(internal.legalIntel.recordSweepFailure, {
          stableKey: n.stableKey,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await ctx.runMutation(internal.legalIntel.recordConnectorSweepLog, {
      attempted,
      updated,
      unchanged,
      failed,
    });
    return { attempted, updated, unchanged, failed };
  },
});

/** Manual/operator path: platform-operator gated. */
export const fetchOfficialSource = action({
  args: {
    stableKey: v.string(),
    // force bypasses the identical-content short-circuit (verification).
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CommitResult> => {
    // Operator gate (identity does not carry through runMutation, so the
    // check happens HERE, before any fetch).
    const op = (await ctx.runQuery(internal.legalIntel.connectorOperatorCheck, {})) as {
      operatorUserId: string | null;
    };
    if (!op.operatorUserId) {
      throw new Error("Platform operator access required.");
    }
    return runFetch(ctx, args.stableKey, args.force ?? false);
  },
});

/**
 * Scheduled path (internalAction, fired only by the scheduler's
 * scheduledConnectorSweep): no identity exists on a cron — the gate is
 * the NOTICE REGISTRY itself plus run-row dedupe in the commit path.
 * Never exposed as a public function.
 */
export const runScheduledFetch = internalAction({
  args: { stableKey: v.string() },
  handler: async (ctx, args): Promise<CommitResult> =>
    runFetch(ctx, args.stableKey, false),
});
