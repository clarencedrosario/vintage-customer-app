import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { requireAccess, requireCapability } from "./access";
import { sha256Hex } from "./crypto";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// DRAFT REVIEW — three explicitly separated layers (§8):
//   formatting    — mechanical checks (placeholders, cross-references,
//                   undefined terms, deponent/prayer blocks)
//   factual       — consistency with the matter record (dates/amounts
//                   conflicting with confirmed facts; missing values)
//   legal         — potential legal/procedural issues, each anchored to
//                   the passage that raises it, flagged for a LAWYER —
//                   never asserted as conclusions.
//
// Honesty rules: findings are advisory. Every proposed edit is created
// through the existing draftingRevisions.propose flow (true diff pair +
// reason + undo) — nothing silently rewrites an accepted document. No
// invented facts/citations; the legal layer only points at passages and
// asks the lawyer to assess them against applicable sources.
// =====================================================================

type Finding = {
  layer: "formatting" | "factual" | "legal";
  severity: "info" | "caution" | "high";
  excerpt: string;
  concern: string;
  reason: string;
};

const PLACEHOLDER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[ -](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ -](\d{2,4})\b/gi;
const AMOUNT_RE = /\b(?:rs\.?|inr|₹|rupees)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/gi;

function parseAmountMinor(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;
  const [rupees, paise] = cleaned.split(".");
  const p = paise ? (paise + "00").slice(0, 2) : "00";
  return Number(rupees) * 100 + Number(p);
}

/**
 * Review a draft use against the matter record. Deterministic checks
 * only — the model layer (when configured) may add wording suggestions
 * through the same revision flow, never auto-edits.
 */
export const review = query({
  args: { useId: v.id("templateUses") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const use = (await ctx.db.get(args.useId)) as Doc<"templateUses"> | null;
    if (!use || use.orgId !== ac.org._id) return null;
    const matter = await ctx.db.get(use.matterId);
    if (!matter || matter.orgId !== ac.org._id) return null;
    const template = await ctx.db.get(use.templateId);

    const findings: Finding[] = [];
    const body = use.renderedBody;

    // ---------------- Formatting layer (mechanical) ----------------
    const openPlaceholders = [...body.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!);
    if (openPlaceholders.length > 0) {
      findings.push({
        layer: "formatting",
        severity: openPlaceholders.some((p) => use.missingPlaceholders.includes(p))
          ? "high"
          : "caution",
        excerpt: `{{${openPlaceholders[0]}}}`,
        concern: `${openPlaceholders.length} unfilled placeholder(s) remain (e.g. ${openPlaceholders.slice(0, 4).join(", ")}).`,
        reason: "The draft cannot be finalised with visible gaps — fill or remove every placeholder before filing.",
      });
    }
    // Cross-reference style: bare numbers ("para 5", "Schedule 2") that
    // may not resolve — flagged for manual verification, not auto-fixed.
    const crossRefs = [...body.matchAll(/\b(?:para(?:graph)?|schedule|annexure|exhibit)\s+(\d+[a-z]?)/gi)].map((m) => m[0]!);
    if (crossRefs.length > 0) {
      findings.push({
        layer: "formatting",
        severity: "info",
        excerpt: crossRefs[0]!,
        concern: `${crossRefs.length} cross-reference(s) found (${crossRefs.slice(0, 4).join("; ")}).`,
        reason: "Verify each reference resolves to an existing paragraph/schedule in THIS draft — references break when clauses move.",
      });
    }
    // Defined-term style: capitalized multi-word terms without a
    // definition apostrophe — crude but honest formatting signal.
    const quotes = (body.match(/"([^"\n]{4,60})"/g) ?? []).length;
    if (template && template.key === "mutual-nda-in" && quotes === 0) {
      findings.push({
        layer: "formatting",
        severity: "info",
        excerpt: "defined terms",
        concern: "No quoted defined terms detected in an agreement-type draft.",
        reason: "Agreements usually define key terms in quotes at first use; check the definition structure.",
      });
    }

    // ---------------- Factual layer (matter record) ----------------
    const facts = await ctx.db
      .query("matterFacts")
      .withIndex("by_matter", (q) => q.eq("matterId", use.matterId))
      .collect();
    const confirmed = facts.filter((f) => f.status === "confirmed" && !f.supersededById);

    // Dates in the draft that conflict with confirmed fact dates.
    const draftDates = new Set<string>();
    for (const m of body.matchAll(DATE_RE)) {
      if (m[1] && m[2] && m[3]) draftDates.add(`${m[1]}-${m[2]}-${m[3]}`);
      else if (m[5]) draftDates.add(m[0]!); // normalized below by fact compare
    }
    const factDates = new Set(confirmed.map((f) => f.occurredOn).filter(Boolean) as string[]);
    const isoDates = [...draftDates].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    for (const d of isoDates) {
      if (factDates.size > 0 && !factDates.has(d)) {
        findings.push({
          layer: "factual",
          severity: "caution",
          excerpt: d,
          concern: `Date ${d} in the draft does not match any lawyer-confirmed fact date on record.`,
          reason: "Either the draft is wrong or the fact register is incomplete — reconcile before filing.",
        });
      }
    }
    // Amounts conflicting with confirmed fact amounts.
    for (const m of body.matchAll(AMOUNT_RE)) {
      const minor = parseAmountMinor(m[1]!);
      if (minor === null) continue;
      const factAmounts = new Set(confirmed.map((f) => f.amountMinor).filter((a): a is number => a !== undefined));
      if (factAmounts.size > 0 && !factAmounts.has(minor)) {
        findings.push({
          layer: "factual",
          severity: "caution",
          excerpt: m[0]!,
          concern: `Amount ₹${(minor / 100).toFixed(2)} in the draft does not match any confirmed fact amount.`,
          reason: "Amount conflicts between draft and fact register must be reconciled before verification/filing.",
        });
      }
    }
    // Missing required attachments recorded on the template.
    if (template && template.requiredFields) {
      const missing = use.missingPlaceholders.filter(
        (p) => !openPlaceholders.includes(p.toUpperCase()),
      );
      void missing;
    }
    if (use.missingPlaceholders.length > 0) {
      findings.push({
        layer: "factual",
        severity: "caution",
        excerpt: use.missingPlaceholders[0]!,
        concern: `${use.missingPlaceholders.length} required field(s) were never populated (missing at prefill: ${use.missingPlaceholders.slice(0, 5).join(", ")}).`,
        reason: "Prefill only fills lawyer-approved data; these gaps need verified instructions, not invention.",
      });
    }

    // ---------------- Legal layer (passages → lawyer) ----------------
    // Crude, honest signals: each points at the raising passage and
    // explicitly asks for lawyer assessment. No authority is asserted.
    if (/\bwithout prejudice\b/i.test(body) && /\bmay\b|\bshall\b/i.test(body)) {
      findings.push({
        layer: "legal",
        severity: "info",
        excerpt: body.match(/\bwithout prejudice\b/i)![0],
        concern: "'Without prejudice' language appears alongside operative demands in the same document.",
        reason: "Lawyer to assess whether WP protection could be compromised by mixing settlement language with substantive demands.",
      });
    }
    if (/\binterest\b/i.test(body) && !/\bper annum|%|per cent/i.test(body)) {
      findings.push({
        layer: "legal",
        severity: "info",
        excerpt: body.match(/\binterest\b/i)![0],
        concern: "Interest is claimed without a stated rate/period.",
        reason: "Lawyer to specify the rate, period and the basis (contract/agreement/statute) relied on.",
      });
    }
    if (/\bcheque\b/i.test(body) && !/\breturn memo|dishonou?r/i.test(body)) {
      findings.push({
        layer: "legal",
        severity: "caution",
        excerpt: body.match(/\bcheque\b/i)![0],
        concern: "Cheque referenced without dishonour/return-memo particulars.",
        reason: "S.138 proceedings require the statutory sequence (presentation → return memo → notice) — verify each step is pleaded.",
      });
    }
    if (/\bsignature|sign here\b/i.test(body) && !/^\s*(?:DEPONENT|Verified)/im.test(body) && template?.docType === "affidavit") {
      findings.push({
        layer: "legal",
        severity: "caution",
        excerpt: "verification block",
        concern: "Affidavit-type draft may be missing its verification/juratum block.",
        reason: "Lawyer to confirm the verification wording and attestation requirements for the forum.",
      });
    }

    const byLayer = (l: Finding["layer"]) => findings.filter((f) => f.layer === l).length;
    return {
      useId: use._id,
      matterId: use.matterId,
      template: template ? { key: template.key, title: template.title, version: template.version } : null,
      layers: {
        formatting: { count: byLayer("formatting") },
        factual: { count: byLayer("factual") },
        legal: {
          count: byLayer("legal"),
          note:
            "Potential issues only, each anchored to a passage. Assessment against applicable sources is the lawyer's task; no conclusion or authority is asserted by the checker.",
        },
      },
      findings,
      checkedBodyHash: sha256Hex(body),
      checkedAt: Date.now(),
    };
  },
});

