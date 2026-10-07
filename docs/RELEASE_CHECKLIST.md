# ADVOKATE — Consolidated Release Checklist (single source of remaining work)

Status vocabulary: ✓ done (with evidence link) · ◐ in progress/partial · ✗ open ·
⏸ pending external dependency (keys, approvals) · ✗✗ explicitly out of scope this release.
Nothing here may be marked done by a unit test alone; browser/live evidence is
required where stated. (Owner setup steps live in `docs/OWNER_SETUP_CHECKLIST.md`.)

## A. Commercial release (turns 27–28)

| Item | Status | Evidence / next action |
|---|---|---|
| Public pricing page (A–D, monthly/yearly, computed savings, no invented prices) | ✓ code+tests; ✗ browser | e2e `pricing.spec.ts` pending execution |
| Subscription mgmt (checkout→activation→upgrade→downgrade@period_end→withdraw→cancel→grace→read-only) | ✓ code+tests; ✗ browser | backend tests green (commercial suite); e2e billing spec pending |
| Explicit billing (manual-renewal label, due date, unpaid consequences, next-billing-period change policy, ₹0.00-today + next charge before confirm) | ✓ implemented turn 28 | `src/lib/planChange.ts` + confirms; e2e asserts copy |
| Server-enforced AI entitlements (plans, reservations, no unapproved overage, background paths) | ✓ code+tests | entitlement matrix green; live-model path ⏸ `OPENAI_API_KEY` |
| Model tiers honest (standard/advanced-when-configured) | ✓ code+tests | ⏸ `ADVOKATE_ADVANCED_MODEL` for advanced |
| Merchant separation (CJ GLOBAL vs firm accounts) | ✓ code+tests | ⏸ live verification needs provider test mode |
| Browser walkthrough (pricing/billing/workspace) | ✗ not executed | turn-29 attempt recorded: runner 1.63.0 installed but `playwright install chromium --with-deps` FAILED (`Failed to download Chrome for Testing 153.0.8010.12 … Download failure, code=1`), no system browser, no reachable app URL in the authoring env — run per `e2e/README.md` §1–6 in a Chromium-capable environment |
| Provider test-mode payment flows (checkout, duplicate webhook, failed payment, renewal, cancel, refund) | ✗ not run | turn-29 live probe: `publicPlanCatalog` → `purchasingAvailable:false`, `plans:[]` (no keys AND no plans configured) — ⏸ Razorpay test keys + webhook + plan prices → run matrix in checklist §6 BEFORE any live activation |
| Bounded real-AI checks (source-backed answer, unsupported-jurisdiction refusal, drafting with missing facts) | ✗ not run | ⏸ `OPENAI_API_KEY`; budget proposed turn-29: project test key, US$5/month hard cap, 3 jobs on synthetic matter (gpt-4o-mini; advanced dormant while `ADVOKATE_ADVANCED_MODEL` unset) |
| Enterprise contact workflow | ✓ code+tests | reply workflow is human (owner action after first enquiry) |

## B. Official-source connectors (32.17)

| Item | Status | Next action |
|---|---|---|
| POCSO connector + corpus text | ✓ LIVE (v2, cron-fired daily runs observed Oct 1–5) | retain: legal review of text |
| DPDP Rules 2025 connector | ✓ LIVE retrieval + dedupe | cron tick evidence on next sweep; Hindi counterpart ✗ |
| India Code deep URLs | ✗ service-side timeout (recorded, not bypassed) | retain on checklist; retry probe |
| SCI APIs | ✗ authorization-gated | needs credentials (owner decision) |
| Scheduled-ingestion evidence file | ✓ `docs/OFFICIAL_SOURCES.md` | keep appending per-sweep evidence |
| Discovery of NEW official publications | ✗ open | refreshes of the two registered sources (POCSO, DPDP Rules daily cron) are NOT discovery; discovering new/other official publications (India Code deep-URL retry, SCI authorization, eGazette expansion) remains open work on this checklist |

## C. Data protection & continuity

| Item | Status | Next action |
|---|---|---|
| Backup/export & exit (§32.12) | ✓ code+tests; ✓ restore drill EXECUTED (turn 29: isolated in-memory instance, 3/3 — archive → restore into transient `restore-sandbox-*` → independent count verify → purge → `restore_test` register row; purge refuses non-sandboxes; count tampering fails loudly) | remaining: run the same `runRestoreDrill` once on the REAL deployment (owner UI: Settings → Data & backup) for production-grade evidence |
| Redaction (§32.6), walls/holds (§32.7), multilingual (§32.9), client updates (§32.10) | ✓ code+tests; ✗ browser | browser walkthrough groups in `docs/S32_BROWSER_SCRIPT.md` still NOT EXECUTED |

## D. Operations

| Item | Status | Next action |
|---|---|---|
| Monitoring & health | ◐ `/health` surface + AI dashboards (honest unconfigured states) | define alert thresholds + who gets paged; connect uptime probe to `/health` |
| Customer support | ◐ support tickets + operator queue (§32.11 era) + enterprise-lead triage | owner: decide support channel/SLA and publish contact |
| Commercial documents review | ✗ | owner/legal: review pricing copy, renewal terms, refund policy, tax configuration before live activation |
| Production deploy | ✗✗ restricted | owner-only, after A/B above |
| Live charges | ✗✗ restricted | only after owner-approved live keys + explicit approval |

## Standing restrictions (unchanged)

No production deployment, no paid-service activation, no real charges, no
destructive operations, no Git publishing — none performed. Automated suite
remains the regression backbone: **52 files / 674 tests green** (turn-28) —
it does NOT substitute for the browser/live rows above. Turn-29 execution record: restore drill 3/3 EXECUTED (isolated instance); browser E2E blocked (browser-download failure + no reachable app URL — recorded, not bypassed); payment test-mode blocked on missing keys/plans (live-confirmed); Git publishing blocked by platform ("Git and GitHub commands are blocked; Vly manages version control.").
