# OFFICIAL_SOURCES.md — Official-source connector: per-source report and evidence record

Turn 17 (1 October 2026). **Updated turn 26 (6 October 2026):** eGazette TLS
blocker root-caused and resolved WITHOUT disabling verification; second working
connector (DPDP Rules 2025 gazette PDF) retrieved live end-to-end; cron-fired
connector executions observed on the deployment. Deployment: Convex
**moonlit-elk-307**.

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

### 1.2 Gazette of India (egazette.gov.in) — eGazette — `in:rules:dpdp-2025` (second WORKING connector)

**Turn-26 status change: the turn-17 TLS refusal is resolved.** Root cause
(live diagnosis, 2026-10-06): the server serves an INCOMPLETE chain — leaf
CN=egazette.gov.in ← Let's Encrypt **YR2** intermediate only. The chain is
valid; it simply lacks its issuer, and Node's global fetch (undici) offers no
way to supply extra trust anchors. Resolution: `src/convex/gazetteCa.ts` pins
the **PUBLIC** Let's Encrypt/ISRG anchors (ISRG Root X1, sha256
`96BCEC06…`; Root YR cross-signed by X1, sha256 `072639D0…`; YR2 intermediate,
sha256 `238B85A0…` — each re-derivable from the chain's own AIA URLs
`x1/yr/yr2.i.lencr.org`), so the full chain VERIFIES. Certificate verification
stays fully enabled on every hop (custom `ca` replaces the default store — an
untrusted chain still fails). No login, no CAPTCHA, no verification disabling,
no access control bypassed. This is the standard browser AIA trust model.

| Data point | Status for this source |
| --- | --- |
| Access method + restrictions | Plain HTTPS GET of a PUBLISHED gazette PDF: `https://egazette.gov.in/WriteReadData/2025/267650.pdf` (G.S.R. 846(E), Digital Personal Data Protection Rules, 2025, English edition, CG-DL-E-14112025-267650). Incomplete TLS chain handled via pinned PUBLIC anchors (above). Note: the host 404s HTTP **HEAD** on these static paths while GET succeeds — the connector uses GET. |
| Discovery | Turn 26: the eGazette extraordinary-gazette list was walked live (session postback → `ViewPDF.aspx` → static `WriteReadData/<year>/<id>.pdf` URLs that work WITHOUT cookies/session; UGID→URL derivation verified two-for-two with 276770/276769). The DPDP Rules English PDF was identified, downloaded and validated through the project's own `detectSections` BEFORE any connector code was written (23/23 rule anchors). |
| Historical import | None directly from egazette.gov.in before turn 26 (DPDP Rules facts were web-search-derived in `docs/DPDP_REVIEW.md` §0, explicitly marked pending primary-gazette confirmation). |
| Scheduled connector config | **Yes — in code**: the same `crons.ts` `official-source-connector-sweep` (17:45 UTC daily) iterates ALL registered notices, including the new one — no scheduler change needed. |
| Last real retrieval | **2026-10-06, real fetch on moonlit-elk-307** via the scheduled-path function: `status:"updated"`, **version 2**, versionId `hh7zwadhdkne600vdmgkyn5h1h8frc95`, bytesHash `13ee60a70ee4208b6721b2d6fa7e2d7e71cbe982921c5ec8cb7de91aeb72585b` (project convention: SHA-256 of base64 of retrieved bytes), textHash `331084debce2ae8a95266b7b924e8c1b3c9ae39d159b32a37431880ea8475391`, runId `h17ncg77gwye2y6rcxg4k8bnhs8frj7w`; **118,579 body chars, 23/23 rule sections anchored**; collectionDate 2026-10-06. Independent local probe of the same URL: 2,492,944 bytes, `%PDF-1.6`, raw-bytes sha256 `eabc7d05e013144615d78ddc0e8b9c9aac1920e814f4fad38ce6560951f5aa08`. Repeat fetch: `status:"unchanged"` (§6). |
| Last scheduled execution | Cron configured; CLI-invoked scheduled-path runs recorded 2026-10-06 (`triggeredBy: manual`). Cron-fired connector execution for THIS notice pending the next 17:45 UTC tick (§2e). |
| Search / indexing status | Indexed: v2 text + section anchors stored; surfaceable via `searchSources`; citation validation can quote-check it. Registry row seeded via `seedIndianCoreCli` (9th row, kind `rules`). |
| Exact blocker | None for retrieval. **Legal review outstanding**: the gazette is bilingual (Hindi rule lines + English text), phased commencement (mid-phase regime; full effect 13 May 2027) — per-requirement operative dates in `dpdpRegister` remain `legalReview: outstanding` until a qualified reviewer confirms them. Hindi counterpart (CG-DL-E-14112025-267647) not ingested. |

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

