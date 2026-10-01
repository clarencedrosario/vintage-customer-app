"use node";

// =====================================================================
// OFFICIAL-SOURCE CONNECTOR — first permitted end-to-end retrieval path
// (turn 17): discover → retrieve → validate → preserve
// provenance/version → index → source search.
//
// CHANNEL, and exactly why it is permitted:
//   Plain HTTPS GET of PUBLISHED official government documents — no
//   login, no CAPTCHA, no access-control bypass, robots.txt honoured.
//   This is the SAME access pattern already used for the six ingested
//   core sources (provenance in scripts/ingest-legal-text.mjs and
//   docs/LEGAL_CORPUS_MIGRATION.md). Every version records publisher +
//   retrieval URL + collection date + bytes hash.
//
// TURN-17 LIVE PROBES (2026-10-01, verbatim in docs/OFFICIAL_SOURCES.md
// — the audit trail for why the CHOSEN channel):
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
//                          download, but the POCSO candidate PDF
//                          (CS-070613) proved to be a 4-page EXPLAINER
//                          BROCHURE: the connector's sanity gates
//                          REFUSED it (correct — a brochure is not the
//                          enacted text). The NCPCR full PDF is the
//                          official HINDI edition; the NCPCR 5.4 MB PDF
//                          is an 8-page scan with no text layer.
//   delhipolice.gov.in     HTTP 200 — official bare act
//                          (sexual_offences_act.pdf): 12 pages, 514
//                          lines, 44/46 sections detected. CHOSEN as
//                          the first connector channel (India Code
//                          remains the canonical citation anchor).
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
import { renderLines, detectSections } from "../lib/pdfExtract";
import { loadPdfWorker } from "../lib/pdfWorkerLoader.js";

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
        // In pdfjs v6 `destroy()` lives on the LOADING TASK, not the
        // document proxy.
        promise: Promise<{
          numPages: number;
          getPage: (n: number) => Promise<{
            getTextContent: () => Promise<{ items: unknown }>;
            cleanup: () => void;
          }>;
        }>;
        destroy: () => Promise<void>;
      };
    };
    await loadPdfWorker();
    const doc = pdfjs.getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false });
    const pdf = await doc.promise;
    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = (await page.getTextContent()) as { items: { str: string; transform: number[]; width?: number }[] };
      lines.push(...renderLines(tc.items));
      page.cleanup();
    }
    await doc.destroy();
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
