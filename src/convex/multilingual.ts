import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAccess, requireCapability, requireMatter } from "./access";
import type { Doc, Id } from "./_generated/dataModel";
import { logUserAction } from "./auditLogger";
import {
  buildSideBySide,
  evaluateExternalPermission,
  humanVerificationDisclosure,
  isValidLanguageCode,
  languageLabel,
  machineTranslationDisclosure,
  manualTranslationDisclosure,
  MIN_POLICY_NOTE_CHARS,
  providerFacts,
  STALE_ORIGINAL_DISCLOSURE,
  validateTranslationTexts,
  type ExternalProcessorPolicy,
  type TranslationProviderKind,
} from "../lib/multilingual";

// =====================================================================
// §32 PHASE 9 — MULTILINGUAL EVIDENCE REVIEW (turn 21).
//
// A REVIEW workspace for evidence in more than one language. What it
// is NOT: a translation engine, and never a claim that a translation
// is the evidence.
//
// Hard rules encoded here:
//  - ORIGINAL PRESERVED: translations are new, append-only records
//    that freeze a copy of the original text at translation time. The
//    underlying aiSources.text / matterFacts.statement is NEVER
//    modified by translation. If the live original later changes, the
//    read flags the record STALE — the frozen pairing is shown as-is,
//    never silently re-pointed.
//  - MACHINE-LABELLED: records whose providerKind is a machine kind
//    carry a mandatory machine-translation disclosure on every read.
//    Human verification is an ATTESTATION recorded on the record — it
//    changes no text and never promotes a rendering to evidence.
//  - DATA-HANDLING RESTRICTIONS: recording a machine_external
//    translation implies the text was sent to an external service.
//    That is REFUSED unless the matter carries an explicit, noted
//    decision allowing external processors. Default (unset) refuses —
//    there is no silent external disclosure and no silent assumption
//    that disclosure is fine.
//  - Walls: every path goes through requireMatter, so Phase 7 ethical
//    walls apply here like everywhere else.
// =====================================================================

/** The recorded policy, or the honest default (unset) when none exists. */
async function policyForMatter(
  ctx: MutationCtx | QueryCtx,
  orgId: Id<"organizations">,
  matterId: Id<"matters">,
): Promise<{
  status: ExternalProcessorPolicy;
  authorityNote: string | null;
  setByName: string | null;
  setAt: number | null;
}> {
  const row: Doc<"dataHandlingPolicies"> | null = await ctx.db
    .query("dataHandlingPolicies")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .unique();
  if (!row || row.orgId !== orgId) {
    return { status: "unset", authorityNote: null, setByName: null, setAt: null };
  }
  return {
    status: row.externalProcessors,
    authorityNote: row.authorityNote,
    setByName: row.setByName,
    setAt: row.setAt,
  };
}

/** The live original text of a translation target (must belong to org+matter). */
async function loadTarget(
  ctx: MutationCtx | QueryCtx,
  orgId: Id<"organizations">,
  matterId: Id<"matters">,
  targetType: "ai_source" | "matter_fact",
  targetId: Id<"aiSources"> | Id<"matterFacts">,
): Promise<{ text: string; name: string } | null> {
  const row = await ctx.db.get(targetId);
  if (!row) return null;
  if (row.orgId !== orgId || row.matterId !== matterId) return null;
  if (targetType === "ai_source") {
    const source = row as Doc<"aiSources">;
    if (typeof source.text !== "string") return null;
    return { text: source.text, name: source.name };
  }
  const fact = row as Doc<"matterFacts">;
  if (typeof fact.statement !== "string") return null;
  return { text: fact.statement, name: `fact:${fact.factKey}` };
}

// ---------------------------------------------------------------------
// Data-handling decision (per matter)
// ---------------------------------------------------------------------

export const setHandlingPolicy = mutation({
  args: {
    matterId: v.id("matters"),
    externalProcessors: v.union(
      v.literal("unset"),
      v.literal("allowed"),
      v.literal("restricted"),
    ),
    // ≥10 chars — the authority this decision rests on (engagement
    // letter clause, client instruction, firm policy…).
    authorityNote: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await requireMatter(ctx, ac, args.matterId);
    const note = args.authorityNote.trim();
    if (note.length < MIN_POLICY_NOTE_CHARS) {
      throw new Error(
        `authorityNote must be at least ${MIN_POLICY_NOTE_CHARS} characters — record WHERE the authority for this data-handling decision comes from.`,
      );
    }
    const actorName =
      (await ctx.db.get(ac.user._id))?.name ?? ac.user.email ?? "member";
    const existing = await ctx.db
      .query("dataHandlingPolicies")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .unique();
    const now = Date.now();
    if (existing && existing.orgId === ac.org._id) {
      await ctx.db.patch(existing._id, {
        externalProcessors: args.externalProcessors,
        authorityNote: note,
        setById: ac.user._id,
        setByName: actorName,
        setAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("dataHandlingPolicies", {
        orgId: ac.org._id,
        matterId: args.matterId,
        externalProcessors: args.externalProcessors,
        authorityNote: note,
        setById: ac.user._id,
        setByName: actorName,
        setAt: now,
        updatedAt: now,
      });
    }
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "data_handling_policy.set",
      resourceId: matter._id,
    });
    return { externalProcessors: args.externalProcessors, matterRef: matter.reference };
  },
});