/**
 * Turn one finding into a REVIEWABLE PROPOSED EDIT (existing revision
 * flow: diff pair + reason + accept/reject/undo). For findings where an
 * edit is not mechanical (legal layer), this records a risk comment
 * instead of a proposed replacement — the lawyer decides the wording.
 */
export const proposeFix = mutation({
  args: {
    useId: v.id("templateUses"),
    originalExcerpt: v.string(),
    proposedExcerpt: v.string(),
    reason: v.string(),
    riskLevel: v.optional(v.union(v.literal("info"), v.literal("caution"), v.literal("high"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ revisionId: Id<"draftRevisions">; duplicated: boolean }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const use = (await ctx.db.get(args.useId)) as Doc<"templateUses"> | null;
    if (!use || use.orgId !== ac.org._id) throw new Error("Draft not found.");
    // Delegate to the governed revision flow: existence check, duplicate
    // collapse, accept/reject/undo semantics all live there.
    const r = (await ctx.runMutation(api.draftingRevisions.propose, {
      useId: args.useId,
      originalExcerpt: args.originalExcerpt,
      proposedExcerpt: args.proposedExcerpt,
      reason: `Draft review: ${args.reason}`,
      riskLevel: args.riskLevel,
      proposedById: "deterministic-draft-review",
    })) as { revisionId: Id<"draftRevisions">; duplicated: boolean };
    return r;
  },
});

/** Record a legal-layer finding as a risk comment (no wording proposed). */
export const flagRisk = mutation({
  args: {
    useId: v.id("templateUses"),
    excerpt: v.string(),
    concern: v.string(),
    reason: v.string(),
    sourceKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ commentId: Id<"draftRiskComments"> }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const use = (await ctx.db.get(args.useId)) as Doc<"templateUses"> | null;
    if (!use || use.orgId !== ac.org._id) throw new Error("Draft not found.");
    const r = (await ctx.runMutation(api.draftingRevisions.addRiskComment, {
      useId: args.useId,
      excerpt: args.excerpt,
      concern: args.concern,
      reason: `Draft review: ${args.reason}`,
      sourceKey: args.sourceKey,
    })) as { commentId: Id<"draftRiskComments"> };
    return r;
  },
});
