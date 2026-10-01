# OFFICIAL_SOURCES.md — Official-source connector: per-source report and evidence record

Turn 17 (1 October 2026). Deployment: Convex **moonlit-elk-307**.

User-set rules for this work, restated because they govern every claim below:

1. Each source connector is inspected and reported **separately** (§1).
2. Five different things are never conflated: **(a)** a registry entry,
   **(b)** a manual import, **(c)** a working connector, **(d)** a
   scheduler configured in code, **(e)** a scheduler **observed
   executing** (§3).
3. Evidence is separated by kind: implementation, simulated tests, real
   retrieval, scheduled execution, browser verification, legal review (§4).
4. The first connector implements the permitted end-to-end path:
   discover → retrieve → validate → provenance/version → index →
   search (§5).
5. Real retrieval + repeat-import dedupe is demonstrated with recorded
   hashes/version ids (§6).
6. Failed checks never advance a freshness timestamp (§7).
7. `OPENAI_API_KEY` is absent — none of this depends on it (§8).
8. No access control, login, CAPTCHA or verification step is ever
   bypassed (governs every §1 row).

---

## 1. Per-source connector report (each source inspected separately)

### 1.1 India Code (indiacode.nic.in / indiacode.gov.in) — India Code Digital Repository

| Data point | Status for this source |
| --- | --- |
| Access method + restrictions | Public repository; plain HTTPS GET at the root. **Deep document URLs (bitstream/handle) time out** — probed live 2026-10-01 and consistent with the HTTP 504 history recorded on the POCSO row since 28 Sep 2026. No login/CAPTCHA bypass attempted; none needed at root, none possible where the service simply does not respond. |
| Discovery | Registered in the corpus since turn 6/7 (7 Indian statute rows, `sourceUrl` = indiacode.nic.in). Canonical citation anchor for POCSO (`in:statute:pocso-2012`) remains India Code even though retrieval uses another channel. |
| Historical import | Turn 6 (28 Sep 2026): 7 sources manually ingested (see §2b) — 6 via other official channels after India Code deep URLs failed; POCSO failed everywhere attempted and stayed `NOT OBTAINED`. |
| Scheduled connector config | **None.** No connector notice exists for India Code — a scheduler cannot fetch what no connector can reach. |
| Last real retrieval | None via connector. The repository root answered HTTP 200 on 2026-10-01; every deep URL timed out. |
| Last scheduled execution | Never (no connector registered). |
| Search / indexing status | The 6 imported statutes (their text came from MHA/official mirrors, not India Code itself) are indexed and searchable; POCSO was not indexed from India Code. |
| Exact blocker | Deep-URL timeout (service-side). **Not worked around** — no proxy trickery, no verification-disabling, no alternate unofficial scraping of India Code. |

### 1.2 Gazette of India (egazette.gov.in) — eGazette

| Data point | Status for this source |
| --- | --- |
| Access method + restrictions | Plain HTTPS GET only. **Live probe 2026-10-01: the TLS certificate chain fails verification.** Proceeding would require disabling certificate verification in the fetch client — refused outright. |
| Discovery | Gazette/Extraordinary PDFs were used historically as channel material (e.g. DPDP Rules notification `G.S.R. 846(E)` facts recorded in `docs/DPDP_REVIEW.md` §0), but egazette.gov.in itself has **no connector**. |
| Historical import | None directly from egazette.gov.in. |
| Scheduled connector config | **None.** |
| Last real retrieval | None (TLS failure; nothing downloaded). |
| Last scheduled execution | Never. |
| Search / indexing status | Nothing indexed from this host. |
| Exact blocker | Broken TLS chain. The honest fix is on the publisher's side (or an explicitly authorized alternate channel); the connector will not fetch over a chain it cannot verify. |

### 1.3 Supreme Court of India (sci.gov.in / api.sci.gov.in)

