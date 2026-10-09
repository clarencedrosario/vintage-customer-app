"use node";

// =====================================================================
// AUTOMATED DISCOVERY PIPELINE (turn 32) — inspect → identify →
// validate → queue → (bounded) promote. Complements the connector
// (sourceConnector.ts), which only REFRESHES registered notices.
//
// ARCHITECTURE: this file is "use node" (network + pdfjs) and therefore
// contains ACTIONS ONLY. All queries/mutations live in
// legalDiscoveryStore.ts; the registered listing data lives in
// discoveryListings.ts (pure data, importable from both runtimes —
// same pattern as sourceNotices.ts).
//
// WHAT IS AUTOMATIC: a scheduled scan inspects the registered official
// LISTING page, extracts document links and creates discoveryCandidates
// rows for previously unknown URLs. WHAT IS NOT AUTOMATIC: nothing
// becomes searchable until (a) every gate passes — PDF magic bytes,
// size bounds, detectable instrument identity, English text layer,
// section detection, section 1 presence, corpus-duplicate check — and
// (b) the promote policy bounds AUTO-ingestion to JJ-family
// instruments; every other candidate (and any gate failure or
// uncertainty) lands in the review queue, where a human decision is
// required. Review NEVER bypasses a failed gate.
//
// This module never adds entries to sourceNotices.ts or INDIA_SEED.
// =====================================================================

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256Hex, sha256HexBytes } from "./crypto";
import {
  extractPdfLinks,
  detectDocumentIdentity,
  deriveStableKey,
  languageMix,
  identityClass,
  expectedInstrumentClass,
} from "../lib/legalDiscovery";
import { renderLines, detectSections } from "../lib/pdfExtract";
import { loadPdfWorker } from "../lib/pdfWorkerLoader.js";
import { DISCOVERY_LISTINGS } from "./discoveryListings";

const UA =
  "Advokate-legal-intel/0.2 (authorized retrieval of open government publications)";

type CandidateRow = {
  _id: string;
  listingKey: string;
  url: string;
  linkTitle?: string | null;
  status: string;
};

type Gates = {
  magicOk: boolean;
  sizeOk: boolean;
  identityOk: boolean;
  languageOk: boolean;
  sectionsOk: boolean;
  s1Ok: boolean;
  duplicateOk: boolean;
};

function gateSummary(g: Gates, detail: string): string {
  const fails = Object.entries(g)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)
    .join(",");
  return fails ? `FAILED[${fails}] ${detail}` : `PASS ${detail}`;
}

/** pdfjs extraction (legacy build) — same pattern as sourceConnector. */
async function extractPdf(
  buf: Uint8Array,
  maxNo: number,
  maxPages: number,
): Promise<{ body: string; sections: { anchor: string; heading: string; start: number }[] }> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
    getDocument: (src: {
      data: Uint8Array;
      useSystemFonts: boolean;
      isEvalSupported: boolean;
    }) => {
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
  // pdfjs TRANSFERS the data buffer to its worker (detaching it), so a
  // fresh copy is passed every call — the validation sample extraction
  // and the full promotion extraction must not share one buffer.
  const doc = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const pdf = await doc.promise;
  const lines: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const page = await pdf.getPage(p);
    const tc = (await page.getTextContent()) as {
      items: { str: string; transform: number[]; width?: number }[];
    };
    lines.push(...renderLines(tc.items));
    page.cleanup();
  }
  await doc.destroy();
  return detectSections(lines, { startAt: 1, maxNo });
}

// ---------------------------------------------------------------------
// Core scan: inspect listing → record candidates → validate pending.
// Shared by the scheduled (cron) and manual (operator) paths; the only
// difference is the trigger recorded on the sweep log.
// ---------------------------------------------------------------------

