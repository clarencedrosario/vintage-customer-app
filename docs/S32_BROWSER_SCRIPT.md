# §32 Browser verification script (manual — browser tooling unavailable)

Status: **ALL STEPS PENDING** — no browser step has been performed. When a
browser session is available, run the steps below against the dev preview and
record actual outcomes beside each expectation. Unit/integration greens do NOT
stand in for these.

Identity fixtures (synthetic development data):
- **A** — org owner (has every capability; sees all matters)
- **B** — junior/paralegal-class member WITH `note.write` but WITHOUT
  `matter.edit` (can record review decisions, cannot manage the matter)
- **C** — member restricted to a different matter (no access to the target
  matter) — proves tenancy/permission denials
- **D** — a member inside an ethical wall on the target matter (Phase 7) —
  must see NOTHING from the §32 tools (walls are not advertised)
- **P** — CJ GLOBAL platform admin (no chamber membership)

---

## Group 0 — Conflicting-evidence review (matter file → "Review (§32)" tab)

Route: sign in as A → `/matters` → open a matter with at least two extracted
documents containing contradictory dates/amounts → tab **Review (§32)**.

| # | Step | Expected outcome |
|---|---|---|
| 0.1 | Open the Review tab with no scan run yet | Amber disclosure strip visible ("…professional judgement… never an automated resolution"); "No conflicting passages are on the review list" empty state; no console errors |
| 0.2 | Click **Re-scan the record** | Button shows spinner while pending; success toast states how many conflicting pairs were detected; findings list appears with side-by-side Passage A / Passage B cards |
| 0.3 | Inspect one finding | Kind label (e.g. date conflict), status badge "Open"; each side shows statement, date/amount/party, source document name, version badge (vN), pinpoints |
| 0.4 | Click **Record decision**, leave reason empty, choose "Confirm conflict", click Save | Save button stays disabled with empty reason; with whitespace-only reason clicking yields error toast "A reason is required for every review action." — NO success indication appears |
| 0.5 | Enter a real reason and Save | Success toast "Decision recorded — Conflict confirmed."; form closes; the note shows on the card ("On the record: …"); status badge switches to "Conflict confirmed"; finding disappears from the open-only list |
| 0.6 | Toggle "Show decisions already on the record" | The decided finding reappears with its recorded status + note |
| 0.7 | Click **History** | Dialog lists the revision (Open → Conflict confirmed) with the saved reason and timestamp, newest first |
| 0.8 | Sign in as B (note.write) | Same list visible; **Re-scan** and **Record decision** enabled; saving a decision succeeds (persist + history row as 0.5) |
| 0.9 | Sign in as C (no access) | Opening the matter is refused by the existing matter gate; the Review tab shows the same empty state as any inaccessible matter (backend returns []) |
| 0.10 | As A, create an ethical wall covering the target matter with D in scope; sign in as D | Review tab shows the empty state — NO findings, NO error naming walls (walls are not advertised); D cannot act |
| 0.11 | Backend-error path: as B, submit a decision on a finding another user just decided (or force-expire session) | Error toast shows the backend's message verbatim; form stays open with the entered reason preserved |

Persistence check after 0.5/0.8: reload the page → the recorded status, note
and history survive (they are DB rows via `conflictReview.act`, not client
state).

---

## Group 1 — Review tab: alerts, bundles, adverse authority

Same route as Group 0 (sections of the **Review (§32)** tab).

| # | Step | Expected outcome |
|---|---|---|
| 1.1 (alerts) | As B (no matter.edit) open Matter-impact alerts | Opt-in checkbox disabled; badge "Managing alerts needs the matter-edit permission"; OPT-IN disclosure visible |
| 1.2 | As A switch alerts on without anchoring | Toggle succeeds; empty state "Nothing anchored yet"; no alerts possible |
| 1.3 | Anchor `in:statute:ipc-1860` (type the key) | Chip appears with × remove; backend requires a confirmed legal profile — if unset, error toast shows the backend's message verbatim |
| 1.4 | After a source version bump (seed data), open alerts | Alert card: source title, v-old → v-new, sourced treatment only with its supporting key, withheld-treatment note when unsupported, coverage note |
| 1.5 | Acknowledge with empty note → then with note | Empty refused (button disabled + backend error verbatim); with note: success toast, status badge "Acknowledged", card leaves open count |
| 1.6 | Convert to task proposal | Toast confirms proposal created; approve it via the existing proposals flow → task appears |
| 1.7 (bundles) | Open bundles section with none | Empty state explains creation from AI research; no creation button here (creation stays in the research flow) |
| 1.8 | Open Citation manifest on a bundle | Dialog lists citations with version/pinpoint/hash + validation badges; "exported as reference"; omitted list names licence-limited full texts; research-record label shown |
| 1.9 | Finalize a draft bundle | Toast; badge → finalized; Supersede/Reopen available; supersede works, reopen restores draft |
| 1.10 (adverse) | Search with a <8-char proposition | Button disabled; forced submit shows backend's "State the proposition…" toast |
| 1.11 | Search a real proposition | Hits with passage, matched terms, jurisdiction badge (same/other), treatment ONLY when supported (withholding note otherwise), "Inspect source" link opens the corpus URL |
| 1.12 | Recheck last research job | Items with recorded→current versions; changed/unavailable flagged; scope + adverse notes shown verbatim; decision form saves via recordDecision (needs note) and confirms on the matter trail |
| 1.13 | D (walled) opens Review tab | All four §32 sections render empty — nothing, no error naming walls |

