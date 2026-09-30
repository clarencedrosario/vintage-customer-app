import fs from "fs";
const p = "src/convex/matterIntelligence.ts";
let src = fs.readFileSync(p, "utf8");
// Remove the duplicate documentId line (left from the original body).
const dupLine = `    const documentId = src.documentId;\n    const text = src.text;\n    const documentId = src.documentId as Id<"matterDocuments">;`;
const fixedLine = `    const documentId = src.documentId as Id<"matterDocuments">;\n    const text = src.text;`;
let n = src.split(dupLine).length - 1;
if (n === 1) {
  src = src.replace(dupLine, fixedLine);
} else {
  console.error("DUP_NOT_FOUND", n);
  process.exit(1);
}
fs.writeFileSync(p, src);
console.log("DUP_FIXED");
