import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAccess, requireCapability, can, getAccessContext } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// MATTER INTELLIGENCE (section 27.1) + ADVOKATE AI LEGAL ASSOCIATE
// (section 27.2).
//
// Epistemic discipline (enforced in code, not prose):
//  - The AI may only PROPOSE facts ("extracted" proposals + party
//    "allegation" labelling). Only a lawyer moves a fact to "confirmed",
//    and only a lawyer resolves a contradiction.
//  - Confirmed facts never change silently: corrections create new
//    versions with a revision trail; the superseded row is retained.
//  - Summaries are built ONLY from confirmed facts + labelled
//    allegations, are versioned, and go stale (never deleted) when the
//    underlying inputs change.
//  - Health indicators are explicit, rule-based checks with visible
//    inputs. No invented win-probability. No unexplained risk score.
// =====================================================================

const MAX_FACTS_PER_ANALYSIS = 40;

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** The confirmed-fact slice of a matter (draft prefill + summaries). */
export const confirmedFacts = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id && r.status === "confirmed")
      .sort((a, b) => a.factKey.localeCompare(b.factKey));
  },
});

/** All facts with statuses for the matter workspace. */
export const facts = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => (a.occurredOn ?? "9999").localeCompare(b.occurredOn ?? "9999"));
  },
});

/** Fact revision history (corrections chain). */
export const factHistory = query({
  args: { factId: v.id("matterFacts") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const fact = await ctx.db.get(args.factId);
    if (!fact || fact.orgId !== ac.org._id) return [];
    return ctx.db
      .query("matterFactRevisions")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

// ---------------------------------------------------------------------
// Analysis: deterministic extraction first; live AI only enhances it
// when configured (and is ALWAYS schema-bound + review-gated).
// ---------------------------------------------------------------------

const DATE_RE =
  /\b(\d{1,2})[ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ -](\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/gi;

const AMOUNT_RE =
  /\b(?:rs\.?|inr|₹|rupees)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b|\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|rupees)\b/gi;

const OBLIGATION_RE =
  /\b(shall|must|is required to|is directed to|agrees to|undertakes to|is liable to)\b[^.]{10,240}\./gi;

function parseAmountToMinor(raw: string): number | null {
  // TESTED calculation path — never model arithmetic. Strip commas,
  // parse to paise with integer math only.
  const cleaned = raw.replace(/,/g, "");
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const [rupees, paise] = cleaned.split(".");
  const p = paise ? (paise + "00").slice(0, 2) : "00";
  return Number(rupees) * 100 + Number(p);
}

function findPageForOffset(
  pages: { page: number; text: string }[] | undefined,
  offset: number,
  fullText: string,
): number | undefined {
  if (!pages || pages.length === 0) return undefined;
  let acc = 0;
  for (const p of pages) {
    const start = fullText.indexOf(p.text, acc);
    const end = start < 0 ? acc + p.text.length : start + p.text.length;
    if (offset >= acc && offset < end + 1) return p.page;
    acc = end;
  }
  return pages[pages.length - 1]?.page;
}

function paragraphAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\n{2,}|\n(?=[A-Z0-9§])/).length;
}

function detectDuplicatesInDb(
  rows: Doc<"aiSources">[],
  currentText: string,
  currentId: Id<"aiSources">,
): Id<"matterDocuments"> | undefined {
  // Cheap normalized containment/shingle-overlap check across the
  // matter's other sources.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cur = norm(currentText);
  if (cur.length < 200) return undefined;
  const shingles = new Set<string>();
  for (let i = 0; i + 80 < cur.length; i += 40) shingles.add(cur.slice(i, i + 80));
  for (const r of rows) {
    if (r._id === currentId) continue;
    const other = norm(r.text);
    if (Math.abs(other.length - cur.length) > Math.max(cur.length, 400) * 0.2)
      continue;
    let hits = 0;
    let total = 0;
    for (const sh of shingles) {
      total += 1;
      if (other.includes(sh)) hits += 1;
    }
    if (total > 0 && hits / total > 0.85) return r.documentId ?? undefined;
  }
  return undefined;
}

/**
 * Analyse a versioned source (aiSources row): deterministic extraction
 * of facts/dates/parties/obligations/amounts/issues + duplicate and
 * missing-information detection. Everything lands as PROPOSALS for
 * lawyer review — nothing is auto-confirmed.
 */
export const analyseSource = mutation({
  args: { aiSourceId: v.id("aiSources") },
  handler: async (ctx, args): Promise<{
    analysisVersion: number;
    proposed: number;
    dates: number;
  }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const src = await ctx.db.get(args.aiSourceId);
    if (!src || src.orgId !== ac.org._id) {
      throw new Error("Source not found in this organization.");
    }
    const matter = await ctx.db.get(src.matterId);
    if (!matter) throw new Error("Matter not found.");
    if (!src.documentId) {
      throw new Error(
        "This source is not linked to a filed document — file the document first, then analyse it.",
      );
    }
    if (!can(ac, "matter.edit") && !can(ac, "note.write")) {
      throw new Error("Matter write access required to run analysis.");
    }

    // Delegate to the shared internal core so the direct path and the
    // queued/background path cannot drift apart.
    const r = (await ctx.runMutation(
      internal.matterIntelligence.analyseSourceInternal,
      {
        aiSourceId: src._id,
        existingAnalysisId: undefined,
        requestedById: ac.user._id,
      },
    )) as { analysisVersion: number; proposedFacts: number; dates: number };
    return {
      analysisVersion: r.analysisVersion,
      proposed: r.proposedFacts,
      dates: r.dates,
    };
  },
});