| Data point | Status for this source |
| --- | --- |
| Access method + restrictions | Site answers HTTP 200 with a permissive robots.txt (probed 2026-10-01). **Case/orders APIs are registration-gated and no credentials exist in this project → not authorized.** Judgments in the corpus are bounded official copies imported manually (turn 6), not a live API. |
| Discovery | Court-source registry (`courtSources.ts`, turn 15) records SCI with authorized methods and honest limitations: manual/reviewed paths only. |
| Historical import | Bounded SCI judgments imported manually 28 Sep 2026 (§2b). |
| Scheduled connector config | **None.** No automated fetch of sci.gov.in exists. |
| Last real retrieval | None via connector (APIs require credentials we do not have). |
| Last scheduled execution | Never. |
| Search / indexing status | The manually imported judgment texts are indexed and searchable; the registry-based court-updates path (listing import, CNR matching) is manual/reviewed by design. |
| Exact blocker | **Authorization**, not technology: registration-gated APIs with no credentials. The court-source registry stays honest (manual/reviewed only) until real credentials exist. Nothing is scraped around the gate. |

### 1.4 POCSO 2012 — `in:statute:pocso-2012` (first WORKING connector)

| Data point | Status for this source |
| --- | --- |
| Access method + restrictions | **Chosen channel: `https://delhipolice.gov.in/doc/acts/sexual_offences_act.pdf`** — an official government publication (Delhi Police, Government of NCT of Delhi) of the enacted English bare act, retrieved by plain HTTPS GET. No login, no CAPTCHA, robots honoured, permissive access basis recorded in `src/convex/sourceNotices.ts`. India Code remains the canonical citation anchor; Delhi Police is the publisher of record for retrieved copies. |
| Discovery | The corpus row has existed since turn 7 with text NOT OBTAINED and the citation validator BLOCKED. Turn-17 probes evaluated four candidate channels (below) before choosing this one. |
| Historical import | **None ever succeeded** — 28 Sep 2026 attempt log recorded on the row (indiacode 504, indiacode.gov.in JS shell, api.sci.gov.in 0 bytes, wcd.gov.in HTML shell, missionvatsalya 403, ncpcr file-not-found, legislative.gov.in 404, web.archive 403/429, advocatekhoj login-walled, indiankanoon Cloudflare 403). |
| Scheduled connector config | **Yes — in code**: `crons.ts` job `official-source-connector-sweep`, daily 17:45 UTC (23:15 IST), `internal.sourceConnector.scheduledConnectorSweep`; sequential, per-source failure isolation, sweep log row per execution. |
| Last real retrieval | **2026-10-01, real fetch**: version 2, versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`, bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`; 46,197 body characters; **44/46 sections anchored**; collectionDate 2026-10-01. Repeat fetch: `status:"unchanged"` (dedupe, §6). |
| Last scheduled execution | Cron **configured** (17:45 UTC daily). Manually invoked sweep executed 2026-10-01 (attempted 1 / unchanged 1 / failed 0) with a `legalSweepLogs` row (trigger=schedule). A cron-FIRED connector-sweep execution will exist after the next 17:45 UTC tick — see §3e for the honest distinction. |
| Search / indexing status | Indexed: surfaces in `searchSources` ("Sexual Offences") and is citable — the turn-8 citation-validator BLOCK on this source is now lifted by real text (v2 latest). |
| Exact blocker | None remaining for the English text via this channel. Caveats recorded honestly: the reproduction carries 44 of 46 detected sections (bounds `minSections:20`, `maxNo:46`); completeness/currency of consolidation is NOT certified; the scan-class NCPCR PDF (5.4 MB, no text layer) shows why per-channel sanity gates matter. |

### Candidate-channel decision log for POCSO (2026-10-01, probed live)

| Candidate | What it actually was | Outcome |
| --- | --- | --- |
| MHA `CS-070613` PDF (mha.gov.in, HTTP 200, application/pdf) | **4-page explainer BROCHURE**, not the enacted text | Connector sanity gates REFUSED it — correct behaviour, later fixture-tested |
| NCPCR full PDF | Official **HINDI** edition (46 sections, Hindi text) | Rejected for this stableKey's English corpus need; noted as a legitimate future Hindi-edition channel |
| NCPCR 5.4 MB PDF | **8-page scan, no text layer** | Rejected — nothing extractable |
| **delhipolice.gov.in bare act** | English bare act: 12 pages, 514 lines, **44/46 sections** | **CHOSEN** — official government reproduction, permitted plain download |