## Group 2 — Filing, Translations, Redaction

| # | Step | Expected outcome |
|---|---|---|
| 2.1 | Matter without a checklist → Filing tab | Empty state + "Create checklist (v1)"; B (no matter.edit) sees the disabled button + note |
| 2.2 | As A create v1 | Version badge v1·draft; item rows render; toggling item states persists (reload keeps them) |
| 2.3 | Run Derive | Suggestions appear labelled "Derived from…"; Apply moves an item; Dismiss without reason refused; with reason recorded verbatim |
| 2.4 | Approve as ready | Confirmation dialog shows the no-acceptance-guarantee disclaimer; approve → toast "version frozen"; v1 badge becomes approved; version history shows snapshot hash |
| 2.5 | Attach a NEW document to the matter (or edit profile) then revisit | Approval INVALIDATED automatically: v1 shows invalidation (document_added) in history; the panel is back to draft state (v2 available via backend) — the frozen v1 record is never reopened |
| 2.6 (redaction) | Documents tab → expand Verified redaction | Only text-family files listed; with none, honest refusal explanation is shown |
| 2.7 | Add term without reason → run | Toast "Each entry needs the exact term, a label, and a reason"; duplicate term refused case-insensitively |
| 2.8 | Run on a real .txt with a term present | Processing state; verified → success toast with "Human review required"; history shows hits ×N, residues all zero "(verified)"; Open verified derivative downloads a real file whose text lacks the term (INSPECT the bytes) and sha256 shown matches |
| 2.9 | Run on a PDF (rename trick or seeded doc) | Refused toast with backend reason (unsupported_format); job recorded as refused — never "verified" |
| 2.10 | Run with a term NOT in the file / residue>0 case | FAILED outcome toast; no derivative offered; history row records the failure |
| 2.11 (translations) | Translations tab, no policy | Restrictive default explained; as B the policy form is hidden (matter.edit) |
| 2.12 | As A record machine_external with policy unset | Backend refusal toast verbatim (unset default); record manual translation → appears with MANUAL badge |
| 2.13 | Set policy allowed with ≥10-char authority, then machine_external | Saved with MACHINE badge + provider name/version; side-by-side opens with machine disclosure; paragraph pairing; verify with <10 chars refused; with real note → attested badge; if the original later changes → STALE disclosure shown, frozen pairing intact |

---

## Group 3 — Walls, holds & emergency access

Setup: A = owner (matter.close). B = associate (no matter.close). Identity fixtures from the header above.

| # | Step | Expected outcome |
|---|---|---|
| 3.1 | Conflicts page (/conflicts) as B | Walls & holds section renders; hold/wall forms hidden; note explains management needs close-matters capability |
| 3.2 | As A: place a hold from the Conflicts section (or Matter → Review tab MatterHoldCard) | Hold appears with kind badge + reason; deletion of that matter's records is now blocked firm-wide (try vault remove elsewhere → backend refusal) |
| 3.3 | Matter → Review tab, MatterHoldCard | Shows the active hold with "preservation active — deletion blocked firm-wide" badge; lifted history (if any) labelled with reason + who lifted |
| 3.4 | As B on MatterHoldCard / walls section | Place/lift controls hidden (matter.close only) |
| 3.5 | As A: lift with <10 chars | Toast demands ≥10 chars; with a real reason → hold lifted, decision recorded, row shows lifted-by/reason |
| 3.6 | As A: create a wall scoped to user B covering a matter | Wall card lists scope + matter + named exempt + reason; badge "active" |
| 3.7 | Sign in as B, open the walled matter | Matter does not appear in lists; direct URL → refusal; Conflicts desk still accessible |
| 3.8 | As A: expand "Emergency grants on this wall…" | Empty-state text "No emergency grants have ever been issued against this wall." |
| 3.9 | As A: Emergency grant… to B with reason court_order + detail | Grant listed: actor, reason, "awaiting acknowledgement — opens nothing yet", expiry ≤24h shown |
| 3.10 | As B: open a blocked surface (wallExplanation path) | Explanation shows wall title/reason + grant state instead of a bare refusal; acknowledge the grant there |
| 3.11 | As A: re-expand grants | Row now "active until expiry" with acknowledged timestamp |
| 3.12 | As A: Revoke… with <10 chars → refused; with a real reason | Row flips to "revoked" with revoked timestamp; B's access closes immediately |
| 3.13 | Wall lift flow (Lift… → inline reason) | Same ≥10-char enforcement as holds; wall badge becomes "lifted" with lift reason shown |