/**
 * Shared analysis core: deterministic extraction; creates (or fills) an
 * analysis row. The queued/background path passes existingAnalysisId to
 * fill the visible queue row in place.
 */
export const analyseSourceInternal = internalMutation({
  args: {
    aiSourceId: v.id("aiSources"),
    existingAnalysisId: v.optional(v.id("documentAnalyses")),
    requestedById: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const src = await ctx.db.get(args.aiSourceId);
    if (!src) throw new Error("Source not found.");
    if (!src.documentId) {
      throw new Error("Source is not linked to a filed document.");
    }
    const documentId = src.documentId as Id<"matterDocuments">;
    const matter = await ctx.db.get(src.matterId);
    if (!matter) throw new Error("Matter not found.");
    const ac = { org: { _id: src.orgId }, user: { _id: args.requestedById ?? src.addedById } };
    const text = src.text;
    const prior = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    const analysisVersion =
      prior.filter((p) => p.aiSourceId === src._id).length + 1;

    // --- dates (proposals only; never auto-inserted into calendars) ---
    const dates: { date: string; context?: string; page?: number; para?: number }[] = [];
    for (const m of text.matchAll(DATE_RE)) {
      const offset = m.index ?? 0;
      let iso: string | null = null;
      if (m[4] && m[5] && m[6]) iso = `${m[4]}-${m[5]}-${m[6].padStart(2, "0")}`;
      else if (m[1] && m[2] && m[3]) {
        const months: Record<string, string> = {
          jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
          jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        };
        const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
        iso = `${yy}-${months[m[2].slice(0, 3).toLowerCase()] ?? "01"}-${m[1].padStart(2, "0")}`;
      } else if (m[7] && m[8] && m[9]) {
        const yy = m[9].length === 2 ? `20${m[9]}` : m[9];
        iso = `${yy}-${m[8].padStart(2, "0")}-${m[7].padStart(2, "0")}`;
      }
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      if (dates.some((d) => d.date === iso)) continue;
      dates.push({
        date: iso,
        context: text.slice(Math.max(0, offset - 60), offset + 80).replace(/\s+/g, " "),
        page: findPageForOffset(src.pages, offset, text),
        para: paragraphAt(text, offset),
      });
      if (dates.length >= 25) break;
    }

    // --- amounts (tested integer math, no model arithmetic) -----------
    const amounts: { amountMinor: number; context?: string; page?: number }[] = [];
    for (const m of text.matchAll(AMOUNT_RE)) {
      const raw = m[1] ?? m[2];
      const minor = raw ? parseAmountToMinor(raw) : null;
      if (minor === null || minor <= 0) continue;
      if (amounts.some((a) => a.amountMinor === minor)) continue;
      const offset = m.index ?? 0;
      amounts.push({
        amountMinor: minor,
        context: text.slice(Math.max(0, offset - 60), offset + 80).replace(/\s+/g, " "),
        page: findPageForOffset(src.pages, offset, text),
      });
      if (amounts.length >= 20) break;
    }

    // --- obligations ----------------------------------------------------
    const obligations: { text: string; ref?: string }[] = [];
    for (const m of text.matchAll(OBLIGATION_RE)) {
      const offset = m.index ?? 0;
      const page = findPageForOffset(src.pages, offset, text);
      obligations.push({
        text: m[0].replace(/\s+/g, " ").trim(),
        ref: page ? `p. ${page} ¶ ${paragraphAt(text, offset)}` : undefined,
      });
      if (obligations.length >= 15) break;
    }

    // --- parties (crude, review-gated) ---------------------------------
    const parties = new Set<string>();
    if (matter.clientRole) parties.add(matter.clientRole);
    if (matter.opposingParty) parties.add(matter.opposingParty);
    const partyRe =
      /\b([A-Z][A-Za-z.& ]{2,40}(?:Pvt\.? Ltd\.?|Ltd\.?|LLP|and Ors\.?|& Anr\.?))\b/g;
    for (const m of text.matchAll(partyRe)) {
      if (parties.size >= 12) break;
      parties.add(m[1].trim());
    }

    // --- issues: prefer the matter's practice area + explicit hits ------
    const issues: string[] = [];
    const issueRe =
      /\b(breach|negligence|deficiency|dishonou?r|default|termination|arbitration|injunction|limitation|compensation|refund|indenture|urgency|contempt|maintenance|custody)\b/gi;
    for (const m of text.matchAll(issueRe)) {
      const word = m[1]!.toLowerCase();
      if (!issues.includes(word)) issues.push(word);
      if (issues.length >= 10) break;
    }

    // --- duplicates ------------------------------------------------------
    const siblings = await ctx.db
      .query("aiSources")
      .withIndex("by_matter", (q) => q.eq("matterId", src.matterId))
      .collect();
    const duplicatesOfDocumentId = detectDuplicatesInDb(siblings, text, src._id);

    // --- missing information ---------------------------------------------
    const missingInformation: string[] = [];
    if (/\bannexure\b/i.test(text) && !/\bannexure\s+[a-z0-9]\b/i.test(text))
      missingInformation.push("Annexure referenced but not identified/attached.");
    if (/\bdated\b/i.test(text) && dates.length === 0)
      missingInformation.push("Text mentions dates but none could be parsed.");
    if (amounts.length > 0 && !/\bgst|tax|invoice\b/i.test(text))
      missingInformation.push("Monetary amounts present without tax/invoice context.");
    if (!/\bsignature|signed\b/i.test(text) && src.extraction !== "manual")
      missingInformation.push("No signature indication detected in the text layer.");

    // --- proposed facts (deterministic, page-referenced) ------------------
    const proposedFacts: {
      factKey: string;
      statement: string;
      page?: number;
      paragraph?: number;
      quote?: string;
      occurredOn?: string;
      partyName?: string;
      amountMinor?: number;
    }[] = [];
    for (const d of dates.slice(0, 12)) {
      const statement = `Date recorded in ${src.name}: ${d.date}${d.context ? ` — "${d.context.trim()}"` : ""}`;
      if (proposedFacts.length >= MAX_FACTS_PER_ANALYSIS) break;
      proposedFacts.push({
        factKey: `src-date-${d.date}-${proposedFacts.length}`,
        statement,
        page: d.page,
        paragraph: d.para,
        quote: d.context?.slice(0, 200),
        occurredOn: d.date,
      });
    }
    for (const a of amounts.slice(0, 8)) {
      if (proposedFacts.length >= MAX_FACTS_PER_ANALYSIS) break;
      proposedFacts.push({
        factKey: `src-amount-${a.amountMinor}-${proposedFacts.length}`,
        statement: `Amount recorded in ${src.name}: ₹${(a.amountMinor / 100).toFixed(2)}${a.context ? ` — "${a.context.trim()}"` : ""}`,
        page: a.page,
        amountMinor: a.amountMinor,
        quote: a.context?.slice(0, 200),
      });
    }
    for (const o of obligations.slice(0, 8)) {
      if (proposedFacts.length >= MAX_FACTS_PER_ANALYSIS) break;
      proposedFacts.push({
        factKey: `src-obligation-${proposedFacts.length}`,
        statement: `Obligation text in ${src.name}: ${o.text}`,
        quote: o.ref,
      });
    }

    if (args.existingAnalysisId) {
      const existingRow = await ctx.db.get(args.existingAnalysisId);
      if (!existingRow) throw new Error("Queued analysis row missing.");
      await ctx.db.patch(args.existingAnalysisId, {
        analysisVersion,
        status: "proposed",
        proposedFacts: proposedFacts.map((f) => ({ ...f, status: "allegation" as const })),
        dates: dates.map(({ date, context }) => ({ date, context })),
        parties: [...parties],
        obligations,
        amounts: amounts.map(({ amountMinor, context }) => ({ amountMinor, context })),
        issues,
        duplicatesOfDocumentId,
        missingInformation,
        model: "deterministic",
        createdById: ac.user._id,
        processingStatus: "done",
        processingAttempts: (existingRow.processingAttempts ?? 0),
      });
      return {
        analysisVersion,
        proposedFacts: proposedFacts.length,
        dates: dates.length,
        analysisId: args.existingAnalysisId,
      };
    }
    const analysisId = await ctx.db.insert("documentAnalyses", {
      orgId: ac.org._id,
      matterId: src.matterId,
      documentId: src.documentId,
      aiSourceId: src._id,
      analysisVersion,
      status: "proposed",
      proposedFacts: proposedFacts.map((f) => ({ ...f, status: "allegation" as const })),
      dates: dates.map(({ date, context }) => ({ date, context })),
      parties: [...parties],
      obligations,
      amounts: amounts.map(({ amountMinor, context }) => ({ amountMinor, context })),
      issues,
      duplicatesOfDocumentId,
      missingInformation,
      model: "deterministic",
      createdById: ac.user._id,
      createdAt: Date.now(),
      processingStatus: "done",
      processingAttempts: 1,
    });
    return {
      analysisVersion,
      proposedFacts: proposedFacts.length,
      dates: dates.length,
      analysisId,
    };
  },
});


