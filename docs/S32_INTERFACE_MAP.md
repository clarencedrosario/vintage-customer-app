# §32 Interface Map — requirements → backend → user-facing surface

Statuses used: **B** = backend implemented + automated tests green (turn 16–24) · **UI** =
user-facing screen implemented this programme · **UI-PENDING** = no screen yet ·
**BV-PENDING** = browser verification pending (browser tooling unavailable in this
environment; manual script below). Backend tests: 43 files / 589 tests green (turn-24
baseline, preserved).

Principle: **no twelve disconnected nav entries.** Matter-specific tools live in the
matter file (`/matters/:matterId` tabs); firm administration lives in the Owner console
(`/owner`); CJ GLOBAL operations live in `/platform`. Research-adjacent tools reuse the
existing `/research` workbench.

**Implementation progress (updated at the end of the first build session):** the shared
panel foundation is in place and compiling (`src/components/s32/shared.tsx` — AuthWall
permission-denied state, S32Empty/S32Loading, S32Note disclosure strip, errMessage toast
helper); full suite re-verified green (43 files / 589 tests) and `tsc -b --noEmit` 0 after
it landed. The twelve panels listed below are scoped with their exact backend calls and
states; panel components and console/tab wiring are the next bounded phase.

| # | Phase (§) | Existing backend (verified by tests) | Customer / operator route | Authorized roles | Interface work | Verification |
|---|---|---|---|---|---|---|
| 1 | Conflicting-evidence review (32.1) | `conflictReview.scan` (internal), `list`, `history`, `act` (confirm_conflict / dismiss_different_events / dismiss_other_reason / mark_unresolved / accept_interpretation, note), `flagForReassessment` | Matter file → **Review** tab (§32 panel); scan triggered from AI Studio step + a **Re-scan** button | Any member with matter access; walls filter via `access.ts`; `act` requires `note.write`-gated writers (backend capability check) | `src/components/s32/ConflictReviewPanel.tsx` — side-by-side A/B statements with provenance, kind label, action buttons w/ mandatory note, history dialog, re-scan, source-change flags | B ✓ · UI ✓ · BV-PENDING |
| 2 | Adverse authority & citation recheck (32.2) | `adverseAuthority.searchAdverse` (query: position, country, limit), `recheck` (jobId XOR bundleId), `recordDecision` (stableKey, decision, note ≥ threshold) | Research workbench `/research` → **Adverse check** panel (new tab section) | All signed-in chamber members (query-level access checks; decision recording is the lawyer's act) | `src/components/s32/AdverseAuthorityPanel.tsx` — proposition input, hits with passages + terms + treatment-supported labels + scope note; recheck button over latest job/bundle with changed/unavailable rows; decision recording with note | B ✓ · UI ✓ · BV-PENDING |
| 3 | Matter-impact alerts (32.3) | `matterImpact.list` (per matter, coverage note), `setOptIn`, `setAnchor`, `acknowledge` (note), `dismiss` (reason), `assign`, `convertToTaskProposal` (reuses §21 propose→approve) | Matter file → **Review** tab (alerts card); opt-in/anchor controls require `matter.edit` | Members with matter access; opt-in/anchor: `matter.edit`; acknowledge/dismiss/assign: backend-gated | `src/components/s32/MatterImpactPanel.tsx` — opt-in switch + anchored-source chips + alert cards (source title, from→to version, sourced treatment, withheld-treatment note) with acknowledge/dismiss/assign/convert actions | B ✓ · UI ✓ · BV-PENDING |
| 4 | Research evidence bundles (32.4) | `evidenceBundles.createFromJob`, `get`, `listForMatter`, `setReview` (draft/finalized/superseded), `manifest` | Research workbench `/research` (bundle from AI job — existing flow) + Matter file → **Review** tab (matter's bundles list + review actions) | Members with matter access; creation from own org's job (backend-checked) | `src/components/s32/EvidenceBundlesPanel.tsx` — bundle list, freeze/supersede status actions, citation-table manifest dialog with validation flags | B ✓ · UI ✓ · BV-PENDING |
| 5 | Filing-readiness workspace (32.5) | `filingReadiness.getDraft`, `listVersions`, `createDraft`, `setItem`, `deterministicChecks`, `proposeSuggestions`, `listSuggestions`, `applySuggestion`, `dismissSuggestion`, `approveReady` (+ auto-invalidate) | Matter file → **Filing** tab (new) | All matter members (draft/checks); approve: backend capability gate | `src/components/s32/FilingReadinessPanel.tsx` — draft creation, item checklist w/ status + linked doc/fact, deterministic checks block, AI suggestions (apply/dismiss w/ reason), approve-ready with disclaimer + frozen-snapshot note, version list with invalidated reasons | B ✓ · UI ✓ · BV-PENDING |
| 6 | Verified redaction (32.6) | `redactionRun.produceVerifiedRedaction` (action), `redaction.listRedactionJobs` (per matter) | Matter file → **Documents** tab → Redaction section (document-scoped, right where files live) | `document.upload` capability (backend refuses otherwise; unauthorized callers leave no trail) | `src/components/s32/RedactionPanel.tsx` — document picker (text-family files only, reasons shown otherwise), terms editor (longest-first, dedupe), run with processing state, per-job coverage note + hits/residues, verified derivatives listed with download; refusals recorded verbatim | B ✓ · UI ✓ · BV-PENDING |
| 7 | Legal holds / walls / emergency access (32.7) | `ethicalWalls.placeHold` / `liftHold` / `holdsForMatter` / `activeHolds` / `createWall` / `liftWall` / `listWalls` / `wallExplanation` / `grantsForWall` / `grantEmergencyAccess` / `acknowledgeEmergencyAccess` / `revokeEmergencyAccess` | Chamber: **Conflicts desk** (`/conflicts`) → Walls & holds section (org-wide walls, holds, per-wall emergency-grant history with revoke); Matter file → Review tab → `MatterHoldCard` (place/lift where the matter is). NOTE: `/owner` is the CJ GLOBAL platform-operator console and refuses chamber owners — the map's original `/owner` destination was corrected | Holds & walls: `matter.close` capability (backend); emergency grants: wall creator/manager path; NO self-authorized bypass — grant holders must acknowledge, expiry/revoke close access | `src/components/s32/WallsHoldsPanel.tsx` (owner console: org-wide walls + holds + emergency grants lifecycle) and `src/components/s32/MatterHoldCard.tsx` (matter-level place/lift) | B ✓ · UI ✓ · BV-PENDING |
| 8 | AI-processing warnings (32.8) | `aiDefence` record persisted on `aiJobs.instructionDefence` + banner in output; `ai.getJob` exposes it | Existing AI surfaces (`/ai`, matter AI Studio) — **banner + signals table added to the shared job view**, no new route | Existing AI-job viewers | Extend `src/components/AiStudio.tsx` (and `/ai` job view if separate) with the instruction-defence notice + signal table rendering the persisted record; nothing new to call | B ✓ · UI ✓ · BV-PENDING |
| 9 | Multilingual evidence review (32.9) | `multilingual.setHandlingPolicy`, `getHandlingPolicy`, `recordTranslation`, `sideBySide`, `listForMatter`, `verifyTranslation` | Matter file → **Translations** tab (new) | Members with matter access; policy: `matter.edit`; verification: capability-gated attestation | `src/components/s32/TranslationsPanel.tsx` — policy card (unset default refusal explained), record form (original/target text, languages, provider kind/name/version), side-by-side viewer with segmentation + mismatch headline, machine/manual labels, supersession chain, verify attestation | B ✓ · UI ✓ · BV-PENDING |
| 10 | Client-update drafts (32.10) | `clientUpdates.listDevelopments`, `prepareDraft`, `approveDraft`, `cancelDraft`, `draftReview`, `queueForSend` (→ commOutbox), `listDrafts` | Matter file → **Client updates** tab (new) | Draft: `matter.edit` (backend); approve: `matter.edit`; queue: `note.write` (backend gates each) | `src/components/s32/ClientUpdatesPanel.tsx` — approved-developments picker, prepare (footer disclosure travels), review dialog (recipients honesty, provenance re-verification state, duplicate guard), approve → queue → outbox handoff, drafts list with states | B ✓ · UI ✓ · BV-PENDING |
| 11 | AI dashboards (32.11) | `aiDashboards.firmDashboard`, `platformDashboard` (whitelist + leak guard) | Firm: `/ai` → **AI quality & cost** card (bottom of the AI page); CJ GLOBAL: `/platform` → **AI usage** card (top of platform console). NOTE: corrected from `/owner` — that console is platform-operator-only | Firm: chamber members (own org only); Platform: `users.isPlatformAdmin` only | `src/components/s32/AiQualityDashboard.tsx` (shared renderer) used in both consoles with scope-aware disclosures; window selector; defined-metric table (definition printed under each value); freshness block | B ✓ · UI ✓ · BV-PENDING |
| 12 | Firm export & exit (32.12) | `firmExit.startExportJob`, `runCollectStep`/`collectStep`, `runVerification`/`verifyExport`, `recordOmissions`, `buildManifest`, `issueDownload`, `redeemDownload`, `closeOrganization`, `revokeExport`, `listJobs` | Chamber: **Settings** (`/settings`) → Export & exit section (between backup cards and role permissions). NOTE: corrected from `/owner` — that console is platform-operator-only | `data.export` capability or owner (backend); all gated actions also require 7-day reauth (loginEvents evidence) | `src/components/s32/ExportExitPanel.tsx` — job lifecycle UI (start → collect progress → verify → omissions refresh → manifest dialog → download via issueDownload+redeemDownload → revoke), close-organization danger flow with hold-aware blocking; **precise scope view: INCLUDED parts vs OMITTED records with reasons, verification failures shown, manifest shown BEFORE any success labelling** (per user requirement 5) | B ✓ · UI ✓ · BV-PENDING |

## Cross-cutting

- **Phase 7 re-check vs current code (requirement 4):** hold enforcement on `vault.remove`
  verified in `src/convex/vault.ts` (blocks every member, incl. owners); wall checks run
  inside `access.ts` gate used by all §32 modules; downloads (`documents.issueSecureDownloadLink`)
  and export actions (`firmExit`) carry capability + reauth gates. Remaining gap fixed this
  programme: management console for holds/walls/emergency access (row 7) — until now these
  flows existed only in tests/backend.
- **Phase 7 destructive-path sweep (completed this session).** Every `ctx.db.delete` call
  site audited (`grep -rn "ctx.db.delete" src/convex`):
  (1) `vault.remove` — the only document-destruction path — is hold-enforced for every role,
  owners included (`vault.ts` ~542);
  (2) a matter **hard-delete mutation does not exist** — the `matter.delete` capability is
  defined in the matrix but no mutation consumes it, so there is no unguarded path;
  (3) `undertakings.remove` deletes DRAFTS only — active/completed undertakings refuse
  deletion by explicit message;
  (4) `billing.deleteInvoice` deletes DRAFT invoices only — sent invoices are cancelled,
  never deleted;
  (5) `matters.removeParty` / `clients.removeContact` remove editable link rows
  (capability-gated, audit-logged) — noted limit: a legal hold freezes document deletion
  but does not freeze party/contact edits, by design (holds protect preservation-class
  records, not working metadata);
  (6) `restoreVerification` purges are internal mutations that refuse anything not a
  `restore-sandbox-` org — live data untouchable by construction;
  (7) remaining delete sites are infra tables (sessions, 2FA codes, offline sync cleanup,
  legal-intel reindex chunks, github store, AI sources/docket suggestions, deadline
  holidays, reminder rules, membership removal) — not client legal records.
  **No self-authorized wall bypass:** `grantEmergencyAccess` requires `matter.close` and
  opens nothing until the HOLDER acknowledges (`acknowledgeEmergencyAccess` refuses
  non-holders server-side); grants expire ≤24h and revoke closes access immediately;
  exempt actors are explicit at wall creation only; `wallExplanation` is read-only.
- **Downloads & exports:** document downloads use the existing secure-token flow
  (`documents.issueSecureDownloadLink` → `verifySecureFileToken`); export part downloads use
  `firmExit.issueDownload` (1-h grant, single-use redeem). Both require access checks — no
  new download path is introduced.
- **AI-result delivery:** instruction-defence records are visible only through
  `ai.getJob` (org-gated); the platform dashboard's leak guard remains the outer boundary.

## Connector reconciliation (requirement 7) — summary (full report: ADVOKATE_PROGRESS.md)

- **India Code (POCSO 2012)** — scheduled daily sweep (`crons.ts` official-source-connector-sweep
  → `sourceConnector.scheduledConnectorSweep`) checks the Delhi Police official reproduction
  notice. No automated full-text fetcher is configured: opened runs are completed by explicit
  authenticated ingestion (`scripts/ingest-legal-text.mjs`). POCSO full text was NEVER retrieved
  from official hosts (documented refusal log, turn 7); retrieval NOT exhaustive.
- **Gazette of India (DPDP Rules 2025, BNS/BNSS/BSA 2023 gazette copies)** — MHA/Gazette PDFs
  for BNS/BNSS/BSA/Constitution were successfully imported (sha256-verified, see
  `docs/evidence/legal-corpus-manifest.json`); DPDP Rules text itself is registered, ingestion
  pending official retrieval. No live automated fetcher runs against gazette.gov.in.
- **Supreme Court of India** — api.sci.gov.in returned an empty body at retrieval attempts
  (turn 7 log); no connector registered; search over SCI material is unavailable.
- A cron passing ≠ live ingestion: sweep rows + `legalSweepLogs` are the evidence trail;
  last successful scheduled execution evidence = sweep/connector run rows in the deployment
  (verifiable in-product), not test assertions.
