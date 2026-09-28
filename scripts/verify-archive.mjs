// Verify the source archive excludes dependencies, VCS, secrets,
// credentials, build artifacts and data snapshots (demand 1).
// Usage: bun scripts/verify-archive.mjs [archive.tar.gz]
import { execSync } from "child_process";

const archive = process.argv[2] ?? "advokate-source-archive-20260928.tar.gz";
const files = execSync(`tar -tzf ${archive}`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const banned = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env(\..*)?$/, // dotenv-style files, any depth
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)(secrets?|credentials?)(\/|$|\.[^.]+$)/i,
  /(^|\/)dist(\/|$)/,
  /(^|\/)\.vite(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /snapshot/i,
  /\.(sqlite|db)$/,
  /customer/i,
];

const leaks = files.filter((f) => banned.some((re) => re.test(f)));
const top = new Set(files.map((f) => f.split("/").slice(0, 2).join("/")));

console.log(`archive: ${archive}`);
console.log(`entries: ${files.length}`);
console.log(`top-level entries:`);
for (const t of [...top].sort()) console.log(`  ${t}`);
if (leaks.length) {
  console.error(`LEAKS FOUND (${leaks.length}):`);
  for (const l of leaks.slice(0, 20)) console.error(`  ${l}`);
  process.exit(1);
}
console.log("OK: no node_modules / .git / .env-style / key / snapshot / dist entries");
