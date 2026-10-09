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
3. **Qualified legal review** — permanently `OUTSTANDING` for
   auto-discovered text until a qualified lawyer attests. The statusNote
   stamped on every auto-discovered source says: "AS-PUBLISHED text —
   vintage/amendment status NOT consolidated; needs legal review before
   reliance."

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

**eGazette listing (probed 2026-10-09, NOT registered):** the host serves a
genuinely crawlable "recent gazettes" listing — 100 rows with ministry,
department, subject, part/section, issue/publish dates, Gazette IDs
(e.g. `CG-DL-E-07102026-276903`, `CG-OR-E-08102026-276951`) — after following
its `(S(session))` URL-prefix redirect chain. **But the PDF download is an
encrypted ASP.NET image-button postback** (`__VIEWSTATEENCRYPTED`, event
validation): a plain postback replay returns either a 500 Runtime Error or a
re-rendered listing, never the document. Reproducing that handshake outside a
real browser session would be working around a server-side control mechanism
— the same class of bypass this project refuses everywhere else. The
listing is therefore **not registered** in `discoveryListings.ts`; the
corpus's DPDP entry was fetched through the host's direct published-PDF URL
(turn 26 — a plain GET path, which the listing rows do not expose). Options
for a future hearing: a headless-browser retrieval note to the publisher's
helpdesk, use of `egazette.nic.in`'s known deep links when they surface, or
staying on MHA/gazette-PDF direct URLs published by ministries themselves.

**Probe evidence kept:** the probe session observed listing rows with UGID,
ministry, subject, file size (e.g. "0.74 MB") and publish dates 2026-10-07/08
— recorded here rather than in the code registry.

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
| eGazette recent-uploads | **not registered** (postback-gated download; §4) | n/a | n/a |

Delta-from-completeness: one listing is a sliver of Indian legal publishing.
Coverage claims stay limited to what the registered listings publish.