async function scanListing(
  ctx: { runQuery: Function; runMutation: Function; runAction: Function },
  listingKey: string,
  trigger: "schedule" | "manual",
): Promise<{
  linksFound: number;
  newCandidates: number;
  validated: number;
  promoted: number;
  queuedForReview: number;
  rejected: number;
}> {
  const listing = DISCOVERY_LISTINGS[listingKey];
  if (!listing) throw new Error(`Unknown discovery listing: ${listingKey}`);

  let html: string;
  try {
    const resp = await fetch(listing.url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from listing`);
    html = await resp.text();
  } catch (e) {
    await ctx.runMutation(internal.legalDiscoveryStore.recordSweepLog, {
      trigger,
      listingKey,
      linksFound: 0,
      newCandidates: 0,
      validated: 0,
      promoted: 0,
      queuedForReview: 0,
      rejected: 0,
      error: `listing fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    throw e;
  }

  // Inspect the listing markup — never follow off-host links.
  const links = extractPdfLinks(html, listing.url).slice(
    0,
    listing.maxLinksPerScan,
  );

  let newCandidates = 0;
  for (const link of links) {
    const urlHash = sha256Hex(link.url);
    const result = (await ctx.runMutation(
      internal.legalDiscoveryStore.recordCandidate,
      { listingKey, url: link.url, linkTitle: link.title, urlHash },
    )) as { created: boolean };
    if (result.created) newCandidates += 1;
  }

  // Validate the pending candidates (bounded per sweep — polite).
  let validated = 0;
  let promoted = 0;
  let queuedForReview = 0;
  let rejected = 0;
  const pending = (await ctx.runQuery(
    internal.legalDiscoveryStore.pendingCandidates,
    { listingKey, limit: listing.maxValidatePerSweep },
  )) as { _id: string }[];
  for (const c of pending) {
    const r = (await ctx.runAction(internal.legalDiscovery.validateCandidate, {
      candidateId: c._id,
    })) as { outcome: "validated" | "promoted" | "review" | "rejected" | "skipped" };
    if (r.outcome === "validated") validated += 1;
    else if (r.outcome === "promoted") { validated += 1; promoted += 1; }
    else if (r.outcome === "review") queuedForReview += 1;
    else if (r.outcome === "rejected") rejected += 1;
  }

  await ctx.runMutation(internal.legalDiscoveryStore.recordSweepLog, {
    trigger,
    listingKey,
    linksFound: links.length,
    newCandidates,
    validated,
    promoted,
    queuedForReview,
    rejected,
  });
  return { linksFound: links.length, newCandidates, validated, promoted, queuedForReview, rejected };
}

/**
 * Scheduled discovery sweep — fired ONLY by crons.ts (hourly interval,
 * steady state is one page fetch + zero new work thanks to URL-hash
 * dedupe). Trigger recorded honestly as "schedule".
 */
export const scheduledDiscoveryScan = internalAction({
  args: {},
  handler: async (ctx) => {
    const results: Record<string, unknown> = {};
    for (const key of Object.keys(DISCOVERY_LISTINGS)) {
      results[key] = await scanListing(ctx, key, "schedule");
    }
    return results;
  },
});

/** Manual/operator path: same gates, trigger recorded as "manual". */
export const manualDiscoveryScan = action({
  args: { listingKey: v.string() },
  handler: async (ctx, args) => {
    const op = (await ctx.runQuery(internal.legalDiscoveryStore.operatorCheck, {})) as {
      operator: boolean;
    };
    if (!op.operator) throw new Error("Platform operator access required.");
    return scanListing(ctx, args.listingKey, "manual");
  },
});

/**
 * CLI path (internalAction, admin-key invocation): identical pipeline,
 * trigger recorded honestly as "manual" — a headless operator-initiated
 * run, NOT the scheduler. The scheduled trigger's evidence is a
 * discoverySweepLogs row with trigger="schedule" written by the cron.
 */
export const discoveryScanCli = internalAction({
  args: { listingKey: v.string() },
  handler: async (ctx, args) => scanListing(ctx, args.listingKey, "manual"),
});

// ---------------------------------------------------------------------
// Validation of ONE candidate: retrieve bytes, run every gate, decide
// the outcome, and — when the bounded promote policy matches — ingest.
// Validation stores metadata + hashes ONLY; content is stored solely on
// the promotion path (same action, immediately after all gates pass).
// ---------------------------------------------------------------------

export const validateCandidate = internalAction({
  args: { candidateId: v.id("discoveryCandidates") },
  handler: async (
    ctx,
    args,
  ): Promise<{ outcome: "validated" | "promoted" | "review" | "rejected" | "skipped" }> => {
    const c = (await ctx.runQuery(internal.legalDiscoveryStore.getCandidate, {
      candidateId: args.candidateId,
    })) as CandidateRow | null;
    if (!c) throw new Error("Candidate not found.");
    if (c.status === "promoted" || c.status === "rejected") {
      return { outcome: "skipped" };
    }
    const listing = DISCOVERY_LISTINGS[c.listingKey];
    if (!listing) throw new Error(`Unknown listing on candidate: ${c.listingKey}`);

    await ctx.runMutation(internal.legalDiscoveryStore.setCandidateStatus, {
      candidateId: args.candidateId,
      status: "validating",
    });

    const gates: Gates = {
      magicOk: false,
      sizeOk: false,
      identityOk: false,
      languageOk: false,
      sectionsOk: false,
      s1Ok: false,
      duplicateOk: false,
    };
    let summary = "";
    let identity: string | null = null;
    let stableKey: string | null = null;
    let duplicateOf: string | null = null;
    let sectionsCount = 0;
    let bodyChars = 0;
    let hindiRatio = 0;
    let bytesHash: string | null = null;
    let outcome: "validated" | "promoted" | "review" | "rejected" = "rejected";
    let fullExtract: { body: string; sections: { anchor: string; heading: string; start: number }[] } | null = null;

    try {
      const resp = await fetch(c.url, {
        headers: { "User-Agent": UA, Accept: "application/pdf" },
        signal: AbortSignal.timeout(45_000),
      });
      if (resp.ok) {
        const buf = new Uint8Array(await resp.arrayBuffer());
        bytesHash = sha256HexBytes(buf);
        gates.sizeOk = buf.byteLength <= 20_000_000 && buf.byteLength >= 20_000;
        gates.magicOk =
          String.fromCharCode(...buf.slice(0, 5)) === "%PDF-";
        if (gates.magicOk && gates.sizeOk) {
          // Bounded HEAD-sample extraction for validation (first 60
          // pages): identity, language, sections, s1.
          const sample = await extractPdf(buf, 120, 60);
          bodyChars = sample.body.length;
          const mix = languageMix(sample.body);
          hindiRatio = mix.hindiRatio;
          gates.languageOk = mix.englishOk;
          gates.sectionsOk = sample.sections.length >= 4;
          gates.s1Ok = /^1\./m.test(sample.body);
          identity = detectDocumentIdentity(sample.body);
          // Cross-check the detected identity against the publisher's own
          // naming (URL filename + anchor title): a rules notification
          // citing an amendment act in its recitals must not masquerade as
          // the act (observed live 2026-10-08 — Rules 2007 detected as
          // "Amendment Act, 2006"). Mismatch or unsignalled class ⇒ the
          // identity is UNCERTAIN: treat as no-identity (review), never
          // promote on a contradicted match.
          if (identity) {
            const detected = identityClass(identity);
            const expected = expectedInstrumentClass(
              `${decodeURIComponent(c.url)} ${c.linkTitle ?? ""}`,
            );
            if (detected === null || (expected !== null && expected !== detected)) {
              identity = null;
            }
          }
          gates.identityOk = identity !== null;
          stableKey = deriveStableKey(identity);
          // Duplicate gates: identity already in the corpus, or the same
          // bytes already stored. Duplicates are REJECTED (never re-ingested).
          if (stableKey) {
            duplicateOf = (await ctx.runQuery(
              internal.legalDiscoveryStore.corpusDuplicateCheck,
              { stableKey, bytesHash },
            )) as string | null;
          }
          gates.duplicateOk = duplicateOf === null;

          const retrievalOk = gates.magicOk && gates.sizeOk;
          const qualityOk =
            gates.languageOk && gates.sectionsOk && gates.s1Ok && gates.identityOk;

          if (retrievalOk && qualityOk && gates.duplicateOk && stableKey) {
            const policyMatch = listing.autoPromoteKeyPrefixes.some((p) =>
              stableKey!.startsWith(p),
            );
            if (policyMatch) {
              // AUTO-PROMOTE (bounded policy): full extraction NOW, store
              // via the store module. A promotion failure aborts loudly.
              fullExtract = await extractPdf(buf, 150, 300);
              await ctx.runMutation(internal.legalDiscoveryStore.stagePromoted, {
                candidateId: args.candidateId,
                stableKey,
                identity: identity!,
                url: c.url,
                body: fullExtract.body,
                sections: fullExtract.sections,
                bytesHash: bytesHash!,
                listingKey: c.listingKey,
              });
              outcome = "promoted";
              sectionsCount = fullExtract.sections.length;
              bodyChars = fullExtract.body.length;
            } else {
              // All gates passed but outside the bounded auto-promote
              // policy → validated, human decides via the review queue.
              outcome = "validated";
            }
          } else if (retrievalOk && gates.duplicateOk) {
            // Retrieved fine but identity/extraction/language is
            // uncertain → human review, never a silent guess.
            outcome = "review";
          } else {
            // Not a usable document (non-PDF, oversized/undersized, or a
            // corpus duplicate) → rejected with the gate record kept.
            outcome = "rejected";
          }
          summary = gateSummary(
            gates,
            `identity=${JSON.stringify(identity)} key=${stableKey ?? "null"} sections=${sectionsCount || sample.sections.length} chars=${bodyChars} hindi=${hindiRatio.toFixed(4)} dup=${duplicateOf ?? "none"} policy=${listing.autoPromoteKeyPrefixes.join("|") || "(none)"}`,
          );
        } else {
          summary = gateSummary(gates, `magic=${gates.magicOk} size=${gates.sizeOk}`);
        }
      } else {
        summary = `FAILED[fetch] HTTP ${resp.status}`;
      }
    } catch (e) {
      summary = `FAILED[exception] ${e instanceof Error ? e.message : String(e)}`;
    }

    await ctx.runMutation(internal.legalDiscoveryStore.finishValidation, {
      candidateId: args.candidateId,
      outcome,
      gates,
      gateSummary: summary,
      detectedIdentity: identity ?? undefined,
      detectedStableKey: stableKey ?? undefined,
      duplicateOfStableKey: duplicateOf ?? undefined,
      sectionsCount,
      bodyChars,
      hindiRatio,
      bytesHash: bytesHash ?? undefined,
    });
    return { outcome };
  },
});

/**
 * Human promotion of a review/validated candidate (platform operator).
 * The SAME gates must all have passed — review exists for POLICY
 * uncertainty, never to bypass a failed validation gate.
 */
export const promoteFromReview = action({
  args: { candidateId: v.id("discoveryCandidates"), note: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ sourceId: string; alreadyPresent: boolean }> => {
    const op = (await ctx.runQuery(internal.legalDiscoveryStore.operatorCheck, {})) as {
      operator: boolean;
      operatorName: string | null;
    };
    if (!op.operator) throw new Error("Platform operator access required.");
    const c = (await ctx.runQuery(internal.legalDiscoveryStore.getCandidateFull, {
      candidateId: args.candidateId,
    })) as {
      status: string;
      url: string;
      listingKey: string;
      detectedStableKey: string | null;
      detectedIdentity: string | null;
      gates: Gates | null;
    } | null;
    if (!c) throw new Error("Candidate not found.");
    if (c.status !== "review" && c.status !== "validated") {
      throw new Error(`Only review/validated candidates can be promoted (status: ${c.status}).`);
    }
    const g = c.gates;
    if (
      !g || !g.magicOk || !g.sizeOk || !g.identityOk || !g.languageOk ||
      !g.sectionsOk || !g.s1Ok || !g.duplicateOk || !c.detectedStableKey || !c.detectedIdentity
    ) {
      throw new Error(
        "Not every validation gate passed — promotion refused (review cannot bypass validation).",
      );
    }
    const resp = await fetch(c.url, {
      headers: { "User-Agent": UA, Accept: "application/pdf" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${c.url}`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") {
      throw new Error("Response is not a PDF — promotion aborted.");
    }
    const full = await extractPdf(buf, 150, 300);
    return ctx.runMutation(internal.legalDiscoveryStore.stagePromoted, {
      candidateId: args.candidateId,
      stableKey: c.detectedStableKey,
      identity: c.detectedIdentity,
      url: c.url,
      body: full.body,
      sections: full.sections,
      bytesHash: sha256HexBytes(buf),
      listingKey: c.listingKey,
      reviewedBy: op.operatorName ?? undefined,
      reviewNote: args.note,
    });
  },
});

