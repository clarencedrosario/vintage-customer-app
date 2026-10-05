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