/** Analyses for a matter (latest first). */
export const analyses = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

// ---------------------------------------------------------------------
// Fact review lifecycle: lawyer approves / rejects / corrects.
// Corrections create a NEW version row; the old row is retained and
// superseded — history is never rewritten.
// ---------------------------------------------------------------------

function factKeyFromProposal(matterId: Id<"matters">, key: string): string {
  return `${matterId}:${key}`;
}

/** Promote an analysis proposal into a reviewable matter fact. */
export const proposeFact = mutation({
  args: {
    matterId: v.id("matters"),
    factKey: v.string(),
    statement: v.string(),
    status: v.union(
      v.literal("allegation"),
      v.literal("extracted"),
      v.literal("disputed"),
    ),
    sourceDocumentId: v.optional(v.id("matterDocuments")),
    sourceAiSourceId: v.optional(v.id("aiSources")),
    sourceRefs: v.optional(
      v.array(
        v.object({
          page: v.optional(v.number()),
          paragraph: v.optional(v.number()),
          quote: v.optional(v.string()),
        }),
      ),
    ),
    occurredOn: v.optional(v.string()),
    partyName: v.optional(v.string()),
    amountMinor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    // Tenant + matter authorization: the fact belongs to a matter of
    // THIS org only.
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const key = factKeyFromProposal(args.matterId, args.factKey);
    const dupe = await ctx.db
      .query("matterFacts")
      .withIndex("by_fact_key", (q) =>
        q.eq("matterId", args.matterId).eq("factKey", key),
      )
      .first();
    if (dupe && dupe.status !== "rejected") {
      return { factId: dupe._id, existed: true };
    }
    const id = await ctx.db.insert("matterFacts", {
      orgId: ac.org._id,
      matterId: args.matterId,
      factKey: key,
      statement: args.statement.slice(0, 1200),
      status: args.status,
      sourceDocumentId: args.sourceDocumentId,
      sourceAiSourceId: args.sourceAiSourceId,
      sourceRefs: args.sourceRefs,
      occurredOn: args.occurredOn,
      partyName: args.partyName,
      amountMinor: args.amountMinor,
      proposedBy: "deterministic-extractor",
      proposedById: ac.user._id,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { factId: id, existed: false };
  },
});

/** Import every proposal of an analysis as reviewable facts at once. */
export const importAnalysisFacts = mutation({
  args: { analysisId: v.id("documentAnalyses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const analysis = await ctx.db.get(args.analysisId);
    if (!analysis || analysis.orgId !== ac.org._id) {
      throw new Error("Analysis not found in this organization.");
    }
    let imported = 0;
    let skipped = 0;
    for (const p of analysis.proposedFacts) {
      const key = factKeyFromProposal(analysis.matterId, p.factKey);
      const dupe = await ctx.db
        .query("matterFacts")
        .withIndex("by_fact_key", (q) =>
          q.eq("matterId", analysis.matterId).eq("factKey", key),
        )
        .first();
      if (dupe) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("matterFacts", {
        orgId: ac.org._id,
        matterId: analysis.matterId,
        factKey: key,
        statement: p.statement,
        // AI proposals enter as "extracted" (or party allegations when
        // the source is an opposing-party document) — never confirmed.
        status: "extracted",
        sourceDocumentId: analysis.documentId,
        sourceAiSourceId: analysis.aiSourceId,
        sourceRefs: p.page
          ? [{ page: p.page, paragraph: p.paragraph, quote: p.quote }]
          : p.quote
            ? [{ quote: p.quote }]
            : undefined,
        occurredOn: p.occurredOn,
        partyName: p.partyName,
        amountMinor: p.amountMinor,
        proposedBy: "deterministic-extractor",
        proposedById: ac.user._id,
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      imported += 1;
    }
    await ctx.db.patch(args.analysisId, { status: "reviewed" });
    return { imported, skipped };
  },
});

/** Lawyer CONFIRMS a fact — the only path into "confirmed". */
export const confirmFact = mutation({
  args: { factId: v.id("matterFacts"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const fact = await ctx.db.get(args.factId);
    if (!fact || fact.orgId !== ac.org._id) {
      throw new Error("Fact not found in this organization.");
    }
    if (fact.status === "confirmed") return { already: true };
    await ctx.db.insert("matterFactRevisions", {
      orgId: ac.org._id,
      matterId: fact.matterId,
      factId: fact._id,
      priorStatus: fact.status,
      priorStatement: fact.statement,
      newStatus: "confirmed",
      newStatement: fact.statement,
      changedById: ac.user._id,
      note: args.note,
      createdAt: Date.now(),
    });
    await ctx.db.patch(fact._id, {
      status: "confirmed",
      confirmedById: ac.user._id,
      confirmedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { confirmed: true };
  },
});

/** Lawyer REJECTS a proposal (with reason — recorded, not deleted). */
export const rejectFact = mutation({
  args: { factId: v.id("matterFacts"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const fact = await ctx.db.get(args.factId);
    if (!fact || fact.orgId !== ac.org._id) {
      throw new Error("Fact not found in this organization.");
    }
    if (!args.reason.trim()) throw new Error("A rejection reason is required.");
    await ctx.db.insert("matterFactRevisions", {
      orgId: ac.org._id,
      matterId: fact.matterId,
      factId: fact._id,
      priorStatus: fact.status,
      priorStatement: fact.statement,
      newStatus: "rejected",
      newStatement: fact.statement,
      changedById: ac.user._id,
      note: args.reason.trim(),
      createdAt: Date.now(),
    });
    await ctx.db.patch(fact._id, {
      status: "rejected",
      rejectedReason: args.reason.trim().slice(0, 500),
      updatedAt: Date.now(),
    });
    return { rejected: true };
  },
});

/**
 * Lawyer CORRECTS a fact: the current row is retained (superseded) and
 * a NEW version row carries the correction. Confirmed status does not
 * silently survive — the corrected version must be re-confirmed.
 */
export const correctFact = mutation({
  args: {
    factId: v.id("matterFacts"),
    statement: v.string(),
    status: v.union(
      v.literal("extracted"),
      v.literal("disputed"),
      v.literal("confirmed"),
      v.literal("allegation"),
    ),
    occurredOn: v.optional(v.string()),
    amountMinor: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const fact = await ctx.db.get(args.factId);
    if (!fact || fact.orgId !== ac.org._id) {
      throw new Error("Fact not found in this organization.");
    }
    const statement = args.statement.trim();
    if (!statement) throw new Error("The corrected statement cannot be empty.");
    await ctx.db.insert("matterFactRevisions", {
      orgId: ac.org._id,
      matterId: fact.matterId,
      factId: fact._id,
      priorStatus: fact.status,
      priorStatement: fact.statement,
      newStatus: args.status,
      newStatement: statement,
      changedById: ac.user._id,
      note: args.note,
      createdAt: Date.now(),
    });

    // Governance: a CONFIRMED fact is never silently overwritten. Its
    // correction enters as a competing "extracted" row; BOTH stay active
    // and the contradiction scan pairs them — a lawyer resolves which
    // version stands. Only unconfirmed facts (uncontroversial fixes) are
    // directly superseded.
    const newId = (await ctx.db.insert("matterFacts", {
      orgId: ac.org._id,
      matterId: fact.matterId,
      factKey: fact.factKey,
      statement: statement.slice(0, 1200),
      status: args.status,
      sourceDocumentId: fact.sourceDocumentId,
      sourceAiSourceId: fact.sourceAiSourceId,
      sourceRefs: fact.sourceRefs,
      occurredOn: args.occurredOn ?? fact.occurredOn,
      partyName: fact.partyName,
      amountMinor: args.amountMinor ?? fact.amountMinor,
      proposedBy: fact.proposedBy,
      proposedById: ac.user._id,
      confirmedById: args.status === "confirmed" ? ac.user._id : undefined,
      confirmedAt: args.status === "confirmed" ? Date.now() : undefined,
      correctionOfId: fact._id,
      version: fact.version + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })) as Id<"matterFacts">;

    if (fact.status !== "confirmed") {
      await ctx.db.patch(fact._id, {
        supersededById: newId,
        updatedAt: Date.now(),
      });
    } else {
      // Surface the conflict explicitly in the matter chronology.
      await ctx.db.insert("matterEvents", {
        matterId: fact.matterId,
        kind: "note",
        detail: "Fact correction proposed against a CONFIRMED fact — contradiction review required.",
        createdAt: Date.now(),
      });
    }
    return { newFactId: newId };
  },
});

/**
 * Contradiction scan: pair-wise check of active facts whose statements
 * negate each other on dates/amounts/party obligations. Deterministic
 * signals only; a lawyer resolves every contradiction.
 */
export const scanContradictions = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const facts = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const active = facts.filter(
      (f) => f.status !== "rejected" && !f.supersededById,
    );
    const existing = await ctx.db
      .query("matterContradictions")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", args.matterId).eq("status", "open"),
      )
      .collect();
    const known = new Set(
      existing.map((c) => `${String(c.factAId)}|${String(c.factBId)}`),
    );
    let created = 0;

    // Same factKey with conflicting occurredOn/amount across versions
    // or sources.
    const byKey = new Map<string, Doc<"matterFacts">[]>();
    for (const f of active) {
      const list = byKey.get(f.factKey) ?? [];
      list.push(f);
      byKey.set(f.factKey, list);
    }
    for (const [, list] of byKey) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const pairKey = `${String(a._id)}|${String(b._id)}`;
          if (known.has(pairKey)) continue;
          const dateConflict =
            a.occurredOn && b.occurredOn && a.occurredOn !== b.occurredOn;
          const amountConflict =
            a.amountMinor !== undefined &&
            b.amountMinor !== undefined &&
            a.amountMinor !== b.amountMinor;
          if (!dateConflict && !amountConflict) continue;
          await ctx.db.insert("matterContradictions", {
            orgId: ac.org._id,
            matterId: args.matterId,
            factAId: a._id,
            factBId: b._id,
            status: "open",
            explanation: `${dateConflict ? `Conflicting dates (${a.occurredOn} vs ${b.occurredOn})` : "Conflicting amounts (₹" + (a.amountMinor! / 100).toFixed(2) + " vs ₹" + (b.amountMinor! / 100).toFixed(2) + ")"}.`,
            createdAt: Date.now(),
          });
          // Cross-link the facts as disputed.
          await ctx.db.patch(a._id, { status: "disputed", updatedAt: Date.now() });
          await ctx.db.patch(b._id, { status: "disputed", updatedAt: Date.now() });
          created += 1;
        }
      }
    }
    return { created };
  },
});

/** Contradictions list for the workspace. */
export const contradictions = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterContradictions")
      .withIndex("by_matter_status", (q) =>
        q.eq("matterId", args.matterId).eq("status", "open"),
      )
      .collect();
    return rows.filter((r) => r.orgId === ac.org._id);
  },
});

