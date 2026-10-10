# Automated discovery pipeline — incident closure, review protocol, and coverage record

Turn 33 — closes the Rules-2007/Amendment-2006 misidentification incident and
puts the discovery pipeline's governance in one place. Companion to
`docs/OFFICIAL_SOURCES.md` §1.6 (the pipeline report).

## 1. Misidentification incident: closure record (2026-10-08/09)

**What happened.** Discovery-sweep cycle 2 detected the JJ Rules 2007 gazette
notification as "Amendment Act, 2006" from the amending-act citation in its
recitals and auto-promoted the WRONG body under the key
`in:statute:jj-amendment-2006`. Caught by stored-body readback the same
session; purged via `purgeDiscoveredSourceCli` (guarded: refuses anything not
marked `Discovered automatically` in `statusNote` — seeded/connector sources
are structurally unreachable); detector hardened (citation stripping,
"Rules under …" precedence, filename cross-check — mismatch ⇒ review, never
promote); re-run produced the correct body under the correct key
(19,448 chars / 25 sections; verified again 2026-10-09).

**Withdrawn artefact (audit identity):**
- stableKey claimed (wrongly): `in:statute:jj-amendment-2006`
- Withdrawn version: version 1, 19,448 chars, body starting
  `"~ ~ ~ ~04/0007!200… REGISTERED NO. DL--(O4/0007)2003-06 …"` (Rules-2007
  gazette shape) — was stored 2026-10-08 under source id
  `hn7jxadckghy94vcd25n1ssm3x8fxk3s` in some cycles; both wrong rows were
  deleted in full by the purge (source + its versions).