---

## 2. The five-way distinction, applied (never conflated)

**(a) Registry entry.** A row in `legalSources` describing a source. Since turn 6 there are 8 registry rows (7 Indian statutes + bounded SCI judgments). A registry entry alone retrieves nothing.

**(b) Manual import.** Text ingested by authenticated operator action (browser path or `scripts/ingest-legal-text.mjs` CLI). Turn 6 (28 Sep 2026) manually imported 7 sources this way (IPC, CrPC, Evidence Act, BNS/BNSS/BSA via mha.gov.in PDFs, Evidence via verified reproduction, s3waas-hosted document), plus bounded SCI judgments. These are real texts with hash provenance — but no connector re-fetches them automatically.

**(c) Working connector.** Code that, given a notice, performs the full path autonomously: fetch → validate → dedupe/version → index. Since turn 17 exactly **one** exists: the POCSO channel (Delhi Police bare act) via `sourceConnector.ts`. Everything else remains (a) or (b).

**(d) Scheduler in code.** `crons.ts` declares two relevant jobs: `legal-source-ingestion-sweep` (18:30 UTC, since turn 7 — opens run rows; no automated fetcher completes them) and `official-source-connector-sweep` (17:45 UTC, turn 17 — actually fetches connector notices). Declaring a cron is configuration, **not** evidence of execution.

**(e) Scheduler observed executing.** The `legalSweepLogs` table holds cron-executed rows for the OLD sweep (28–30 Sep 2026, 18:30 UTC ticks). For the **connector** sweep, a manual invocation produced a trigger=schedule sweep-log row on 2026-10-01 (attempted 1 / unchanged 1 / failed 0); the first cron-fired connector-sweep row will exist only after a real 17:45 UTC tick. Until then the connector sweep is honestly described as: working connector + scheduler in code + manual sweep execution observed; **cron-fired connector execution pending next tick**.

---

## 3. Connector design (what the code guarantees)

Files: `src/convex/sourceConnector.ts` (actions), `src/convex/sourceNotices.ts` (pure notice registry with access basis), `src/lib/pdfExtract.ts` (pure extraction shared with diagnostics/tests), `src/convex/legalIntel.ts` (run state machine + commit + freshness), `src/convex/matterImpact.ts` (alert wiring).

- **Operator gate**: `fetchOfficialSource` runs an access/capability check (`connectorOperatorCheck`) — the connector is never callable by an anonymous caller.
- **Validation gates before storing**: PDF magic bytes, size ceiling, minimum body length, minimum section count, section 1 present, section numbers within the act's bounds. A failed gate raises a FAILED ingestion run and stores nothing (the MHA brochure was refused exactly here).
- **Provenance/version**: every stored version carries publisher, retrieval URL, collection date, `bytesHash` (SHA-256 of retrieved bytes) and text fingerprint; versions are immutable — a changed document creates a NEW version, never an overwrite.
- **Dedupe**: identical bytes/text → `status:"unchanged"`, no new version, no alerts.
- **Alert wiring**: an `updated` commit calls `evaluateSourceUpdate` — strictly opt-in matters (impactAlerts + anchored keys) get one alert per version, carrying from→to version and the coverage disclosure. The alert's `fromVersion` is the truthful previous **source** version row (a matter that opts in between versions still sees v1→v2, not "unknown").
- **Failure honesty**: `recordConnectorFailure` + `recordSweepFailure` write the failure; `legalSources.lastCheckedAt/lastCheckOutcome/lastCheckError` record it; **freshness (`stale`) is keyed on success only** — a failed check can never make a source look fresh.
- **Politeness**: sequential per-source fetch, custom UA identifying the retriever, per-source failure isolation in sweeps.

---

## 4. Evidence, separated by kind

