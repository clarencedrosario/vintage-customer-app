import fs from "fs";
const p = "src/convex/matterIntelligence.ts";
let src = fs.readFileSync(p, "utf8");

const publicSigStart = src.indexOf("export const analyseSource = mutation({");
const internalAnchor = "export const analyseSourceInternal = internalMutation({";
if (internalAnchor !== -1 && src.includes(internalAnchor)) {
  console.log("ALREADY_DONE");
  process.exit(0);
}
if (publicSigStart === -1) { console.error("NO_PUBLIC"); process.exit(1); }

// Find the end of the public mutation: the first "\n});\n" after the
// insert/return block.
const returnMarker = '    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };';
const rIdx = src.indexOf(returnMarker);
if (rIdx === -1) { console.error("NO_RETURN"); process.exit(1); }
const mutEnd = src.indexOf("});", rIdx);
if (mutEnd === -1) { console.error("NO_END"); process.exit(1); }

// The public body spans publicSigStart..mutEnd+3. We replace everything
// from the "const text = src.text;" line (inside it) to mutEnd with a
// delegating body, then append the internal core containing the moved
// extraction code.
const bodyStart = src.indexOf("    const text = src.text;", publicSigStart);
if (bodyStart === -1) { console.error("NO_BODY"); process.exit(1); }

const movedCore = src.slice(bodyStart, rIdx); // extraction code incl. insert
const rest = src.slice(mutEnd + 3);

const delegating = `    // Delegate to the shared internal core so the direct path and the
    // queued/background path cannot drift apart.
    const r = await ctx.runMutation(internal.matterIntelligence.analyseSourceInternal, {
      aiSourceId: src._id,
      existingAnalysisId: undefined,
    });
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
  },
  handler: async (ctx, args) => {
    const src = await ctx.db.get(args.aiSourceId);
    if (!src) throw new Error("Source not found.");
    if (!src.documentId) {
      throw new Error("Source is not linked to a filed document.");
    }
    const documentId = src.documentId;
${movedCore.replace(
    `    const text = src.text;\n`,
    `    const text = src.text;\n`,
  ).replace(
    /    const prior = await ctx\.db[\s\S]*?analysisVersion =\n      prior\.filter\(\(p\) => p\.aiSourceId === src\._id\)\.length \+ 1;\n/,
    `    const prior = await ctx.db
      .query("documentAnalyses")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .collect();
    const analysisVersion =
      prior.filter((p) => p.aiSourceId === src._id).length + 1;
`,
  ).replace(
    `    await ctx.db.insert("documentAnalyses", {`,
    `    if (args.existingAnalysisId) {
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
    const analysisId = await ctx.db.insert("documentAnalyses", {`,
  ).replace(
    `      processingStatus: undefined,`,
    ``,
  ).replace(
    `      createdAt: Date.now(),
    });

    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };`,
    `      createdAt: Date.now(),
      processingStatus: "done",
      processingAttempts: 1,
    });
    return {
      analysisVersion,
      proposedFacts: proposedFacts.length,
      dates: dates.length,
      analysisId,
    };`,
  )}
  },
});
`;

src = src.slice(0, bodyStart) + delegating + rest;
fs.writeFileSync(p, src);
console.log("CORE_OK", src.length);