**(a) Registry entry.** A row in `legalSources` describing a source. Since turn 26 there are 9 registry rows (7 Indian statutes + bounded SCI judgments + the DPDP Rules gazette source). A registry entry alone retrieves nothing.

**(b) Manual import.** Text ingested by authenticated operator action (browser path or `scripts/ingest-legal-text.mjs` CLI). Turn 6 (28 Sep 2026) manually imported 7 sources this way (IPC, CrPC, Evidence Act, BNS/BNSS/BSA via mha.gov.in PDFs, Evidence via verified reproduction, s3waas-hosted document), plus bounded SCI judgments. These are real texts with hash provenance — but no connector re-fetches them automatically.

**(c) Working connector.** Code that, given a notice, performs the full path autonomously: fetch → validate → dedupe/version → index. Since turn 26 exactly **two** exist: the POCSO channel (Delhi Police bare act, turn 17) and the DPDP Rules gazette channel (eGazette with pinned public TLS anchors, turn 26). Everything else remains (a) or (b).

**(d) Scheduler in code.** `crons.ts` declares three relevant jobs: `legal-source-ingestion-sweep` (18:30 UTC, since turn 7 — opens run rows; no automated fetcher completes them) and `official-source-connector-sweep` (17:45 UTC, turn 17 — actually fetches connector notices; iterates ALL notices, DPDP included since turn 26). Declaring a cron is configuration, **not** evidence of execution.

