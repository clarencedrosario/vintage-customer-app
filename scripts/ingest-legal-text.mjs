// Ingest extracted statute text into Convex via chunked staging.
// Usage: bun scripts/ingest-legal-text.mjs
// Requires: /tmp/legal_json/*.json produced by scripts/extract-legal-pdfs.mjs
// All Convex calls go through internal functions (convex run CLI).
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";

const OUT = "/tmp/legal_json";
const CHUNK = 60_000; // chars per staged chunk (safe under CLI arg limits)

// extraction key -> registered stableKey (seed registry keys)
const MAP = {
  "in:statute:ipc-1860": "in:statute:ipc-1860",
  "in:statute:crpc-1973": "in:statute:crpc-1973",
  "in:statute:evidence-1872": "in:statute:evidence-1872",
  "in:code:bns-2023": "in:statute:bns-2023",
  "in:code:bnss-2023": "in:statute:bnss-2023",
  "in:code:bsa-2023": "in:statute:bsa-2023",
  "in:constitution:constitution-of-india": "in:constitution",
};

// Provenance: the retrieval URL is recorded on the source row alongside
// the PDF hash (in provenanceNote), so every version is traceable.
const PUBLISHER_NOTE = {
  "in:statute:ipc-1860": {
    url: "https://www.mha.gov.in/sites/default/files/2022-09/IPC1860%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India",
  },
  "in:statute:crpc-1973": {
    url: "https://www.mha.gov.in/sites/default/files/2022-09/ccp1973%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India",
  },
  "in:statute:evidence-1872": {
    url: "https://www.indiacode.nic.in/bitstream/123456789/15351/1/iea_1872.pdf (India Code text; retrieved via verified reproduction at lawvisionattorneys.com after India Code returned HTTP 504)",
    publisher: "India Code (Legislative Dept.) — third-party verified reproduction",
  },
  "in:code:bns-2023": {
    url: "https://www.mha.gov.in/sites/default/files/250883_english_01042024.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA",
  },
  "in:code:bnss-2023": {
    url: "https://www.mha.gov.in/sites/default/files/2024-04/250884_2_english_01042024.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA",
  },
  "in:code:bsa-2023": {
    url: "https://www.mha.gov.in/sites/default/files/2024-04/250882_english_01042024_0.pdf",
    publisher: "The Gazette of India (Extraordinary), via MHA",
  },
  "in:constitution:constitution-of-india": {
    url: "https://cdnbbsr.s3waas.gov.in/s380537a945c7aaa788ccfcdf1b99b5d8f/uploads/2023/05/2023050195.pdf",
    publisher: "Government of India (official Constitution as amended up to date of edition)",
  },
};

function run(fn, args) {
  const out = execFileSync("bunx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out;
}

const manifest = JSON.parse(readFileSync(`${OUT}/_manifest.json`, "utf8"));
const results = { succeeded: [], failed: [] };

for (const rec of manifest) {
  const stableKey = MAP[rec.key];
  if (!stableKey) {
    results.failed.push({ key: rec.key, reason: "no registered stableKey mapping" });
    continue;
  }
  const file = `${OUT}/${rec.key.replace(/:/g, "_")}.json`;
  if (!existsSync(file)) {
    results.failed.push({ key: rec.key, reason: "extracted JSON missing" });
    continue;
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const runKey = `cli-${stableKey.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}`;
  try {
    // 1) stage body chunks, then sections as JSON chunks (argv-sized)
    for (let i = 0, seq = 0; i < data.body.length; i += CHUNK, seq++) {
      run("legalIntel:stageChunk", {
        runKey,
        seq,
        bodyChunk: data.body.slice(i, i + CHUNK),
      });
    }
    const sectionsJson = JSON.stringify(data.sections);
    for (let i = 0, seq = 0; i < sectionsJson.length; i += CHUNK, seq++) {
      run("legalIntel:stageChunk", {
        runKey: `${runKey}#sections`,
        seq,
        bodyChunk: sectionsJson.slice(i, i + CHUNK),
      });
    }
    // 2) concatenate + write immutable version, update freshness + provenance
    const res = run("legalIntel:ingestSourceTextCli", {
      stableKey,
      runKey,
      collectedAt: rec.collectedAt,
      sourceUrl: PUBLISHER_NOTE[rec.key]?.url ?? rec.sourceUrl,
      publisher: PUBLISHER_NOTE[rec.key]?.publisher ?? rec.publisher,
    });
    const readback = run("legalIntel:getSourceCli", { stableKey });
    results.succeeded.push({
      stableKey,
      version: JSON.parse(res.match(/\{.*\}/s)?.[0] ?? "{}"),
      readback: JSON.parse(readback.match(/\{.*\}/s)?.[0] ?? "{}"),
      anomalies: rec.anomalies,
    });
    console.log(`OK ${stableKey} -> v${JSON.parse(res.match(/\{.*\}/s)?.[0] ?? "{}").version ?? "?"} sections=${data.sections.length}`);
  } catch (e) {
    results.failed.push({ key: rec.key, stableKey, reason: String(e.message).slice(0, 400) });
    try {
      run("legalIntel:clearChunks", { runKey });
    } catch { /* best effort */ }
    console.error(`FAIL ${stableKey}: ${String(e.message).slice(0, 200)}`);
  }
}

// POCSO 2012 (in:statute:pocso-2012) is deliberately NOT attempted here:
// its official text was not obtainable (India Code HTTP 504 etc.). Its
// failure is recorded as a real ingestion run row via recordResultCli —
// see ADVOKATE_PROGRESS.md turn-6 for the executed demonstration.

console.log(JSON.stringify({ succeededCount: results.succeeded.length, failed: results.failed }, null, 2));
console.log("INGEST_DONE");
