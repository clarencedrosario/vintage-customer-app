# Legal Intelligence corpus — migration manifest (§26, demand 2)

Status: **Infrastructure + procedure documented 2026-09-28.** This manifest
explains how to move the legal corpus, its immutable versions, the originals'
references, the indexes, and the configuration between deployments.

> **Read this first — what an archive is NOT:**
> A source archive (tarball of this repository) contains **code, scripts,
> schema and docs only**. It does **NOT** contain:
> - the database records (Convex tables live server-side in the deployment),
> - the ingested statute text bodies (stored as `legalSourceVersions` rows),
> - the source PDFs (they were downloaded from government hosts and are NOT
>   committed; only their URLs + SHA-256 hashes are recorded),
> - any API keys or credentials (see `docs/LEGAL_INTEL_MODEL_SETUP.md`).
>
> Describing the archive as including the corpus or stored PDFs is a false
> claim. Follow the export/import procedure below.

## 1. What lives where

| Asset | Location | How it moves |
| --- | --- | --- |
| Registry metadata (8 India sources + 2 judgments, 51-country register) | Convex tables `legalSources`, `legalCountryCoverage` | Re-created by idempotent seeds (`legalIntel:seedIndianCoreCli`, `seedEuropeanCoverage`) or full data export (§3) |
| Statute text + section anchors | Convex `legalSourceVersions` (immutable rows: `body`, `sections[{anchor,heading,start}]`, `collectedAt`, `version`) | Re-run extraction + ingestion pipeline (§4) or data export/import (§3) |
| Original PDFs | Government hosts (URLs in `docs/evidence/legal-corpus-manifest.json`); SHA-256 recorded per file | Re-download from the recorded URLs and **verify the hash** — do not trust unverified copies |
| IPC↔BNS cross-refs with review status | Convex `legalCrossRefs` | Seed re-creation or data export |
| Ingestion run history + sweep execution records | Convex `ingestionRuns`, `legalSweepLogs` | Data export only (operational history, not reproducible) |
| Citation-check results per AI job | Convex `legalCitationChecks` | Data export only |
| Scheduler registration | `src/convex/crons.ts` (daily 00:00 IST → `internal.legalIntel.scheduledSweep`) | Automatic — ships with the schema push |
| Indexes | Declared in `src/convex/schemaExtras.ts` (`by_stable_key`, `by_source`, `by_from`, `by_to`, `by_country`, `by_needs_review`, `by_time`, …) | Automatic — Convex builds them on schema push; never hand-build |

## 2. Recorded originals (what to re-download and how to verify)

`docs/evidence/legal-corpus-manifest.json` records, per statute: source URL,
publisher, PDF file name, **SHA-256**, page count, extracted character count,
anchor count, first/last anchor, and extraction anomalies (e.g. the CrPC
out-of-order column-flow entries). Verification on import:

```bash
curl -L -A "Mozilla/5.0" -o /tmp/<file>.pdf "<recorded URL>"
sha256sum /tmp/<file>.pdf   # must equal the manifest value
bun scripts/extract-legal-pdfs.mjs   # rebuilds /tmp/legal_json
bun scripts/ingest-legal-text.mjs    # writes NEW immutable versions
```

If a hash differs, the upstream document changed — re-run extraction and
re-ingest as a **new version** (never overwrite), and flag the change for
lawyer review. POCSO 2012 has no downloadable original (see
`docs/evidence/pocso-attempt-log.txt`); it stays registered-but-uningested
with validator-blocked citations until an official text is obtained.

## 3. Data export/import (Convex snapshot route)

The corpus lives in Convex, so migrating **data** means a Convex export:

```bash
bunx convex export --path /tmp/advokate-snapshot.zip   # all tables, zip
```

The snapshot contains JSON documents per table **including the full statute
bodies**. Restore into a fresh deployment with `bunx convex import`, or
selectively re-ingest from the extracted JSON:

- `legalSources` — registry rows; restore first (IDs are referenced by versions).
- `legalSourceVersions` — the immutable text; keep `sourceId`/`version` pairs.
- `legalCrossRefs`, `legalCountryCoverage`, `legalEvalCases` — reference data.
- `ingestionRuns`, `legalSweepLogs`, `legalCitationChecks` — history; optional
  on a fresh deployment (fresh histories start empty honestly, not pre-filled).
- `ingestChunks` — transient staging; never migrate (clear with
  `legalIntel:clearChunks`).

Skip snapshot-merging entirely by using the pipeline route (§4): the seeds
recreate the registry + cross-refs + coverage register deterministically, and
the extraction scripts rebuild every version from the originals. This is the
preferred route because it re-verifies hashes and anchors at import time.

## 4. Preferred route: rebuild via pipeline (fresh deployment)

1. `bun install` then `bunx convex dev --once` (pushes schema; indexes build).
2. `bunx convex run legalIntel:seedIndianCoreCli` — 8 sources + 6 cross-refs
   (idempotent; logs provenance).
3. `bunx convex run legalIntel:seedEuropeanCoverage` and
   `bunx convex run legalIntel:seedEvalCases` (public, operator-gated; the
   console equivalents live in the owner console) — coverage register + eval
   harness.
4. Re-download PDFs, verify hashes (§2), run extractor + ingestion scripts.
5. Verify: era/retrieval checks via the internal dry-run
   (`bunx convex run legalIntel:researchDryRun` with the admin CLI) plus a
   spot quote-fidelity probe (constitution § 21, IPC § 498A, CrPC § 329).
6. Confirm the cron row exists (`legal-source-ingestion-sweep`, daily
   00:00 IST) in the dashboard → Settings → Cron Jobs.

## 5. Configuration that must be re-created

- `OPENAI_API_KEY` — via secure env only (dashboard Settings → Environment
  Variables or `bunx convex env set`). **Never** in git, chat, or archives.
  Nothing works without it except the no-LLM dry-run path.
- Operator access — the seeds/ingest mutations are operator-gated; re-provision
  the platform admin / operator accounts before running the browser paths.
- `VITE_PUBLIC_APP_URL` — build-time; set before rebuilding the frontend.

## 6. What must NOT be claimed

- "The archive includes the corpus/PDFs" — false; see the box at the top.
- "Indexes migrated" — they are rebuilt by schema push, not copied.
- "Run history preserved" — only a snapshot export carries it; the rebuild
  route starts with empty ingestion history by design.
