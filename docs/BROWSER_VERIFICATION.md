# Legal Intelligence — authenticated browser verification (§26, demand 8)

Status: **PENDING — not yet executed (BLOCKED: no browser automation).**
The automated tier (Convex push, typecheck, 506 backend/pure tests,
production build) is complete, but no signed-in browser session has walked
the UI yet. Evidence from the 2026-09-29 probes, kept separate:

- **Backend is LIVE.** The Convex deployment (moonlit-elk-307) answered a
  real query from the sandbox (`legalSources` count = 10) and its HTTP
  site answered (`404` on the bare host — normal for a functions-only
  site). The backend is NOT the blocker.
- **The vite dev server runs in the platform's managed session**, not in
  the execution sandbox: `ss`/`/proc/net/tcp` in the sandbox shows only
  the platform agent channel (port 7681), and ports 5173/5174/3000/8080/
  4173 have no listener reachable from here. A failed port probe from the
  sandbox does NOT prove the preview is down for the user — the preview
  URL is issued by the platform UI for the same workspace.
- **Browser automation is unavailable** in this environment (no browser
  runner). The checks below therefore remain BLOCKED, not passed.

Record the outcome (pass or defect list) in `ADVOKATE_PROGRESS.md` when
performed. Until then, claims stay at "automated checks passed; browser
verification blocked/pending."

## Preconditions

- Signed in as a chamber user with access to at least one matter.
- The India seed has run (owner console → Legal Intelligence panel →
  "Seed India core", or `bunx convex run legalIntel:seedIndianCoreCli`).
- Corpus ingested (7 statutes, v3+). The freshness card on the page shows
  per-source versions and collection dates.
- `OPENAI_API_KEY` is configured (see `docs/LEGAL_INTEL_MODEL_SETUP.md`)
  for the model-research steps 13–15; without it those steps exercise the
  honest provider-unavailable state instead.

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
12. **Clarification gate (block, not decoration).** On a matter whose
    jurisdiction is NOT confirmed and which has no recorded legal dates,
    submit any question in "Model research". Expect an amber
    "Blocked — clarification needed" card listing the focused questions,
    the question preserved, and NO "Research running …" state (the model
    is never scheduled). Then complete the matter profile (confirm India,
    governing date, stage) and press "Retry without retyping": expect the
    job to move to "Research running …".
13. **Model research — submit.** In "Model research — ask, inspect, save",
    with a matter selected and its profile complete, type a question
    ("What punishment applies for culpable homicide not amounting to
    murder for conduct on 2024-03-01?") and submit. Expect: the job
    appears immediately as "Research running …"; on a deployment WITHOUT
    the key, it resolves to the honest failure card ("Live AI is not
    configured …") with the question preserved and a "Retry without
    retyping" button; with the key, expect a real answer.
14. **Citation handling.** On a done answer, expect the citation-check
    rows: green "✓ stableKey · pinpoint · quote verified" lines when
    checks pass, a red-blocking banner ("MUST NOT be treated as
    verified") when any check fails, and the green verified banner must
    explicitly say passage-level legal support is NOT confirmed. Submit a
    question inviting a quote and verify a fabricated quote or a bare
    reporter-style citation surfaces as a failed row.
15. **Provenance & save/reopen.** Expect the "Grounded in these exact
    source versions" panel listing ingested version numbers, collection
    dates, original-source links and the coverage-limits line (judgment
    excerpts bounded; schedules/provisos not separately verified; POCSO
    excluded). Reload the page: the saved list still shows the job; click
    it — question, status, answer, snapshot and citation rows come back
    unchanged.
