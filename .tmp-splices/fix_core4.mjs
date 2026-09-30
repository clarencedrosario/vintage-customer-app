import fs from "fs";
const p = "src/convex/matterIntelligence.ts";
let src = fs.readFileSync(p, "utf8");

// The internal core lost the matter fetch + ac context. Insert both
// right after the documentId derivation in the internal handler.
const anchor = `    const documentId = src.documentId as Id<"matterDocuments">;
    const text = src.text;`;
const insertion = `    const documentId = src.documentId as Id<"matterDocuments">;
    const matter = await ctx.db.get(src.matterId);
    if (!matter) throw new Error("Matter not found.");
    const ac = { org: { _id: src.orgId }, user: { _id: args.requestedById ?? src.addedById } };
    const text = src.text;`;
const n = src.split(anchor).length - 1;
if (n !== 1) { console.error("A", n); process.exit(1); }
src = src.replace(anchor, insertion);

// Add requestedById arg to the internal.
const aFrom = `  args: {
    aiSourceId: v.id("aiSources"),
    existingAnalysisId: v.optional(v.id("documentAnalyses")),
  },`;
const aTo = `  args: {
    aiSourceId: v.id("aiSources"),
    existingAnalysisId: v.optional(v.id("documentAnalyses")),
    requestedById: v.optional(v.id("users")),
  },`;
const n2 = src.split(aFrom).length - 1;
if (n2 !== 1) { console.error("B", n2); process.exit(1); }
src = src.replace(aFrom, aTo);

// Pass requestedById from the public mutation.
const pFrom = `    const r = await ctx.runMutation(internal.matterIntelligence.analyseSourceInternal, {
      aiSourceId: src._id,
      existingAnalysisId: undefined,
    });`;
const pTo = `    const r = await ctx.runMutation(internal.matterIntelligence.analyseSourceInternal, {
      aiSourceId: src._id,
      existingAnalysisId: undefined,
      requestedById: ac.user._id,
    });`;
const n3 = src.split(pFrom).length - 1;
if (n3 !== 1) { console.error("C", n3); process.exit(1); }
src = src.replace(pFrom, pTo);

fs.writeFileSync(p, src);
console.log("CTX_OK");