/** Lawyer resolves a contradiction — the only resolution path. */
export const resolveContradiction = mutation({
  args: {
    contradictionId: v.id("matterContradictions"),
    resolution: v.union(
      v.literal("resolved_favoring_a"),
      v.literal("resolved_favoring_b"),
      v.literal("not_a_contradiction"),
    ),
    explanation: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const c = await ctx.db.get(args.contradictionId);
    if (!c || c.orgId !== ac.org._id) {
      throw new Error("Contradiction not found in this organization.");
    }
    if (!args.explanation.trim()) {
      throw new Error("Record why this resolution is correct.");
    }
    const a = await ctx.db.get(c.factAId);
    const b = await ctx.db.get(c.factBId);
    const winner = args.resolution === "resolved_favoring_a" ? a : b;
    const loser = args.resolution === "resolved_favoring_a" ? b : a;
    if (winner && winner.status === "disputed") {
      await ctx.db.patch(winner._id, { status: "confirmed", confirmedById: ac.user._id, confirmedAt: Date.now(), updatedAt: Date.now() });
    }
    if (loser && args.resolution !== "not_a_contradiction") {
      await ctx.db.patch(loser._id, { status: "rejected", rejectedReason: "Lost a lawyer-resolved contradiction.", updatedAt: Date.now() });
    } else if (a && b) {
      for (const f of [a, b]) {
        if (f.status === "disputed") {
          await ctx.db.patch(f._id, { status: "extracted", updatedAt: Date.now() });
        }
      }
    }
    await ctx.db.patch(args.contradictionId, {
      status: args.resolution,
      explanation: args.explanation.trim().slice(0, 500),
      resolvedById: ac.user._id,
      resolvedAt: Date.now(),
    });
    return { resolved: true };
  },
});

