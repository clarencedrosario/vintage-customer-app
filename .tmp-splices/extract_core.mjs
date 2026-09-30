import fs from "fs";
const p = "src/convex/matterIntelligence.ts";
let src = fs.readFileSync(p, "utf8");

// 1. Convert analyseSource's heavy lifting into a reusable internal.
//    Strategy: extract the body from `const text = src.text;` through
//    the insert block end, reusing it in a new internal function.
const insertStart = src.indexOf(`    await ctx.db.insert("documentAnalyses", {`);
const insertEnd = src.indexOf(`    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };`);
if (insertStart === -1 || insertEnd === -1) { console.error("A", insertStart, insertEnd); process.exit(1); }
const insertBlock = src.slice(insertStart, insertEnd);

// Replace the public mutation's insert+return with a call to the new
// internal, and append the internal (which fills an existing row when
// given one).
const newTail = `    // Delegate to the shared internal core (analysis row created or
    // filled there — one implementation, no drift).
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
 * Shared analysis core: performs the deterministic extraction and
 * creates (or fills) the analysis row. Public mutations call this so
 * the queue path and the direct path cannot drift apart.
 */
export const analyseSourceInternal = internalMutation({
  args: {
    aiSourceId: v.id("aiSources"),
    existingAnalysisId: v.optional(v.id("documentAnalyses")),
  },
  handler: async (ctx, args) => {
    const src = await ctx.db.get(args.aiSourceId);
    if (!src) throw new Error("Source not found.");

`;
let cutStart = src.indexOf(`    const text = src.text;`);
let cutEnd = insertEnd; // end of insert block, before return
if (cutStart === -1) { console.error("B"); process.exit(1); }
const coreBody = src.slice(cutStart, cutEnd);

// Rewrite the documentAnalyses insert inside the core to create-or-fill.
let core = coreBody.replace(
  `    await ctx.db.insert("documentAnalyses", {`,
  `    if (args.existingAnalysisId) {
      const existingRow = await ctx.db.get(args.existingAnalysisId);
      if (!existingRow) throw new Error("Queued analysis row missing.");
      await ctx.db.patch(args.existingAnalysisId, {`);
core = core.replace(
  `      analysisVersion,
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
    });

    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };
  },
});`,
  `        analysisVersion,
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
        createdAt: existingRow.createdAt,
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
      documentId,
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
});`;

const head = src.slice(0, cutStart);
const tailStart = src.indexOf(`    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };`);
const tail = src.slice(tailStart + `    return { analysisVersion, proposed: proposedFacts.length, dates: dates.length };\n  },\n});\n`.length);

// The public mutation's original body from cutStart to the closing of
// the mutation is replaced by the new tail; the internal is appended
// after the public mutation.
const publicNew = `    const text = src.text;\n    void text; // (extraction moved to analyseSourceInternal)\n` + newTail;

src = head + publicNew + core + tail;
fs.writeFileSync(p, src);
console.log("CORE_OK", src.length);
