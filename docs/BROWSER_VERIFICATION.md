# Legal Intelligence — authenticated browser verification (§26, demand 8)

Status: **PENDING — not yet executed.** The automated tier (Convex push,
typecheck, 498 backend/pure tests, CLI-era pipeline checks over the real
corpus) is complete, but no signed-in browser session has walked the UI yet.
This document gives the exact manual steps; record the outcome (pass or
defect list) in `ADVOKATE_PROGRESS.md` when performed. Until then, claims
stay at "automated checks passed; browser verification pending."

## Preconditions

- Signed in as a chamber user with access to at least one matter.
- The India seed has run (owner console → Legal Intelligence panel →
  "Seed India core", or `bunx convex run legalIntel:seedIndianCoreCli`).
- Corpus ingested (7 statutes, v3+). The freshness card on the page shows
  per-source versions and collection dates.

## Steps (record observed result for each)

1. **Entry.** Sign in → chamber shell → "Legal Intelligence" nav entry.
   Expect the workspace at `/legal-intel`, not a redirect to `/auth`.
2. **Jurisdiction context.** The top card shows the active matter's country
   label and governing legal date. If no matter is selected, pick one in
   "Matter context". Expect "date assumed" badge only when the matter has
   no recorded legal dates.
3. **Confirm jurisdiction.** Set/confirm country (`in`) and a governing
   legal date of `2024-03-01`; save. Expect the profile to persist after a
   page reload.
4. **Coverage honesty.** The "Coverage for this jurisdiction" card shows
   India statuses (legislation ingested) and, if switched to e.g. France,
   `not_started` states — never implied AI support.
5. **Ingestion freshness.** The per-source card lists all 10 registered
   sources with version + collected date; POCSO shows its "not obtained"
   status note; nothing stale is hidden.
6. **Research check — pre-commencement era.** In "Research check", enter
   question "punishment for murder for conduct on 2024-03-01", pinpoint
   `§ 302`. Expect: retrieved passage titled Indian Penal Code § 302 with a
   green "verified" badge; the answer pane identifies IPC as governing with
   review flags mentioning the 2023 codes/savings.
7. **Clickable passage.** Click the retrieved § 302 row. Expect the stored
   text excerpt to expand inline with version + offset metadata.
8. **Post-commencement era.** Change the governing legal date to
   `2024-08-15` and run with pinpoint `§ 103`. Expect Bharatiya Nyaya
   Sanhita § 103 retrieved instead of IPC.
9. **Refusal contract.** Set country to `fr` and run any question. Expect
   the amber "Refusal recorded" banner and zero substantive passages.
10. **Register & search.** Verify the European register list renders with
    per-country statuses distinct from data readiness; run a source search
    (e.g. "sedition") and open a result's detail.
11. **Evidence discipline.** Screenshot each step. Anything that deviates
    from the expectation above is a defect to record — do not "walk past"
    it. The result of this checklist is the only thing that may move
    demand 8 from pending to done; a lawyer-review pass (tier 5) is a
    separate, later step by a qualified person.