---

## Group 4 — Client updates, AI defence, dashboards, export & exit

Setup: A = owner. B = associate (note.write but not matter.edit). A client user with portal access on the test matter helps for 4.1–4.5.

### 4A — Client updates (Matter → "Client updates" tab)

| # | Step | Expected outcome |
|---|---|---|
| 4.1 | Approve 2–3 timeline entries on the matter, open Client updates | Approved developments listed with kind+date; unapproved entries absent |
| 4.2 | As B (note.write): select 2, prepare | Draft appears with assembled body + disclosure footer; provenance frozen (dev count shown) |
| 4.3 | Review card recipients | Portal/email/thread states shown; preference "never recorded" shows absent badge — never treated as consent |
| 4.4 | As A approve → as B queue | Approve needs matter.edit (B's Approve hidden); queue succeeds → outbox id shown; client portal sees the message via comm thread |
| 4.5 | Duplicate guard | Prepare the SAME development set again and queue → blocked with the duplicate-set reason verbatim |
| 4.6 | Provenance drift | After preparing, un-approve one development → review shows provenance problem; Queue disabled until fixed |

### 4B — AI instruction-defence (AI Studio in a matter)

| # | Step | Expected outcome |
|---|---|---|
| 4.7 | Paste a source containing "ignore previous instructions and …" (Opposing Party label), run any job | Amber banner above the result: "Instruction-defence review (1 signal)" with kind DIRECT INSTRUCTION, source name, excerpt; result still renders normally with its review-required badge |
| 4.8 | Clean-source job | No banner |

### 4C — AI quality dashboards

| # | Step | Expected outcome |
|---|---|---|
| 4.9 | /ai page bottom card (as A or B) | Firm dashboard: totals, defined-metric table with definitions printed under each value, by-kind table, freshness block with definitions; window buttons 7–120d refetch |
| 4.10 | /platform as platform admin | Platform dashboard above subscription summary: per-org rows keyed by opaque ids (counts/cost/tokens/defence-signal jobs only); disclosure states no names/content |
| 4.11 | Without OPENAI_API_KEY | Amber "no model key configured" honesty note visible on both dashboards |

### 4D — Export & exit (Settings → Export & exit)

| # | Step | Expected outcome |
|---|---|---|
| 4.12 | As B (no data.export) | Section shows the capability note; no forms |
| 4.13 | As A: start job | Job appears "collecting"; progress bar advances with each "Advance collection" click (cursor/plan shown) |
| 4.14 | Refresh omissions | Omitted tables listed with row counts + reasons (counts computed server-side) |
| 4.15 | Run verification | Verification block appears; failures (if any) listed — never smoothed over |
| 4.16 | Download a part | Link issues then redeems (single-use); second redeem of the same grant refused with the verbatim reason |
| 4.17 | Close organization without verified export | Refusal verbatim: "No VERIFIED export exists…" |
| 4.18 | Place a legal hold (Group 3) then close | Refusal names the matter + hold kind; block recorded on the job (shown in the job list) |
| 4.19 | Lift hold, close with confirmation text | Only exact "CLOSE ORGANIZATION" enables the button; success appends [ORG CLOSED date] to the job label |
| 4.20 | Reauth path (log out/in >168h simulated or fresh fixture without loginEvents) | Start/download/close refusals surface verbatim, including "No successful sign-in is on record…" |
| 4.21 | Revoke export with <10 chars | Refused; with reason → status revoked; further downloads refused |

---

## Turn-26 addendum — prioritized 8-workflow walkthrough (**NOT EXECUTED**)

Status: **WALKTHROUGH ONLY — every step below is UNVERIFIED.** Browser tooling
remained unavailable at the end of turn 26; this section translates the
highest-value end-to-end workflows into a prioritized, role-and-route-exact
script. Prioritization principle: workflows whose failure would produce a
WRONG legal artifact (mis-cited authority, unredacted derivative, walled
data leak, misrepresented export) outrank convenience surfaces. Detailed
step tables live in Groups 0–4 above; this addendum binds each workflow to
its group steps, the exact route, the minimum fixture set, and the expected
result that must be observed (not assumed).

| # | Priority / workflow | Route · fixtures · group steps | Expected results to OBSERVE |
|---|---|---|---|
| 1 | **P1 — Conflicting-evidence review** (32.1): compare conflicting passages, save a decision, reload | `/matters/:matterId` → **Review** tab (ConflictReviewPanel). Fixtures A (decider) + B (note-writer, no matter.edit). Group 0 steps 0.1–0.10 | Two conflicting statements side-by-side WITH provenance (kind labels, source refs); deciding REQUIRES a note; decision + note + actor persist across reload; history dialog shows the act; re-scan does not lose recorded decisions |
| 2 | **P2 — Citation inspect + recheck vs source** (32.2): recheck a bundle/job's citations against stored source text | `/research` → **Adverse check** panel (recheck over latest job/bundle) + matter Review tab. Fixture A. Group 1 (1.x) steps | Recheck runs against the CURRENT stored version; changed/unavailable rows are listed, never silently passed; recording a decision requires the note threshold; a citation that fails against stored text shows as failed, not "cited" |
| 3 | **P3 — Filing approval → invalidation** (32.5): approve ready, then change a reviewed document, confirm auto-invalidation | `/matters/:matterId` → **Filing** tab (FilingReadinessPanel). Fixtures A (approver) + B. Group 2 (2.x filing steps) | Deterministic checks + suggestions render; approve-ready requires the disclaimer acknowledgment and freezes the snapshot; editing a reviewed document afterward flips the approved status to invalidated WITH the reason; version list shows the invalidated entry — never silently stays "ready" |
| 4 | **P4 — Verified redaction derivative** (32.6): produce + download, inspect contents | `/matters/:matterId` → **Documents** tab → Redaction section. Fixtures A (upload capability) + B (no capability → refusal, no trail). Group 2 (2.x redaction steps) | Unauthorized caller refused with recorded refusal; derivative downloads and opens; targeted terms ABSENT from the derivative; coverage note + hits/residues shown; refusals recorded verbatim |
| 5 | **P5 — Wall denial across identities** (32.7): place wall, verify denial as a walled identity | `/conflicts` (WallsHoldsPanel) to create; then sign in as D and attempt the walled matter. Group 3 steps | D sees NOTHING §32-related (walls are not advertised — no "you are walled" leak); A sees the wall with explanation read-only; wall filtering holds on every retrieval path incl. AI |
| 6 | **P6 — Emergency access lifecycle** (32.7): grant → acknowledge → expiry/revoke | `/conflicts` → per-wall emergency grants (WallsHoldsPanel); matter Review tab MatterHoldCard. Fixtures A (wall manager) + grant-holder + D. Group 3 steps | Grant does NOT open anything until the HOLDER acknowledges (non-holder acknowledge refused server-side); expiry ≤24h and revoke close access immediately; grant history visible; NO self-authorized bypass anywhere |
| 7 | **P7 — Client update recipient authorization** (32.10): prepare → review → approved delivery | `/matters/:matterId` → **Client updates** tab (ClientUpdatesPanel). Fixtures A/B (draft/approve/queue capability split). Group 4A steps | Approved-developments picker only; footer disclosure travels with the draft; review dialog shows recipient authorization state honestly (unauthorized/unverified recipients NOT offered as approved delivery); duplicate guard fires; queue hands off to commOutbox — nothing sends outside the approved path |
| 8 | **P8 — Firm export vs manifest/omissions** (32.12): export → download → compare against manifest + omissions list | `/settings` → Export & exit (ExportExitPanel). Fixtures A (data.export + reauth evidence) + B (no capability). Group 4D steps 4.12–4.21 | Capability + 7-day-reauth gates verbatim; manifest rendered BEFORE any success labelling; downloaded parts byte-match the manifest scope; omissions listed with counts + reasons; verification failures shown, never smoothed; single-use download grants refuse reuse |

Cross-cutting expectations for ALL eight: cross-tenant identity C is denied at
every route; AI surfaces re-check org+matter access; AI outputs never appear
without the "Draft — Professional Review Required" disclosure; nothing is
ever silently smoothed over — failures render verbatim.