- Remaining correct version: version 1 of the re-promoted source (current
  `latestVersion` = `hh7npx54eyb20a650teqt0q6118fxhhw`), file
  `juvenule-justice-…-amendment-act-2006.pdf` (publisher's own filename),
  collected 2026-10-09.

**Downstream-use audit (2026-10-09, inline deployment queries):**

| Consumer | Mechanism | Found referencing the WRONG version? |
| --- | --- | --- |
| Source search (`searchSources`) | reads `legalSources` + `latestVersion` | No — wrong row deleted before any readback; search currently returns only the corrected v1 |
| AI research / Case X-Ray (`ai.ts`, `researchCore.ts`) | frozen `aiJobs.legalSourceVersions` snapshots | **2 aiJobs exist; neither references `jj-amendment-2006`** (checked every job's snapshot incl. carried retries) |
| Evidence bundles (`evidenceBundles`) | frozen citation rows | **0 bundles** on the deployment — nothing to flag |
| Matter-impact alerts (`matterImpactAlerts`) | fires only on `updated` commits to anchored matters | **0 alert rows** — no matter was anchored to this source |
| Exports/exit | part collection must name a matter/org; source rows are not exported | n/a — no org ever held this source |
| Adverse-authority search | searches corpus text | operates on the same `legalSources` rows; wrong text absent at every readback |

**Conclusion:** no downstream artifact ever consumed the wrong text — the
misfire lived and died inside the validator/store before any consumer drank
from it. Evidence of this audit itself is this section plus the sweep-log rows
on the deployment (readable via `legalDiscoveryStore:sweepLogsCli`).

**"Old references cannot silently resolve to replacement":** enforced by
construction — versions are immutable rows keyed by `sourceId`+`version`;
nothing re-points an old reference at new bytes. The wrong row was deleted,
NOT overwritten; auto-promotion of the replacement created a brand-new
source row. If a future snapshot ever referenced the withdrawn versionId, it
would fail to resolve (the row no longer exists) rather than silently showing
the corrected text.

## 2. Identity-before-promotion invariant (regression-locked)

`src/lib/legalDiscovery.test.ts` carries the misfire as fixtures, including:

- the verbatim-shaped Rules-2007 notification with the embedded
  "Amendment Act 33 of 2006" recital — must never resolve to the
  amendment-act identity (routes to the rules' own call, or null=review);
- the REVERSE direction (patched turn 33): a rules-identified body under an
  amendment-act-shaped filename is ALSO contradiction ⇒ review;
- a decision-table test proving the pipeline cannot auto-promote unless
  identity detection is non-null AND its instrument class agrees with the
  publisher's own naming (or the naming carries no signal) — filename
  agreement alone never establishes identity, and `null` identity never
  promotes regardless of filename.

Code path: `src/convex/legalDiscovery.ts` (~line 322) resets identity to null
on any class contradiction; `promoteFromReview` re-checks every gate before
staging promotion — a review status cannot bypass validation.

## 3. Three separate statuses (never collapsed)

Per candidate (`legalDiscoveryStore:reviewPacket`):

1. **Technical validation** — automated gates (PDF magic, size, identity
   consistency, language, section count, section 1, duplicates). Passed/failed.
2. **Publication decision** — the operator's promote/reject with a
   recorded note. Owning the software does NOT auto-grant this; the packet
   explicitly shows `PENDING` until a human acts.
3. **Qualified legal review** — `OUTSTANDING` by construction for
   auto-discovered text until a qualified lawyer attests via a
   `discoveryLegalReviews` row covering the CURRENT latest version
   (turn 34: the status is data-driven, never hardcoded — reviewer
   identity, scope, findings and date live in the record; see §6).

The console (`/platform` → *Official-source discovery* card) renders these as
three side-by-side status chips so no one can mistake a publication decision
for legal certification.

### Review packet contents

Original document URL (clickable) · extracted identity/title · proposed
stableKey (or honest "none") · jurisdiction entry · instrument shape
(amends-principal vs subsidiary-rules vs model-rules vs principal — stated,
not inferred into applicability) · section-anchor count · body size ·
devanagari ratio · bytes sha256 · per-gate warnings · provenance block for
already-promoted siblings. Promote requires a non-empty note ("Promote with
note" button disabled otherwise) — the reasoning is recorded on the candidate
row.

## 4. Source access decisions

**CARA (jj-2015):** the browser-UA override to a WAF that 403s other agents is
classified **unresolved** — it cannot be determined from outside whether the
host means to allow automation via browser agents or not. `scheduledRefreshDeferred: true` keeps the scheduled sweep off this notice; the
existing stored text stays untouched; manual operator-authorized import
remains, documented in `docs/OFFICIAL_SOURCES.md` §1.5. Owner software-approval alone cannot constitute the website's permission.

**eGazette listing (`egazette-recent-uploads`) — REGISTERED turn 34 (2026-10-10); supersedes the 9 Oct "not registered" decision:**
the blocker was re-examined and RECLASSIFIED. The encrypted ASP.NET postback on
the download image-button is the host's UI path, but it is NOT the only access
path and not an access control: each listing row's UGID
(e.g. `CG-DL-E-09102026-277020`) maps to the PUBLISHED static file
`/WriteReadData/<year>/<num>.pdf`, which the host serves by PLAIN GET with NO
session/cookies (verified live 9/10 Oct 2026: HTTP 200, `%PDF-1.6`,
`content-type: application/pdf`; turn-26 derivation re-verified two-for-two
against current rows). robots.txt is ABSENT (HTTP 404 — no disallow exists).
No CAPTCHA, no login, no postback replay — the pipeline takes the direct
published file ordinary browsers can open directly. Access mechanism in code:
listing fetched through the host's own `(S(session))` seed-redirect chain
(captured, never invented) with the pinned PUBLIC Let's Encrypt/ISRG anchors
(`gazetteCa.ts` — the host serves an incomplete chain; verification fully ON);
documents fetched by plain GET on the same pinned anchors.
**Access-basis evidence recorded in `discoveryListings.ts`.** BOUNDED policy:
`autoPromoteKeyPrefixes` is deliberately EMPTY — every eGazette candidate
(act, rule or notification of any kind) queues for OPERATOR review with a
promotion note; nothing from this national listing enters the corpus without
a recorded human decision.
**Access basis, stated precisely (turn 35):** what was verified is that the
host currently serves these paths to plain unauthenticated requests.
robots.txt is ABSENT (404) — an absence, not permission. No site terms
permitting automated collection or reuse were located; bulk/commercial
reuse conditions under the Copyright Act s.52 / Gazette rules remain
UNRESOLVED with the publisher, and NO licence is invented anywhere in the
record. If the publisher's conditions, once known, restrict automated
access, the listing entries must be removed and documents moved to the
authorized manual-import path.
**Live evidence (10 Oct 2026, moonlit-elk-307):** scan returns the same 20
rows each run (URL-hash dedupe steady state); validation: 13 candidates in
review (identity=null — general gazettes, correct pipeline behaviour), 6
initially `FAILED[exception] fetch failed` (undici egress TLS-chain build —
NOT an access refusal; same bytes fetched HTTP 200 with the pinned agents)
were requeued via `requeueFailedCli` and revalidated through the internal
pinned path to `review` with FULL metadata (e.g. 276926: 42,110 chars,
4 sections, hindi 0.0693); 1 size-gate rejection (a gauge-sheet PDF under the
20 KB floor — correct rejection, no retry). No promotion without an opera-
tor; operator actions for this listing happen in the /platform console.

## 5. Console workflow (reuses the existing CJ GLOBAL platform console)

**Route: `/platform`** (authenticated; platform-admin gated by the app's own
`amIPlatformAdmin` — same gate that protects every other console card).

New card, near the top (under the AI usage dashboards):
**"Official-source discovery"**

1. **Monitor strip** — per-status counts (`promoted / validated / review /
   found / rejected`) + the registered-listing line with the standing
   caveat: *scheduled runs with zero new candidates demonstrate execution and
   deduplication, not complete coverage.*
2. **Sweep-evidence table** — the 6 most recent `discoverySweepLogs` rows
   (when / trigger=manual|schedule / listing / links / new / validated /
   promoted / review / rejected) — proof of scheduled execution on real data.
3. **Review queue** — uncertain candidates with **Open packet** and instant
   **Reject**. The packet dialog shows the three-status strip, provenance,
   packet contents (§3), extraction warnings, and requires a note to promote.
4. **Reauthentication** — promotion is gated by the same loginEvents
   evidence class as firmExit: a platform operator signed in within the last
   7 days. Sign-out older than that ⇒ promote refuses with the exact message
   (enforced server-side on the action; the card pre-warns).

Incorrect-at-ingestion-time statuses that exist but are NOT badges in the
card: scheduled-sweep counts stay honest in the logs table (zero candidates ⇒
zero deltas everywhere); the "Duplicate" columns show in the packet warnings
(`duplicateOk`), not as invented coverage numbers.

## 6. Current coverage (honest)

| Listing | Registered | First live cycle | Steady state |
| --- | --- | --- | --- |
| NCPCR JJ listing (`ncpcr-jj-listing`) | yes | 2026-10-08: 1 auto-promote, 3 review, 2 dup-rejected, 4 odd-shape-review | scheduled ticks report `newCandidates: 0` |
| eGazette Bills&Acts (`egazette-recent-uploads`) | yes (turn 34) | 2026-10-10: 20-row capped recent window; 13 review + 6 requeued-then-review + 1 size-rejection; 11 Oct: newest-upload candidate found on the next scan (new=1 → review) | zero auto-promotes by policy; queue persists until an operator acts |
| eGazette Notifications (`egazette-notifications`) | **yes (turn 35)** | 2026-10-10: first live cycle — 20 rows, new=20, bounded validation (6/sweep) landed 6 → review, remaining 10 found + 10 review processed by subsequent sweeps | zero auto-promotes by policy |

**What this DOES and DOES NOT cover (turn 36, superseding the turn-35 wording):**
each Category feed is the host's capped "most-recent" window (20 rows); a
`Page=2` parameter is IGNORED by the host (probed 10 Oct 2026 — same rows
returned), so there is no deep pagination to walk. Publications older than each
window are NOT covered by automated scanning (connector notices / manual
import remain the paths for those). NO full-Gazette-coverage claim is made
anywhere: two slivers of a national publishing stream.

**"Moving-window protection" CORRECTED (turn 36).** The turn-35 claim was
wrong and is withdrawn: URL-hash dedupe prevents duplicate PROCESSING of an
already-seen item — it does NOT and cannot recover publications that appeared
in and left the capped window BETWEEN two successful scans, and it does not
establish that any scan shares even one item with its predecessor. The honest
continuity mechanism is now IN THE PRODUCT:

- Every sweep log records its observed window (`windowUrls`, capped ≤ 40) and
  an overlap verdict against the last SUCCESSFUL scan of the same listing:
  `overlap` (≥1 URL shared — continuity held, any open gap closes),
  `gap` (nothing shared — a POSSIBLE coverage gap opens), `first` (no prior
  successful scan), or `unknown` (the fetch failed; continuity for that
  interval cannot be established — a failed scan never opens, clears or
  closes an open gap).
- An open gap carries `coverageGapSince` (its first-seen timestamp) and is
  DISPLAYED on the /platform discovery card (amber "Possible coverage gap —
  completeness not guaranteed" strip + a Continuity column in the sweep
  table) until a later successful scan demonstrably overlaps again.
- Candidate RETENTION: candidates persist in `discoveryCandidates` by design
  (dedupe keys on stored rows; nothing is pruned) — items that later leave
  the front-page window keep their validation/review state and remain in
  their queue until processed. No silent loss by feed turnover.
- **Backfill: NOT SOLVED.** No permitted date-range/archive retrieval API
  could be located (researched turn 36: egazette.gov.in Interactive Search
  and archive pages exist as interactive forms, but no documented programmatic
  API, bulk endpoint, official annual compilation or sitemap was verified
  from this environment — the eGazette pages themselves could not be
  fetched/re-read here for independent confirmation). The publications that
  were missed between two successful scans may be UNRECOVERABLE by automated
  means. **Completeness is therefore NOT guaranteed and is not claimed**;
  the second capped category (Notifications) only widens two front-page
  slivers — it does NOT close the gap and must not be cited as if it did.
  If the publisher confirms a permitted bulk/date-range channel, it can be
  registered as a backfill listing; otherwise the residual gap is recorded
  on the release checklist (§B discovery row) as an open completeness risk.

**Reviewer authority (turn 35):** platform-operator status or CJ GLOBAL
ownership is NOT legal-review qualification. `recordLegalReview` is gated
by an explicit ACTIVE `reviewerAssignments` row whose jurisdiction prefix
matches the source's namespace (assignment stored + revocable, never
deleted). Claimed credentials are stored VERBATIM and marked
`credentialStatus: "self_declared"` — the platform does not verify bar
membership or any professional claim, and no surface presents a completed
review as evidence of verified qualification. The review packet now shows
the acting operator's two authorities separately (publication vs legal
review). Assignment targeting spares the owner from being the default
reviewer: assigned reviewers work their jurisdiction; `myReviewScope`
returns each user's active assignments.

Delta-from-completeness: one listing is a sliver of Indian legal publishing.
Coverage claims stay limited to what the registered listings publish.
