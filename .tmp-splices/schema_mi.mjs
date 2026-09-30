import fs from "fs";
const p = "src/convex/schema.ts";
let src = fs.readFileSync(p, "utf8");
// Insert before the final closing of defineSchema — anchor: the github comment block seen at file end region.
const anchor = `  // ---------------- GitHub integration ----------------`;
const i = src.indexOf(anchor);
if (i === -1) { console.error("ANCHOR_MISSING"); process.exit(1); }
if (src.indexOf(anchor) !== src.lastIndexOf(anchor)) { console.error("ANCHOR_NOT_UNIQUE"); process.exit(1); }
const block = fs.readFileSync(".tmp-splices/mi_schema.txt", "utf8");
const out = src.slice(0, i) + block + src.slice(i);
fs.writeFileSync(p, out);
console.log("MI_SCHEMA_OK");
