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
| DPDP Rules 2025 connector | ✓ LIVE retrieval + dedupe | cron tick evidence on next sweep; Hindi counterpart ✗ — official candidate identified 7 Oct (MeitY Hindi PDF, ~398.71 KB, pub. 16.12.2025) but exact URL unresolved (JS shell + bot protection); see `docs/OFFICIAL_SOURCES.md` §1.2 |
| India Code deep URLs | ✗ STILL BLOCKED after 7 Oct retry probe (fresh evidence: `.nic.in` deep URLs connect-timeout; `.gov.in` serves an HTML app shell, not document bytes; HEAD 405) | retry when the publisher exposes stable document URLs — DSpace `/items/` migration suggests a REST content API; future probe targets that |
| SCI APIs | ✗ authorization-gated | needs credentials (owner decision) |
| Scheduled-ingestion evidence file | ✓ `docs/OFFICIAL_SOURCES.md` | keep appending per-sweep evidence |
| Discovery of NEW official publications | ✓ FIRST COMPLETED 8 Oct: **Juvenile Justice Act 2015** (`in:statute:jj-2015`) — new publication (not in the turn-6/7 corpus), located on CARA (MoWCD statutory body), verified BEFORE registration with the project's own extractor (112/112 sections, English layer; a composite NCPCR gazette issue was rejected for anchor misalignment), then retrieved LIVE via the connector on moonlit-elk-307 (v2, 155,439 chars, dedupe proven `unchanged` on repeat); see `docs/OFFICIAL_SOURCES.md` §1.5 | keep going: further discoveries (India Code deep-URL retry via DSpace REST, SCI authorization, eGazette expansion, JJ Rules 2016) remain open |

## C. Data protection & continuity

| Item | Status | Next action |
|---|---|---|
| Backup/export & exit (§32.12) | ✓ code+tests; **IN-MEMORY restoration tests passed 3/3 (turn 29)**; **real export-and-restore verification PENDING** (CORRECTED 7 Oct: the in-memory runs are not deployment evidence) | next actual step: run `restoreVerification.runRestoreDrill` ONCE on the real deployment — it exports a REAL archive (`backups.archiveExport`, counts verified), restores into a transient `restore-sandbox-*` org, verifies counts independently, purges, records `restore_test` (isolated; cannot touch working orgs; purge refuses non-sandboxes). Scope note: `archiveExport` is DATABASE RECORDS ONLY by design (its own manifest note states it); document FILE bytes live in object storage and are covered by PLATFORM backups (database snapshots + storage schedule, `docs/BACKUPS.md`) — a file-inclusive restore would need a separately-authorized platform-snapshot restore into a non-production target, owner action |
| Redaction (§32.6), walls/holds (§32.7), multilingual (§32.9), client updates (§32.10) | ✓ code+tests; ✗ browser | browser walkthrough groups in `docs/S32_BROWSER_SCRIPT.md` still NOT EXECUTED |

## D. Operations