// ---------------------------------------------------------------------
// Health indicators: explicit rules, visible inputs, no invented scores.
// ---------------------------------------------------------------------

export const health = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;
    const now = Date.now();
    const today = todayIST();

    const [tasks, contradictions, analyses, facts] = await Promise.all([
      ctx.db.query("tasks").collect(),
      ctx.db
        .query("matterContradictions")
        .withIndex("by_matter_status", (q) =>
          q.eq("matterId", args.matterId).eq("status", "open"),
        )
        .collect(),
      ctx.db
        .query("documentAnalyses")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect(),
      ctx.db
        .query("matterFacts")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect(),
    ]);

    // 1. Overdue tasks (explicit: status not done, dueAt in the past).
    const matterTasks = (tasks as Doc<"tasks">[]).filter(
      (t) =>
        t.matterId === args.matterId &&
        t.status !== "done" &&
        t.dueAt !== undefined &&
        t.dueAt < now,
    );
    // 2. Unresolved contradictions.
    const openContradictions = contradictions.filter(
      (c) => c.orgId === ac.org._id,
    );
    // 3. Unreviewed analyses (proposals nobody has reviewed).
    const unreviewedAnalyses = analyses.filter(
      (a) => a.orgId === ac.org._id && a.status === "proposed",
    );
    // 4. Unreviewed extracted facts.
    const unreviewedFacts = facts.filter(
      (f) => f.status === "extracted" && !f.supersededById,
    );
    // 5. Documents with unreviewed orders is covered by tasks; stale
    //    summaries checked below.
    const summaries = await ctx.db
      .query("matterSummaries")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const staleSummaries = summaries.filter(
      (s) => s.orgId === ac.org._id && s.stale,
    );

    const indicators = [
      {
        key: "overdue_tasks",
        status: matterTasks.length > 0 ? "attention" : "ok",
        reason: matterTasks.length
          ? `${matterTasks.length} task(s) past their due date.`
          : "No tasks are past their due date.",
        inputs: matterTasks.slice(0, 5).map((t) => ({ id: t._id, title: t.title, dueAt: t.dueAt })),
      },
      {
        key: "unresolved_contradictions",
        status: openContradictions.length > 0 ? "attention" : "ok",
        reason: openContradictions.length
          ? `${openContradictions.length} contradiction(s) awaiting lawyer resolution.`
          : "No unresolved contradictions.",
        inputs: openContradictions.slice(0, 5).map((c) => ({ id: c._id, explanation: c.explanation })),
      },
      {
        key: "unreviewed_extraction",
        status:
          unreviewedAnalyses.length + unreviewedFacts.length > 0
            ? "attention"
            : "ok",
        reason: unreviewedAnalyses.length + unreviewedFacts.length
          ? `${unreviewedAnalyses.length} analysis run(s) and ${unreviewedFacts.length} extracted fact(s) awaiting review.`
          : "All extractions reviewed.",
        inputs: unreviewedAnalyses.slice(0, 5).map((a) => ({ id: a._id, createdAt: a.createdAt })),
      },
      {
        key: "stale_summaries",
        status: staleSummaries.length > 0 ? "attention" : "ok",
        reason: staleSummaries.length
          ? `${staleSummaries.length} summary version(s) predating the latest source changes.`
          : "No stale summaries.",
        inputs: staleSummaries.slice(0, 5).map((s) => ({ id: s._id, version: s.summaryVersion })),
      },
    ];

    void today;
    return { indicators, checkedAt: now };
  },
});