**(e) Scheduler observed executing.** On the deployment (read back 2026-10-06):
- **Cron-fired connector executions ARE OBSERVED for POCSO**: `connectorStatusCli` on `in:statute:pocso-2012` shows consecutive daily runs 86,400,0xx ms apart (Oct 1–5 ticks), each completed `outcome:"unchanged"` with `triggeredBy:"schedule"`, and `lastCheckedAt` = Oct 5 **17:45:30 UTC** — exactly the connector-sweep tick. Daily repeat-`unchanged` via cron = scheduler executing AND dedupe holding, live.
- Run-row semantics (do not misread): the 18:30 text-ingestion sweep opens a NEW run per source daily which stays `outcome:null` BY DESIGN until completed — POCSO's newest open run (Oct 5 18:30 UTC) is that state-machine row awaiting the next 17:45 connector tick, not a hung fetch. The connector's commit path (`connectorRun`) completes the currently-open run with updated/unchanged/failed.
- **Freshness invariant observed live**: the open (uncompleted) run did NOT advance `lastCheckedAt` — the recorded check metadata still belongs to the last SUCCESSFUL 17:45 connector tick.
- For the DPDP notice specifically, cron-fired execution is pending the next 17:45 UTC tick (the notice was registered 2026-10-06 ~06:18 UTC, after that day's tick); until then its scheduled-path evidence is the CLI-invoked runs recorded above.

---

## 3. Connector design (what the code guarantees)

Files: `src/convex/sourceConnector.ts` (actions), `src/convex/sourceNotices.ts` (pure notice registry with access basis), `src/convex/gazetteCa.ts` (pinned PUBLIC TLS anchors + node:https GET helper for incomplete-chain hosts; verification always ON), `src/lib/pdfExtract.ts` (pure extraction shared with diagnostics/tests), `src/convex/legalIntel.ts` (run state machine + commit + freshness), `src/convex/matterImpact.ts` (alert wiring).

- **Operator gate**: `fetchOfficialSource` runs an access/capability check (`connectorOperatorCheck`) — the connector is never callable by an anonymous caller.
- **Pinned-TLS path (turn 26)**: only notices flagged `tlsFix:"lets-encrypt-aia"` fetch through `gazetteCa.ts`'s pinned PUBLIC anchors; every other notice keeps the plain global-fetch path. A TLS failure rejects and is recorded like any other retrieval failure — never downgraded, never retried unverified.
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
| **Simulated tests** | `reviewAndBundles.test.ts` Turn-17 block, 3 tests: (1) identical bytes → `unchanged`, no new version, AND a failed commit never advances freshness; (2) changed content → new version + opt-in alert (fromVersion 1 → toVersion 2 + coverage note) + searchable in `searchSources` + freshness hasText/not-stale; (3) FIXTURE section-detection: bare-act-shaped lines yield anchors `s 1`, `s 2`, `s 2A`; brochure-shaped lines yield 0 anchors (the gate that refused the MHA brochure). Fixtures are labelled FIXTURE in the test names. Turn 26 adds `sourceNotices.test.ts` (registry-shape invariants: HTTPS-only targets, satisfiable sanity bounds, exactly one pinned-TLS host) and the seed-count assertion updates to 9 (`legalIntel.test.ts`). Full suite: **48 files / 606 tests green, `tsc -b --noEmit` 0 errors** (turn 26). |
| **Real retrieval** | 2026-10-01, live: POCSO first fetch `status:"updated"` → version 2, versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`, bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`, 46,197 body chars, 44 sections; readback via `getSourceCli` (collectionDate 2026-10-01, Delhi Police publisher attribution). Repeat fetch `status:"unchanged"` — same version id, 0 alerts. **2026-10-06, live: DPDP Rules gazette first fetch `status:"updated"`** → version 2, versionId `hh7zwadhdkne600vdmgkyn5h1h8frc95`, bytesHash `13ee60a7…`, textHash `331084de…`, 118,579 chars, 23/23 sections, over the pinned-verified TLS chain; repeat fetch `status:"unchanged"` (§6). |
| **Scheduled execution** | OLD sweep: cron-fired `legalSweepLogs` rows 28–30 Sep 2026 (18:30 UTC) and daily since. **Connector sweep: cron-fired executions OBSERVED 2026-10-06 readback** — POCSO daily `triggeredBy:"schedule"` runs at 86,400,0xx ms spacing (Oct 1–5 ticks), `lastCheckedAt` = Oct 5 17:45:30 UTC, all `unchanged` (§2e). Manual sweep invocation 2026-10-01 (trigger=schedule row; attempted 1 / unchanged 1 / failed 0). DPDP notice's own cron-fired tick pending (registered after the Oct-6 tick). |
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
| POCSO first fetch (2026-10-01) | `status:"updated"`; **version 2**; versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`; bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`; 46,197 body chars; 44/46 sections |
| POCSO repeat fetch | `status:"unchanged"`; version id unchanged; **0 new versions, 0 alerts** |
| POCSO cron-fired daily checks (read back 2026-10-06) | Daily `triggeredBy:"schedule"` runs (Oct 1–5 ticks), all `unchanged`; `lastCheckedAt` Oct 5 17:45:30 UTC — scheduled-path dedupe holding live |
| Manual sweep invocation | attempted 1 / unchanged 1 / failed 0; `legalSweepLogs` row, trigger=schedule |
| DPDP first fetch (2026-10-06, scheduled-path function on moonlit-elk-307) | `status:"updated"`; **version 2**; versionId `hh7zwadhdkne600vdmgkyn5h1h8frc95`; runId `h17ncg77gwye2y6rcxg4k8bnhs8frj7w`; bytesHash `13ee60a70ee4208b6721b2d6fa7e2d7e71cbe982921c5ec8cb7de91aeb72585b`; textHash `331084debce2ae8a95266b7b924e8c1b3c9ae39d159b32a37431880ea8475391`; 118,579 body chars; **23/23 sections** |
| DPDP repeat fetch (2026-10-06) | `status:"unchanged"`; runId `h17g3teyzmv764n5bxcm09xmy58fr336`; version id unchanged; **0 new versions, 0 alerts** |

---

## 7. Freshness invariant

`legalSources.lastCheckedAt` is written by **both** success and failure paths (with `lastCheckOutcome` + `lastCheckError`), but the staleness computation (`freshness`) is keyed on `lastSuccessfulAt` **only**. Enforced by tests: a failed commit changes nothing the freshness query reports. A source that starts failing therefore drifts toward "stale" — never toward falsely "fresh".

---

## 8. Model-key independence

`OPENAI_API_KEY` is absent in this deployment (re-checked turn 26; the generation code reads exactly `process.env.OPENAI_API_KEY` in `aiRunner.ts`, the only place it is read). The official-source connector does not use any model provider: retrieval, validation, dedupe, versioning, indexing, search and alerting are all deterministic code. The absence of the key blocks nothing in this document's evidence.

---

## 9. Known limits (honest)

- Two working connectors exist (POCSO via Delhi Police; DPDP Rules 2025 via eGazette with pinned public TLS anchors). India Code and SCI remain registry entries / manual-import histories with their blockers recorded — not connectors.
- Cron-fired connector executions are OBSERVED for the POCSO notice (daily Oct 1–5 ticks, §2e). The DPDP notice was registered after the Oct-6 tick; its own cron-fired execution is pending the next 17:45 UTC tick. Until then its scheduled evidence is the CLI-invoked runs (§6).
- POCSO reproduction: 44/46 sections detected; consolidation completeness/currency is NOT certified — qualified legal review outstanding.
- DPDP gazette: bilingual text (Hindi rule lines + English), phased commencement (mid-phase as of Oct 2026); per-requirement operative dates in `dpdpRegister` remain `legalReview: outstanding`. Hindi counterpart PDF not ingested.
- Browser verification: none (automation unavailable).
- If the Delhi Police or eGazette channels ever change URL or content shape, the connector records failures honestly; it does not silently fall back to any unofficial mirror.