| Category | Evidence for the official-source work |
| --- | --- |
| **Implementation** | Code listed in §3, pushed to moonlit-elk-307 (push clean, tsc 0 errors). Schema additions: `legalSources.lastCheckedAt/lastCheckOutcome/lastCheckError`, `legalSourceVersions.bytesHash`. |
| **Simulated tests** | `reviewAndBundles.test.ts` Turn-17 block, 3 tests: (1) identical bytes → `unchanged`, no new version, AND a failed commit never advances freshness; (2) changed content → new version + opt-in alert (fromVersion 1 → toVersion 2 + coverage note) + searchable in `searchSources` + freshness hasText/not-stale; (3) FIXTURE section-detection: bare-act-shaped lines yield anchors `s 1`, `s 2`, `s 2A`; brochure-shaped lines yield 0 anchors (the gate that refused the MHA brochure). Fixtures are labelled FIXTURE in the test names. Full suite: **37 files / 566 tests green**. |
| **Real retrieval** | 2026-10-01, live: first fetch `status:"updated"` → version 2, versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`, bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`, 46,197 body chars, 44 sections; readback via `getSourceCli` (collectionDate 2026-10-01, Delhi Police publisher attribution). Repeat fetch `status:"unchanged"` — same version id, 0 alerts (dedupe demonstrated on real bytes). Probe log §1. |
| **Scheduled execution** | OLD sweep: cron-fired `legalSweepLogs` rows 28–30 Sep 2026 (18:30 UTC). Connector sweep: manual invocation 2026-10-01 (trigger=schedule row; attempted 1 / unchanged 1 / failed 0) + cron declared at 17:45 UTC daily. **Cron-fired connector-sweep evidence: pending the next 17:45 UTC tick.** |
| **Browser verification** | **None.** Browser automation is unavailable in this environment; no browser-based walkthrough of connector UI surfaces has occurred. |
| **Legal review** | **Outstanding.** Qualified lawyer review of the retrieved text (44/46 sections; completeness/currency of the reproduction) and of the channel-permissibility reasoning has NOT happened. |

---

## 5. End-to-end path, instantiated (the first permitted connector)

1. **Discover** — notice registry entry with URL, publisher, sanity bounds, access basis.
2. **Retrieve** — plain HTTPS GET, custom UA, PDF bytes.
3. **Validate** — magic bytes / size / section-count / section-1 / bounds gates; failure → FAILED run, nothing stored.
4. **Provenance/version** — immutable new version with publisher, URL, collection date, bytesHash; unchanged bytes → dedupe.
5. **Index** — text + section anchors stored on the version; citation-validator block lifted; fresh path (lastSuccessfulAt) advanced **only on success**.
6. **Search** — surfaceable via `searchSources`; opted-in anchored matters alerted via `evaluateSourceUpdate`.

---

## 6. Real retrieval + repeat-import dedupe (recorded values)

| Run | Result |
| --- | --- |
| First fetch (2026-10-01) | `status:"updated"`; **version 2**; versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`; bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`; 46,197 body chars; 44/46 sections |
| Repeat fetch | `status:"unchanged"`; version id unchanged; **0 new versions, 0 alerts** |
| Manual sweep invocation | attempted 1 / unchanged 1 / failed 0; `legalSweepLogs` row, trigger=schedule |

---

## 7. Freshness invariant

`legalSources.lastCheckedAt` is written by **both** success and failure paths (with `lastCheckOutcome` + `lastCheckError`), but the staleness computation (`freshness`) is keyed on `lastSuccessfulAt` **only**. Enforced by tests: a failed commit changes nothing the freshness query reports. A source that starts failing therefore drifts toward "stale" — never toward falsely "fresh".

---

## 8. Model-key independence

`OPENAI_API_KEY` is absent in this deployment. The official-source connector does not use any model provider: retrieval, validation, dedupe, versioning, indexing, search and alerting are all deterministic code. The absence of the key blocks nothing in this document's evidence.

---

## 9. Known limits (honest)

- One working connector exists (POCSO via Delhi Police). India Code, eGazette and SCI remain registry entries / manual-import histories with their blockers recorded — not connectors.
- The cron-fired connector-sweep execution record is pending the next 17:45 UTC tick; until then §2e's distinction is the operative truth.
- 44/46 sections detected in the reproduction; consolidation completeness/currency is NOT certified — qualified legal review outstanding.
- Browser verification: none (automation unavailable).
- If the Delhi Police channel ever changes URL or content shape, the connector records failures honestly; it does not silently fall back to any unofficial mirror.