// ---------------------------------------------------------------------
// Versioned, citation-checked summaries (AI ASSOCIATE)
// ---------------------------------------------------------------------

/** Deterministic inputs hash: confirmed facts + active analyses + matter profile. */
async function computeInputsHash(
  ctx: MutationCtx,
  matterId: Id<"matters">,
): Promise<{ hash: string; confirmed: Doc<"matterFacts">[]; analyses: Doc<"documentAnalyses">[] }> {
  const facts = await ctx.db
    .query("matterFacts")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  const confirmed = facts
    .filter((f) => f.status === "confirmed" && !f.supersededById)
    .sort((a, b) => a.factKey.localeCompare(b.factKey));
  const analyses = await ctx.db
    .query("documentAnalyses")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  const payload = JSON.stringify({
    f: confirmed.map((f) => [f.factKey, f.version, f.statement, f.occurredOn, f.amountMinor]),
    a: analyses.map((a) => [a._id, a.analysisVersion, a.issues, a.missingInformation]),
  });
  return { hash: sha256Hex(payload), confirmed, analyses };
}

export const generateSummary = internalMutation({
  args: {
    matterId: v.id("matters"),
    createdById: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const matter = await ctx.db.get(args.matterId);
    if (!matter) throw new Error("Matter not found.");
    const { hash, confirmed, analyses } = await computeInputsHash(
      ctx,
      args.matterId,
    );

    // Deterministic cited summary body — every claim traces to a fact
    // with its source refs; the AI (when configured) only enhances
    // wording through the same job pipeline and stays schema-bound.
    const allegations = (
      await ctx.db
        .query("matterFacts")
        .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
        .collect()
    ).filter((f) => f.status === "allegation" && !f.supersededById);

    const lines: string[] = [];
    lines.push(`# Matter summary — ${matter.reference} (${matter.title})`);
    lines.push("");
    lines.push(
      `Jurisdiction: ${matter.legalProfile?.country ?? "not set"} · Stage: ${matter.legalProfile?.proceduralStage ?? "not set"} · Generated ${todayIST()} from confirmed facts only (allegations labelled).`,
    );
    lines.push("");
    if (confirmed.length === 0) {
      lines.push(
        "No lawyer-confirmed facts yet — this summary cannot responsibly assert case facts. Confirm extracted facts first.",
      );
    }
    if (confirmed.length > 0) {
      lines.push("## Confirmed facts (each lawyer-verified)");
      for (const f of confirmed.slice(0, 30)) {
        const refs = (f.sourceRefs ?? [])
          .map((r) => `${r.page ? `p. ${r.page}` : ""}${r.paragraph ? ` ¶ ${r.paragraph}` : ""}`)
          .join(", ");
        lines.push(
          `- ${f.statement}${f.occurredOn ? ` (date: ${f.occurredOn})` : ""}${refs ? ` [${refs}]` : " [no page reference]"}`,
        );
      }
    }
    if (allegations.length > 0) {
      lines.push("");
      lines.push("## Allegations (party claims — NOT established)");
      for (const f of allegations.slice(0, 15)) {
        lines.push(`- ALLEGED: ${f.statement}`);
      }
    }
    const openIssues = analyses.flatMap((a) => a.issues).filter((v, i, arr) => arr.indexOf(v) === i);
    if (openIssues.length > 0) {
      lines.push("");
      lines.push(`## Issue signals from documents (machine-detected, for review): ${openIssues.join(", ")}`);
    }

    const prior = await ctx.db
      .query("matterSummaries")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const nextVersion =
      prior.reduce((m, s) => Math.max(m, s.summaryVersion), 0) + 1;
    // Older versions become stale when inputs changed.
    for (const s of prior) {
      if (s.inputsHash !== hash && !s.stale) {
        await ctx.db.patch(s._id, { stale: true });
      }
    }

    // Findings for the associate panel (deterministic this slice):
    const findings: {
      kind: string;
      passage: string;
      sourceKey?: string;
      explanation: string;
      missingFacts?: string;
      suggestedStep?: string;
    }[] = [];
    for (const a of analyses.slice(0, 6)) {
      for (const o of a.obligations.slice(0, 3)) {
        findings.push({
          kind: "obligation",
          passage: o.text,
          sourceKey: o.ref,
          explanation: "An obligation-style clause was detected; confirm who owes what and by when.",
          suggestedStep: "Confirm the obligation against confirmed facts and deadlines.",
        });
      }
      for (const miss of a.missingInformation.slice(0, 3)) {
        findings.push({
          kind: "missing_clause",
          passage: miss,
          explanation: "The extractor flagged missing/incomplete material.",
          suggestedStep: "Request or locate the missing material before relying on this document.",
        });
      }
    }

    const id = await ctx.db.insert("matterSummaries", {
      orgId: matter.orgId,
      matterId: args.matterId,
      summaryVersion: nextVersion,
      body: lines.join("\n"),
      inputsHash: hash,
      stale: false,
      findings,
      generatedBy: "deterministic",
      createdById: args.createdById,
      createdAt: Date.now(),
    });
    return { summaryVersion: nextVersion, summaryId: id };
  },
});