/** The matter's recorded decision — null row is returned as the explicit default. */
export const getHandlingPolicy = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    await requireMatter(ctx, ac, args.matterId);
    const p = await policyForMatter(ctx, ac.org._id, args.matterId);
    return p;
  },
});

// ---------------------------------------------------------------------
// Recording translations (append-only; original never modified)
// ---------------------------------------------------------------------

export const recordTranslation = mutation({
  args: {
    matterId: v.id("matters"),
    targetType: v.union(v.literal("ai_source"), v.literal("matter_fact")),
    targetId: v.union(v.id("aiSources"), v.id("matterFacts")),
    // The caller passes the original text it translated; it must match
    // the live target EXACTLY — otherwise the snapshot would lie.
    originalText: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    translatedText: v.string(),
    providerKind: v.union(
      v.literal("manual"),
      v.literal("machine_external"),
      v.literal("machine_self_hosted"),
    ),
    providerName: v.optional(v.string()),
    providerVersion: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const matter = await requireMatter(ctx, ac, args.matterId);

    const target = await loadTarget(
      ctx,
      ac.org._id,
      args.matterId,
      args.targetType,
      args.targetId,
    );
    if (!target) {
      throw new Error("Translation target not found in this matter.");
    }
    if (args.originalText !== target.text) {
      throw new Error(
        "originalText does not match the current source text — the frozen snapshot would not be honest. Re-copy the current original and retry.",
      );
    }
    if (!isValidLanguageCode(args.sourceLanguage)) {
      throw new Error(`sourceLanguage is not a valid language code: ${args.sourceLanguage}`);
    }
    if (!isValidLanguageCode(args.targetLanguage)) {
      throw new Error(`targetLanguage is not a valid language code: ${args.targetLanguage}`);
    }
    if (args.sourceLanguage === args.targetLanguage) {
      throw new Error("sourceLanguage and targetLanguage must differ — this records translations, not rewordings.");
    }
    const texts = validateTranslationTexts(args.originalText, args.translatedText);
    if (!texts.ok) throw new Error(texts.error);

    // Data-handling gate: external machine processing requires an
    // explicit recorded decision. Default (unset) refuses.
    const policy = await policyForMatter(ctx, ac.org._id, args.matterId);
    const decision = evaluateExternalPermission(args.providerKind, policy.status);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }

    const facts = providerFacts(args.providerKind);
    const actorName =
      (await ctx.db.get(ac.user._id))?.name ?? ac.user.email ?? "member";
    const now = Date.now();

    // Supersede prior ACTIVE renderings for the same target+language —
    // the chain is preserved; nothing is overwritten or deleted.
    const prior = await ctx.db
      .query("translationRecords")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .collect()
      .then((rows) =>
        rows.filter(
          (r) =>
            r.orgId === ac.org._id &&
            !r.supersededById &&
            r.targetLanguage === args.targetLanguage,
        ),
      );

    const recordId = await ctx.db.insert("translationRecords", {
      orgId: ac.org._id,
      matterId: args.matterId,
      targetType: args.targetType,
      targetId: args.targetId,
      originalText: args.originalText,
      originalChars: args.originalText.length,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      translatedText: args.translatedText,
      translatedChars: args.translatedText.length,
      providerKind: args.providerKind,
      providerName: args.providerName?.trim() || undefined,
      providerVersion: args.providerVersion?.trim() || undefined,
      machineTranslated: facts.machineTranslated,
      externalTransfer: facts.externalTransfer,
      note: args.note?.trim() || undefined,
      supersededById: undefined,
      createdById: ac.user._id,
      createdByName: actorName,
      createdAt: now,
    });
    for (const p of prior) {
      await ctx.db.patch(p._id, { supersededById: recordId });
    }

    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "translation.record",
      resourceId: recordId,
    });

    return {
      recordId,
      supersededCount: prior.length,
      languagePair: `${languageLabel(args.sourceLanguage)} → ${languageLabel(args.targetLanguage)}`,
      matterRef: matter.reference,
    };
  },
});

// ---------------------------------------------------------------------
// Reading: side-by-side + matter list
// ---------------------------------------------------------------------

