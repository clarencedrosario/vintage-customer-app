import fs from "fs";
const p = "src/convex/schema.ts";
let src = fs.readFileSync(p, "utf8");
// auditLog: add hash-chain fields.
const aFrom = `  auditLog: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"]),`;
const aTo = `  auditLog: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
    // Append-only tamper EVIDENCE: seq number within the org and
    // hash = sha256(prevHash | seq | actorId | action | detail | createdAt).
    // Verification walks the chain; a modified/deleted row breaks it.
    // This makes tampering detectable — it is not an absolute
    // immutability claim (the database itself remains the trust root).
    seq: v.optional(v.number()),
    prevHash: v.optional(v.string()),
    entryHash: v.optional(v.string()),
  })
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"])
    .index("by_org_seq", ["orgId", "seq"]),`;
let n = src.split(aFrom).length - 1;
if (n !== 1) { console.error("A", n); process.exit(1); }
src = src.replace(aFrom, aTo);

// documentAnalyses: processing status fields.
const dFrom = `    duplicatesOfDocumentId: v.optional(v.id("matterDocuments")),
    missingInformation: v.array(v.string()),
    model: v.optional(v.string()),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_matter", ["matterId"]),`;
const dTo = `    duplicatesOfDocumentId: v.optional(v.id("matterDocuments")),
    missingInformation: v.array(v.string()),
    model: v.optional(v.string()),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    // Background-processing lifecycle (visible status, retries, batch):
    // queued -> running | done | failed. attempts counts runs; lastError
    // is shown to the lawyer — no silent failures.
    processingStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed"),
      ),
    ),
    processingAttempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    scheduledFor: v.optional(v.string()), // optional batch label (e.g. nightly)
  })
    .index("by_document", ["documentId"])
    .index("by_matter", ["matterId"]),`;
n = src.split(dFrom).length - 1;
if (n !== 1) { console.error("B", n); process.exit(1); }
src = src.replace(dFrom, dTo);

// Append the new tables before the GitHub block.
const anchor = `  // ---------------- GitHub integration ----------------`;
const i = src.indexOf(anchor);
if (i === -1) { console.error("C"); process.exit(1); }
if (src.indexOf(anchor) !== src.lastIndexOf(anchor)) { console.error("C2"); process.exit(1); }
const block = fs.readFileSync(".tmp-splices/schema_t14.txt", "utf8");
src = src.slice(0, i) + block + src.slice(i);
fs.writeFileSync(p, src);
console.log("T14_SCHEMA_OK");