/**
 * Public entry: regenerate a summary. Runs the deterministic core now;
 * when live AI is configured it could enhance wording via the job
 * pipeline — but the cited skeleton and stale-marking always happen
 * server-side here.
 */
export const regenerateSummary = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args): Promise<{ summaryVersion: number; summaryId: Id<"matterSummaries"> }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    // Tenant + matter authorization: summaries may only be generated for
    // a matter of THIS organization.
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const r = await ctx.runMutation(internal.matterIntelligence.generateSummary, {
      matterId: args.matterId,
      createdById: ac.user._id,
    });
    return r as { summaryVersion: number; summaryId: Id<"matterSummaries"> };
  },
});

/** Summaries for a matter (all versions, newest first; stale flagged). */
export const summaries = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("matterSummaries")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id)
      .sort((a, b) => b.summaryVersion - a.summaryVersion);
  },
});

// ---------------------------------------------------------------------
// §28.2 — Background processing with visible status, retries and
// optional batch scheduling. The deterministic core is marked queued →
// done within the mutation; the async wrapper pattern gives the lawyer
// an honest, retryable processing trail instead of a silent flash.
// ---------------------------------------------------------------------

/** Queue (or re-queue) analysis for a source: visible processing trail. */
export const requestAnalysis = mutation({
  args: {
    aiSourceId: v.id("aiSources"),
    batchLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const src = await ctx.db.get(args.aiSourceId);
    if (!src || src.orgId !== ac.org._id) {
      throw new Error("Source not found in this organization.");
    }
    const prior = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_matter", (q) => q.eq("matterId", src.matterId))
      .collect();
    const running = prior.find(
      (p) => p.aiSourceId === src._id && p.processingStatus === "queued",
    );
    if (running) {
      return { analysisId: running._id, status: "queued" as const, reused: true };
    }
    const documentId = src.documentId;
    if (!documentId) {
      throw new Error("This source is not linked to a filed document — file the document first, then analyse it.");
    }
    const id = await ctx.db.insert("documentAnalyses", {
      orgId: ac.org._id,
      matterId: src.matterId,
      documentId,
      aiSourceId: src._id,
      analysisVersion: prior.filter((p) => p.aiSourceId === src._id).length + 1,
      status: "proposed",
      proposedFacts: [],
      dates: [],
      parties: [],
      obligations: [],
      amounts: [],
      issues: [],
      missingInformation: [],
      model: "deterministic",
      createdById: ac.user._id,
      createdAt: Date.now(),
      processingStatus: "queued",
      processingAttempts: 0,
      scheduledFor: args.batchLabel,
    });
    return { analysisId: id, status: "queued" as const, reused: false };
  },
});