/** Side-by-side view: live original, active rendering, pairing, labels. */
export const sideBySide = query({
  args: {
    matterId: v.id("matters"),
    targetType: v.union(v.literal("ai_source"), v.literal("matter_fact")),
    targetId: v.union(v.id("aiSources"), v.id("matterFacts")),
    // Optional: a specific language's rendering; otherwise the latest.
    targetLanguage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const target = await loadTarget(
      ctx,
      ac.org._id,
      args.matterId,
      args.targetType,
      args.targetId,
    );
    // Cross-org reads get NULL — hidden, not acknowledged.
    if (!target) return null;
    const matter = await requireMatter(ctx, ac, args.matterId);

    const active = await ctx.db
      .query("translationRecords")
      .withIndex("by_target", (q) => q.eq("targetId", args.targetId))
      .collect()
      .then((rows) =>
        rows
          .filter(
            (r) =>
              r.orgId === ac.org._id &&
              !r.supersededById &&
              (args.targetLanguage ? r.targetLanguage === args.targetLanguage : true),
          )
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    const record = active[0] ?? null;

    if (!record) {
      return {
        matterRef: matter.reference,
        targetName: target.name,
        sourceLanguage: null,
        translation: null,
        disclosure: null,
        verifiedDisclosure: null,
        staleOriginal: false,
        pairs: null,
        activeLanguages: active.map((r) => r.targetLanguage),
      };
    }

    const staleOriginal = record.originalText !== target.text;
    const pairing = buildSideBySide(record.originalText, record.translatedText);
    const disclosure = record.machineTranslated
      ? machineTranslationDisclosure(record.providerName, record.providerVersion)
      : manualTranslationDisclosure(record.providerName);
    const verifiedDisclosure = record.verifiedById
      ? humanVerificationDisclosure(record.verifiedByName ?? "a lawyer", record.verifiedAt ?? record.createdAt)
      : null;

    return {
      matterRef: matter.reference,
      targetName: target.name,
      sourceLanguage: record.sourceLanguage,
      translation: {
        recordId: record._id,
        targetLanguage: record.targetLanguage,
        originalText: record.originalText,
        translatedText: record.translatedText,
        providerKind: record.providerKind,
        providerName: record.providerName ?? null,
        providerVersion: record.providerVersion ?? null,
        machineTranslated: record.machineTranslated,
        externalTransfer: record.externalTransfer,
        recordedByName: record.createdByName,
        recordedAt: record.createdAt,
      },
      disclosure,
      verifiedDisclosure,
      staleOriginal,
      staleDisclosure: staleOriginal ? STALE_ORIGINAL_DISCLOSURE : null,
      pairs: pairing,
      activeLanguages: active.map((r) => r.targetLanguage),
    };
  },
});

/** All active translations on a matter (walled members get nothing). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const matter = await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("translationRecords")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect()
      .then((rs) =>
        rs
          .filter((r) => r.orgId === ac.org._id && !r.supersededById)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    return {
      matterRef: matter.reference,
      // Standing disclosure — the workspace never shows translations
      // without this context.
      disclosure:
        "Translations are review aids, never the evidence. Machine renderings are labelled with their provider; only the original text is authoritative.",
      records: rows.map((r) => ({
        recordId: r._id,
        targetType: r.targetType,
        targetId: r.targetId,
        languagePair: `${languageLabel(r.sourceLanguage)} → ${languageLabel(r.targetLanguage)}`,
        machineTranslated: r.machineTranslated,
        externalTransfer: r.externalTransfer,
        providerKind: r.providerKind,
        providerName: r.providerName ?? null,
        verified: !!r.verifiedById,
        recordedByName: r.createdByName,
        recordedAt: r.createdAt,
      })),
    };
  },
});

// ---------------------------------------------------------------------
// Human verification (an attestation — changes no text)
// ---------------------------------------------------------------------

export const verifyTranslation = mutation({
  args: {
    recordId: v.id("translationRecords"),
    // ≥10 chars — what the comparison covered (full/partial, method).
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "note.write");
    const record = await ctx.db.get(args.recordId);
    if (!record || record.orgId !== ac.org._id) {
      throw new Error("Translation record not found in this organization.");
    }
    await requireMatter(ctx, ac, record.matterId);
    const note = args.note.trim();
    if (note.length < MIN_POLICY_NOTE_CHARS) {
      throw new Error(
        `note must be at least ${MIN_POLICY_NOTE_CHARS} characters — say what the comparison covered.`,
      );
    }
    const actorName =
      (await ctx.db.get(ac.user._id))?.name ?? ac.user.email ?? "member";
    await ctx.db.patch(args.recordId, {
      verifiedById: ac.user._id,
      verifiedByName: actorName,
      verifiedAt: Date.now(),
      verifiedNote: note,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "translation.verify",
      resourceId: args.recordId,
    });
    return { verified: true, recordId: args.recordId };
  },
});