| Item | Status | Next action |
|---|---|---|
| Monitoring & health | ◐ `/health` surface + AI dashboards (honest unconfigured states) | define alert thresholds + who gets paged; connect uptime probe to `/health` |
| Customer support | ◐ support tickets + operator queue (§32.11 era) + enterprise-lead triage | owner: decide support channel/SLA and publish contact |
| Commercial documents review | ✗ | owner/legal: review pricing copy, renewal terms, refund policy, tax configuration before live activation |
| Production deploy | ✗✗ restricted | owner-only, after A/B above |
| GitHub source sync (authorized, not production deploy) | ⏸ BLOCKED in agent env | platform restriction: every Git/GitHub terminal command returns exactly "Git and GitHub commands are blocked; Vly manages version control." — no SHA/URL obtainable; deliverable staging is done (docs, .gitignore exclusion fix, lockfile; checkpoint `/home/daytona/advokate-checkpoint-20261007.tar.gz`) |
| Freebuff/Vly sync control verification | ⏸ open | engineering/owner: Vly wires project events to the GitHub repo; `integrations.md` documents API/email/payments HTTP integrations only, and NO `Publish`-style or version-control UI control is documented in-repo — owner must identify the version-control control in the Vly dashboard and confirm whether it deploys the website BEFORE using it (this REQUIRES the owner's dashboard view; the agent cannot) |

## Blocker classification (corrected turn 29)

| Blocker | Class |
|---|---|
| Razorpay test keys, webhook secret (`RAZORPAY_WEBHOOK_SECRET`), `SECRET_ENCRYPTION_KEY`, `PLATFORM_OWNER_EMAIL`, admin bootstrap, plan prices | Owner configuration |
| `/platform` plan-creation steps after `PLATFORM_OWNER_EMAIL` is set | Owner configuration (data entry; the code surface exists) |
| Webhook URL correction (`.convex.site` not `.cloud`) | FIXED 7 Oct in `docs/OWNER_SETUP_CHECKLIST.md`; verified live handler response |
| Browser E2E: Chromium browser download failure in a Daytona-type terminal env | Platform restriction (terminal runtime); runner + specs + credential procedure are READY — rerun `npx playwright install chromium` in a standard dev machine/CI (not a hardened sandbox) |
| Browser E2E: OTP receipt for synthetic identity emails `@e2e-advokate.test` | Owner configuration (point the dev deployment's OTP sender at a catch-all inbox the runner can read) |
| Real deployment restore drill | Engineering-side execution + owner authorization (already given turn 29 — owner runs the button OR authorizes the agent to trigger it once keys/role are in place) |
| India Code deep-URL timeout | External source access |
| SCI APIs | External source access (authorization-gated; needs credentials per owner decision) |
| DPDP Rules Hindi counterpart | Engineering work (new planned ingestion on an existing wiring) |
| GitHub sync mechanism + UI identification | Platform restriction + owner dashboard access |

## Open verification questions (owner dashboard / platform internals — agent cannot inspect)

- **Keys-UI → deployment provisioning verification device**: a read-only check that reveals ONLY make-or-absent state, never values or even variable names: `entitlements:publicPlanCatalog` → `purchasingAvailable` (proves `RAZORPAY_KEY_ID/SECRET` presence only); `ai:runnerStatus` → `configured` (proves `OPENAI_API_KEY` presence); the platform webhook endpoint's own body response: 503 "Webhook secret not configured." ↔ 400 "Invalid signature." on garbage-triggered deliveries within its 4 events proves `RAZORPAY_WEBHOOK_SECRET` present-or-absent; `platform bootstrapAdmin` outcome after your sign-in (success with existing verified `PLATFORM_OWNER_EMAIL`; the run itself is the presence check for that variable). Single-shot decryption probes are REFUSED by design — do not use them as presence checks |
- **`PLATFORM_OWNER_EMAIL` current deployment state: INABILITY TO INSPECT, not confirmed absence** — no read-path from the agent (the platform blocks ALL `.env*` access) and `entitlements:publicPlanCatalog` proves nothing about this variable. Earlier turn-27-era reporting asserting it was "configured on moonlit-elk-307" is DOWNGRADED here to UNVERIFIED — it cannot be verified from this environment; confirm from your Keys UI or run `platform:bootstrapAdmin` granting admin to the verified exact-email login (existing secure flow: verified-email match is the whole grant; MFA at sign-in per your account setup is unaffected — normal account MFA, not the internal special-purpose MFA) |
- **How the Vly integration browses**: owner must check the Vly dashboard's project panel for the GitHub connection state and whether a version-control sync action exists and what it pushes (source commit vs website publish); the agent found no documented trigger and DOES NOT INVENT one. New Vly control/action UUIDs observed in the owner's dashboard should be pasted to the agent for the turn-29 next-turn continuation record |
| Live charges | ✗✗ restricted | only after owner-approved live keys + explicit approval |

## Standing restrictions (unchanged)

No production deployment, no paid-service activation, no real charges, no
destructive operations, no Git publishing — none performed. Automated suite
remains the regression backbone: **52 files / 674 tests green** (turn-28) —
it does NOT substitute for the browser/live rows above. Turn-29 execution record: restore drill 3/3 EXECUTED (isolated instance); browser E2E blocked (browser-download failure + no reachable app URL — recorded, not bypassed); payment test-mode blocked on missing keys/plans (live-confirmed); Git publishing blocked by platform ("Git and GitHub commands are blocked; Vly manages version control.").