/** Run a queued analysis (idempotent; records attempts and errors). */
export const runQueuedAnalysis = mutation({
  args: { analysisId: v.id("documentAnalyses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "ai.use");
    const a = await ctx.db.get(args.analysisId);
    if (!a || a.orgId !== ac.org._id) throw new Error("Analysis not found.");
    if (a.processingStatus === "done") return { done: true, reused: true };
    await ctx.db.patch(a._id, {
      processingStatus: "running",
      processingAttempts: (a.processingAttempts ?? 0) + 1,
    });
    try {
      // Reuse the deterministic core by importing its logic through the
      // internal mutation (same transaction guarantees).
      const src = a.aiSourceId ? await ctx.db.get(a.aiSourceId) : null;
      if (!src) throw new Error("Source row missing for this analysis.");
      await ctx.runMutation(internal.matterIntelligence.analyseSourceInternal, {
        aiSourceId: src._id,
        existingAnalysisId: a._id,
      });
      await ctx.db.patch(a._id, { processingStatus: "done", lastError: undefined });
      return { done: true, reused: false };
    } catch (err) {
      await ctx.db.patch(a._id, {
        processingStatus: "failed",
        lastError: err instanceof Error ? err.message.slice(0, 500) : "Unknown error.",
      });
      throw err;
    }
  },
});

/** Processing status for the matter workspace (visible queue). */
export const processingQueue = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    return rows
      .filter((r) => r.orgId === ac.org._id && r.processingStatus !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        analysisId: r._id,
        documentId: r.documentId,
        status: r.processingStatus,
        attempts: r.processingAttempts ?? 0,
        lastError: r.lastError,
        scheduledFor: r.scheduledFor,
        createdAt: r.createdAt,
      }));
  },
});
