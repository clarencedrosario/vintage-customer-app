# ADVOKATE_PROGRESS.md — Implementation Status, Evidence, and Next Steps

Durable progress file so development resumes without repeating completed work.
Companion to `ADVOKATE_REQUIREMENTS.md` (the master checklist). Handoff log also
maintained in `docs/DELIVERY.md`.

Last checkpoint: **27 September 2026**

---

## Implementation turn — 27 Sep 2026 (CJ GLOBAL support-ticketing slice shipped)

### Scope delivered (user request: owner console, customer tickets, AI-to-human escalation)

**Backend — `src/convex/platformOps.ts` + `platformOpsTables` in `schemaExtras.ts`:**
- New tables (additive push): `supportTickets` (optional orgId, submitter identity,
  kind general/billing/technical/account/ai_escalation, 4-level priority, status
  open→in_progress→resolved→closed, assignee + firstResponseAt + resolution fields,
  reopenCount, `escalatedFromAiJobId`, indexes by_status/by_submitter/by_org),
  `supportTicketMessages` (append-only thread, authorType customer/operator/system),
  `platformOpsAudit` (one row per operator action, by_time index).
- Access model: submit/reply = any authenticated non-anonymous user from any portal;
  triage/resolve/close = `users.isPlatformAdmin` only (same gate as the section-24
  console — deliberately NOT a chamber capability, consistent with section 24's
  "no default owner privilege over tenant data"); reads = submitter + operators only.
- Status machine enforced server-side (`canTransitionTicket`): open→in_progress→
  resolved→closed, reopen from resolved/closed; customer reply on resolved/closed
  auto-reopens with reopenCount increment; resolution requires a ≥10-char note;
  closed tickets refuse operator replies until reopened.
- `escalateFromAiJob`: AI-to-human handoff — access-checks the caller against the
  AI job's org (same rule ai.request enforces), creates a high-priority
  `ai_escalation` ticket carrying ONLY the job reference + the user's own
  description; the AI job's contents never enter the ticket.
- Operator analytics: `opsCounts` (open/in_progress/unassigned/open AI handoffs/
  >24h-without-first-response) and `opsAudit` feed; `operatorQueue` lists live
  (non-closed) tickets by last activity; `firstResponseAt` stamped on first
  operator reply (SLA signal).

**Frontend:**
- `/owner` route + `src/pages/OwnerConsole.tsx`: operator console with health
  counters, cross-chamber live queue (claim/reply/resolve/close/reopen/priority
  via select), ticket thread dialog (operator view + reply), resolve and reopen
  dialogs with mandatory text, operations audit table, honest cross-link to
  `/platform` and a note that tenant legal records are never shown here.
- `src/components/SupportCentre.tsx` (shared): "my tickets" list, raise-ticket
  dialog (kind/priority), thread dialog with customer reply + reopen-on-reply;
  embedded in BOTH `ClientPortal.tsx` and `StaffPortal.tsx` (id="support" anchor,
  compact mode) — plus `?tab=support` entries in `PORTAL_NAV` (client + staff).
- `ChamberShell.tsx`: top-bar Headset link to `/owner` for platform admins
  (alongside the existing Shield `/platform` link), rendered only when
  `amIPlatformAdmin` is true.
- `src/components/AiStudio.tsx`: "Escalate to human support" action on every
  done/failed/expired AI request (JobResult), with a subject+description dialog
  calling `platformOps.escalateFromAiJob`.

**Tests + verification (code-inspection + automated suite; NO browser E2E yet):**
- `src/convex/platformOps.test.ts` (11 tests): full transition matrix incl.
  reopen-only-to-open and closed-terminal; visibility rules — submitter yes,
  other customer no, platform operator yes, chamber owner WITHOUT the platform
  flag no (guards the section-24 boundary); constants integrity (4 statuses,
  5 kinds incl. ai_escalation, 4 priorities).
- Suite: **26 files, 422/422 passed** (411 prior + 11 new). `bunx convex dev
  --once` push OK (moonlit-elk-307 dev, functions ready); `bunx tsc -b --noEmit`
  clean after fixing one missing `DialogTrigger` import.
- Honest limits: no browser pass of submit→triage→resolve has happened; the
  operator flow needs a `users.isPlatformAdmin` grant via the section-24
  bootstrap (`PLATFORM_OWNER_EMAIL`) before anyone can actually triage; no
  notification is sent to operators when a ticket lands (polling via the
  console query only) — flagged as next-slice work.

### Next

- Operator enablement: run the platform bootstrap so the owner email actually
  holds `isPlatformAdmin`, then a manual browser pass of submit → triage →
  resolve → customer reopen.
- Optional hardening: appNotifications on ticket creation/first response;
  `/employee` platform onboarding surface; `/developer` route (rest of Section 25).

---

## Implementation turn — 27 Sep 2026 (five-question audit closed → HR module shipped)

### Q1 — deployment identity (RESOLVED, code-inspection evidence only)

The CLI target and the running preview are ONE project: **moonlit-elk-307**
(team `clarencedrosario`, project `vintage-customer-app`, dev deployment),
confirmed twice by the `bunx convex dev --once` banner
(`clarencedrosario:vintage-customer-app:dev/clarencedrosario (dev)` →
`https://moonlit-elk-307.convex.cloud`). Evidence that `cautious-kingfisher-954`
is a stale/erroneous report reference and NOT a second deployment:

- Repo grep for `cautious-kingfisher`: **0 matches**; `moonlit-elk-307`: matches
  in progress docs only (no hardcoded convex URLs anywhere in `src/`).
- Earliest checkpoint tar (`backups/source-checkpoint-2026-09-26.tar.gz`, 264
  files): 0 occurrences of cautious-kingfisher, 3 of moonlit-elk-307.
- DB export `backups/convex-data-2026-09-26` (ZIP: README + per-table
  `documents.jsonl`) has a table list that exactly matches THIS repo's schema
  (documents, statutorySettings, employees, payrollRuns, journalEntries,
  vaultVersions, hrTables, …) — same project.
- No migration/switch happened; nothing pointed at a second deployment.
- Env-file contents are **platform-blocked to tooling** (reads return
  [BLOCKED]; even terminal commands naming env files are hard-blocked), so Q1
  could not be answered from env files — CLI banner + grep + tar analysis were
  used instead.

### Q2 — billing→ledger posting gaps (FIXED + reconciliation tooling)

Audit findings: `updateDraft` is draft-only (posted invoices never edited —
safe); but `cancelOrCredit` and `refundProviderPayment` posted NO journal, and
both payment paths selected the "latest row by invoice" (insert/update race).
Fixes in `finance.ts`/`billing.ts`:

- `postInvoiceCreditJournalInternal` — cancels reverse the original invoice
  journal (dedupe key `billing:<id>:invoice_cancelled`, stamped via new
  `journalEntries.originalLineIds` array); credit notes post AR Dr / Bank Cr for
  collected-unrefunded via `credit_note_issued` (refunds summed from payment
  rows — invoices have no `refundedMinor` field, so nothing was invented).
- `postRefundJournalInternal` — key `billing:<payment>:refund:<amount>`;
  refunds now hit the ledger.
- Both payment paths insert-then-post **by returned id** — race closed.
- `billingPostingGaps` query (`finance.view`): unposted invoices/payments with
  honest reasons; cancelled-reversal rows flagged informational, not gaps.
- `reconcileBillingJournals` mutation (`finance.manage`): idempotent; refuses
  missing/incomplete chart; requires codes 1000/1100/4000
  (`BILLING_CRITICAL_CODES`; `parseBillingKey` helper).
- UI: Accounting page gap panel — coverage badge, "Reconcile now", amber
  banners (unseeded / missing codes), per-item reasons, explicit
  unsupported-workflow note (statement imports, bank feeds, vendor bills/AP,
  non-cancellation debit/credit notes).

### Q3 — custody trail drop + provenance clarity (FIXED)

Confirmed the 200-cap in-memory custody trail dropped oldest events
(`appendCustody` `slice(-200)`). Added append-only store `documentCustodyEvents`
(schemaExtras, by_document + by_org indexes, CUSTODY_ACTIONS vocabulary);
`addCustodyNote` and `recordVerification` now MIRROR every event into it; new
paginated `custodyHistory` query (page 5–100, access-checked). DocumentIntegrity
UI rewritten: hash-provenance explainer (client-declared vs server-verified
after Verify), complete history with "Load older events". `evidenceVerify`
re-audited — honest failure reasons (unauthorized / no_file / no_recorded_hash /
bad_recorded_hash / file_missing / crypto_unavailable), no fabrication.

### Q4 — HR module (prereqs confirmed, then implemented)

Pre-checks confirmed against `accessPolicy.ts`: `hr.view_own` on ALL 9 roles
(real set: owner, partner, senior_associate, associate, junior, paralegal,
accountant, administrator, support_staff — **no** hr_manager role exists);
accountant has `payroll.run` but **not** `payroll.approve`; support_staff
forbidden-set strips hr.manage / hr.approve / payroll.run / hr.view_salary /
finance.manage; `canViewSalaryRecord` lives in accessPolicy.ts (hr.ts imports
it from ./accessPolicy directly).

Implemented:

- **Pure math** `src/lib/hrLeave.ts` + **13 tests** — `daysBetweenInclusive`
  (UTC, same-day=1), `leaveApplicationError` (±0.5-day half-day tolerance),
  `balanceFor`, `decrementBalance` (never negative; explicit
  "Insufficient <type> balance" error; refuses unknown types), `unpaidDaysFor`
  (LOP split).
- **Server** `src/convex/hr.ts` — employees CRUD (`stripEmployee` removes
  salary/PAN/UAN/ESI/bank fields server-side unless `canViewSalaryRecord`;
  code regex, PAN regex, last-4-only bank, integer paise gross, unique codes),
  user linking, departments, leave profiles (org policy, not rates),
  apply/decide/mark-taken/cancel leave (approval freezes unpaidDays; taken
  leaves immutable; separated employees blocked), attendance upsert per
  employee-day, `validateStatutorySpec` (per-kind internal-consistency only —
  **no invented rates**; operators enter verified PF/ESI/PT/TDS/LWF/gratuity
  values), versioned statutory settings (closes prior row effectiveTo=prevDay),
  `payrollPrerequisites` query (per-kind configured/current-version as of
  today IST + employeeCount; `employeesWithoutStructures` placeholder filled by
  the payroll slice).
- **Auth tests** `src/convex/hr.access.test.ts` — 8 tests (role matrix +
  forged-override normalization).
- **UI** `src/pages/Hr.tsx` + `/hr` route (RequireAuth) + Practice nav entry
  "Human Resources": employee table with "restricted" salary display,
  AddEmployeeDialog, leave cards (Approve/Reject/Mark taken),
  payroll-prerequisites card with statutory badges.

### Q5 — CJ GLOBAL checklist (RECORDED honestly)

Section 25 added to ADVOKATE_REQUIREMENTS.md: owner administration, platform
employee onboarding, `/owner` `/employee` `/developer` routes, customer ticket
system, AI-to-human support — **all Not started** (no schema, no routes;
`invitations.ts` is in-chamber org invites only). Existing portal-facing routes
(`/portal`, `/staff`, `/login`, `/find-a-lawyer`) noted for contrast.

### Verification (actual results, 27 Sep)

- `bunx convex dev --once` → push OK (10:02 UTC, moonlit-elk-307 dev); Convex
  typecheck clean. Additive schema only (`journalEntries.originalLineIds`,
  `documentCustodyEvents`). No git push, no production deployment.
- `bunx tsc -b --noEmit` → **0 errors**.
- `bun run test` → **388/388 passed** (363 prior + 13 hrLeave + 8 hr.access + 5
  scaleProRataPaise, minus 1 folded accounting test).
- **Evidence honesty:** none of this turn's flows (HR forms, leave approvals,
  reconciliation button, custody paging, statutory editors) has been clicked
  through in a browser yet — verification is code inspection + automated suite
  only. A recorded E2E pass remains outstanding.

### Payroll slice (same turn, following the audit answers)

- **Pure math** `src/lib/payrollMath.ts` + **23 tests** — period bounds
  (leap-aware), zero-drift `prorateComponents` (first line absorbs floor
  deficit), employee-favourable `lopDeductionPaise` (floors the deduction),
  `structureForPeriod` with honest skip reasons (`no_salary_structure`,
  `not_joined_yet`, `left_before_period`, `empty_salary_structure`),
  `statutoryForEmployee` applying ONLY frozen spec rows (PF/ESI capped at the
  wage ceiling, PT highest applicable slab, LWF fixed amounts; absent kinds
  contribute nothing — no invented rates), `computeEmployeePayslip` (net clamped
  ≥ 0; fixed deductions do NOT scale with attendance), `runTotals`,
  `bankFileForRun`, and `payrollJournalPlan` with the exact identity
  Dr expense = net + mapped payables, refusing to post while any statutory
  payable is unmapped (`unmappedPaise`). TDD caught two real contract bugs:
  fixed deductions were being scaled up to gross, and the journal-plan test
  numbers were internally inconsistent.
- **Server** `src/convex/payroll.ts` — `saveSalaryStructure` (new
  effective-dated row each save, history never overwritten; component
  validation in whole paise), `listSalaryStructures`/`getRun`/
  `listRuns` with salary stripping via `canViewSalaryRecord` (structures and
  payslips zeroed to `salaryVisible: false`), `createRun` (per-(org, period)
  duplicate refused; freezes the exact `statutoryVersionIds`; refuses when any
  of the six statutory kinds is unconfigured; computes payslips from
  attendance LOP + approved unpaid leave; skipped employees carry reasons),
  state machine `submitForReview` → `approveRun` (payroll.approve) →
  `finalizeRun` (finance.manage; freezes payslips to `final`, posts the
  balanced dedupe-keyed journal `payroll:<run>:finalized`, refuses on missing
  seeded accounts or unmapped payables), `generateBankFile` (needs
  hr.view_salary; separate from payment marking by design),
  `markPaymentsMade` (requires finalized + bank file exists),
  `reverseRunByOperator`/`reverseRunInternal` (audited mirrored reversal,
  ≥3-char reason, payslip rows preserved as history).
- **Prerequisites filled** — `payrollPrerequisites.employeesWithoutStructures`
  now counts payroll-relevant employees with no structure row (previously a
  null placeholder).
- **UI** `src/components/PayrollPanel.tsx` wired into `/hr` — run list with
  status/badges, create-run by period, all transition actions, payslip table
  with per-row "restricted" salary display, bank-file download,
  payment-marking, reversal flow with mandatory reason, salary-structure
  editor dialog, and a statutory-settings dialog (per-kind fields; rates
  entered as % → integer bps, amounts as ₹ → exact paise; no defaults).

### Verification (actual results, 27 Sep, payroll)

- `bunx convex dev --once` → push OK (10:54 UTC, moonlit-elk-307 dev). Additive
  schema only — the payroll slice uses the existing Phase-1 tables; no schema
  change this slice.
- `bunx tsc -b --noEmit` → **0 errors** (after fixing a TS7022 circular
  inference between the reversal mutation and its internal core by annotating
  return types).
- `bun run test` → **25 files, 411/411 passed** (388 + 23 payrollMath).
- **Evidence honesty:** the payroll flow (create → approve → finalize → bank
  file → mark paid → reverse) has NOT been clicked through in a browser yet;
  verification is code inspection + the automated suite only.

### Next

CJ GLOBAL platform-operations slice (Section 25): owner console, employee
onboarding surface, customer tickets, AI-to-human escalation. Payroll
enhancements that remain: per-period structure selection edge cases beyond the
LOP mechanism (explicit join/leave proration input), TDS per-slab application,
payslip PDF export.

---

## Checkpoint & backup record (created 26 Sep 2026)

| Artifact | Location | Verification |
|---|---|---|
| Source checkpoint (all project files; excludes node_modules/dist) | `backups/source-checkpoint-2026-09-26.tar.gz` | 264 entries, 778,003 bytes, sha256 `e70b875dba5a1adb9409519bd56a3d74e1c1a65146e546bbe2cebd5833fb28fa` |
| Database snapshot export (all tables incl. auth) | `backups/convex-data-2026-09-26` (ZIP of per-table JSONL) | `convex export` succeeded (snapshot 1790448296711452528); ZIP integrity tested, no corrupt entries; also retained on Convex dashboard |

Notes:
- Git commands are platform-managed (blocked to the agent) — Vly manages version
  control. The tar checkpoint is therefore the recoverable source snapshot; it is
  additive-safe (schema pushes in this project are additive; no destructive
  migrations have been run this session).
- `backups/` must be excluded from future checkpoints to avoid recursion.
- Restore procedure (untested-by-operator): untar source checkpoint over a fresh
  project; restore data via Convex dashboard snapshot import. This remains a
  launch-checklist item — **not** claimed as a verified restore.

## Implementation turn — 26 Sep 2026, 20:35 UTC (turn 4, continued)

### Completed: document integrity hashes + chain of custody (workflow-5 audit gap, §6)

- **Pure logic** `src/lib/evidenceIntegrity.ts` + 15 tests — SHA-256 via
  WebCrypto (browser at upload, Node at verification), hash-format
  validation, custody-action vocabulary, human-readable event descriptions,
  capped append (200 events, oldest drop; org audit log stays complete).
- **Schema** (additive, optional): `matterDocuments.integritySha256`,
  `matterDocuments.custody[]`. Reused the EXISTING `documentRequests`
  per-version `checksum` metadata rather than inventing a parallel field.
- **Writers wired** (every document-creation path): `matters.attachDocument`
  (hash + "filed" custody), `portals.clientUploadDocument` (checksum +
  "submitted_by_client"), `documentRequests.clientSubmit` (checksum on the
  submission row) and its accept flow (hash carried to the matter row +
  "accepted_from_request"), `imports.ts` ("imported"),
  `documents.issueSecureDownloadLink` ("downloaded" — no token material).
- **Server-side verification** `evidenceVerify.verifyDocumentIntegrity`
  ("use node" action — crypto.subtle guaranteed) + internal bridges in
  `evidence.ts` (V8: Convex allows only actions in Node modules). Re-hashes
  stored bytes, compares to the recorded hash, appends
  integrity_verified/integrity_mismatch custody + audit row. Honest failure
  reasons: no_file / no_recorded_hash / bad_recorded_hash / file_missing /
  crypto_unavailable / unauthorized — nothing fabricated. Authorization
  re-checked inside the bridge (capability + matter + document level).
- **UI** `src/components/DocumentIntegrity.tsx` — chip on each MatterDetail
  document row: short hash (or honest "no hash"), Verify button, custody-trail
  dialog with manual note entry (capability-gated server-side).
- Constraint honestly noted: the hash is computed by the uploader's browser
  over the exact bytes uploaded; server verification re-hashes independently,
  so tampering AFTER upload is detectable. What this is NOT: custody of paper
  originals, or proof the browser hash was taken before any pre-upload
  modification.

### Verification (actual results)

- `bun run test` → **21 files, 344/344 passed** (329 + 15 new).
- `bunx tsc -b --noEmit` → **0 errors**.
- `bunx convex dev --once` → **push OK 20:07, 20:21, 20:29 UTC (dev deployment,
  moonlit-elk-307)** — iterative pushes during the Node/V8 module split; final
  state pushed. Additive schema only. No git push, no production deployment.
- En-route fixes: webcrypto type mismatch in schema validator (replaced inline
  literal array with the imported CUSTODY_ACTIONS tuple), Node/V8 runtime
  split for action-vs-query/mutation, useAction vs useMutation for actions.

## Implementation turn — 26 Sep 2026, 20:56 UTC (turn 4, continued)

### Completed: accounting foundation integrated with billing (master sequence: accounting before HR)

- **Pure math** `src/lib/accounting.ts` + 19 tests — balance validation
  (whole paise, both sides, no zero/float lines), normal balances & signed
  movement, per-account aggregation, two-column trial balance (asserts
  debits===credits; omits zero-balance accounts; still balances when an
  account ends in an unusual position), P&L, inclusive fiscal-year bounds,
  deterministic dedupe keys (`source:sourceId:slot`). One real bug caught by
  TDD: the first TB draft leaked raw credits onto credit-normal rows and
  failed to balance — rewritten to net-balance presentation.
- **Server** `src/convex/finance.ts`:
  - `seedChartOfAccounts` — 23-account standard Indian law-practice chart
    (bank/cash, client-fund pair 1020/2100 flagged `clientFund`, AR, retainers,
    GST payables CGST/SGST/IGST + TDS, capital/retained earnings, fees,
    recoveries, opex). Idempotent: refuses when a chart exists. NO tax rates
    configured — tax amounts arrive already computed from billing.
  - `addAccount`/`listAccounts` (3–6 digit unique codes, client-fund flag).
  - `postJournal` — `finance.manage` capability; server-side balance
    validation (exact error strings from the pure lib); optional dedupeKey
    idempotency (retry returns the original entry, `posted:false`); posting
    into a CLOSED fiscal year is rejected; all accounts must belong to the org.
  - `reverseJournal` — audited: creates a balanced opposite entry with
    `reversalOfId`, marks the original `reversed`; never edits/deletes.
  - `ledgerForAccount` (running balance), `trialBalanceReport` (with a
    `reconciles` flag computed server-side), `profitAndLossReport` (optional
    fiscal-year filter), `listJournals`.
  - `postInvoiceJournalInternal` / `postPaymentJournalInternal` — billing →
    ledger: AR Dr / fees+recoveries+GST Cr on send; Bank Dr / AR Cr on payment
    (manual AND Razorpay webhook paths). Deterministic dedupe keys per
    invoice/payment row make retries idempotent. If the chart is not seeded
    the hook reports `chart_not_seeded` and skips — nothing is fabricated.
- **Billing integration** (`src/convex/billing.ts`): `send` posts the invoice
  journal; `recordPayment` and the webhook capture path post payment journals.
- **UI** `src/pages/Accounting.tsx` (`/accounting`, Practice nav group,
  capability-gated server-side by `finance.view`/`finance.manage`): seed CTA,
  journal dialog with live balance badge, add-account dialog (client-fund
  checkbox), trial balance with reconciliation banner, journals list with
  audited reversal flow.
- **Deliberately deferred in this slice** (next accounting steps): balance
  sheet & cash-flow, statement import/reconciliation, vendor bills/AP,
  fixed-asset depreciation, budgets/cost centres, opening-balance equity entry
  helper, credit/debit notes posting to ledger.

### Verification (actual results)

- `bun run test` → **22 files, 363/363 passed** (344 + 19 accounting).
- `bunx tsc -b --noEmit` → **0 errors** (after fixing a `tb possibly null` UI
  narrowing error and a payments-index misuse caught by the push gate).
- `bunx convex dev --once` → **push OK 20:42, 20:46, 20:48, 20:54 UTC (dev
  deployment moonlit-elk-307)** — iterative pushes; final state live. Additive
  schema only (no schema change in this slice; finance uses Phase-1 tables).

### What to test in the preview

1. Sign in as owner/partner/accountant → **Practice → Accounting**.
2. Seed the standard chart (idempotent — second click reports it exists).
3. Post a journal: unbalanced drafts show "Does not balance" and cannot post;
   balanced ones post and appear under Journals.
4. Send an invoice from Billing (chart must be seeded) → trial balance shows
   AR Dr / Professional Fees + GST Cr; journal source = `billing`.
5. Record a payment → Bank Dr / AR Cr journal appears automatically.
6. Reverse a posted journal with a reason → opposite entry + original marked
   `reversed`; trial balance nets back to zero for that pair.
7. Add a fiscal year row (via future UI/import) and close it → posting into
   its range is refused.
8. Accountant role sees Accounting; support staff/juniors do not (capability
   gate is server-side).

### Next

Payroll build-out on the Phase-1 schema (statutory settings CRUD with the
anti-invented-rates guard, salary structures, run preview → approve → finalize
posting balanced payroll journals, payslips), then HR module UI, then the
remaining accounting reports.

---

## Implementation turn — 26 Sep 2026, 19:45 UTC (turn 4)

Authorized to proceed continuously. Checkpoint before edits:
`backups/source-checkpoint-2026-09-26b.tar.gz` (266 files, sha256
`2d958d4994362544aae633590eb67019fdd19e8bfa5c5462fc2e9e1e069c0926`).

### Completed: hearing rescheduling + clash warnings (workflow-4 audit gap)

- **Pure logic** `src/lib/hearingSchedule.ts` — IST day model (day/bounds),
  clash detection (same IST day + time overlap ≤30 min buffer AND shared
  resource: courtroom or effective advocate; sparse-data "adjacent" warning
  only when neither side names a resource), reschedule validation (held/
  cancelled immovable, no-op rejected, 24 h past-grace), audit-record builder
  (generic over branded ids), reminder-cadence carry-forward.
- **Tests** `src/lib/hearingSchedule.test.ts` — 27 tests, all passing. One
  contract bug found and fixed during TDD: the first draft flagged every
  time-overlap as "adjacent"; corrected so warnings require a shared resource
  (or fully sparse data).
- **Schema** (additive, optional field): `hearings.reschedules` — append-only
  audit array {at, byId, byName, reason, oldAt, newAt}. No migration risk;
  legacy rows read fine.
- **Server** `src/convex/matters.ts`:
  - `checkHearingClash` query — clash preview across the caller's *visible*
    matters on the candidate's IST day (permission-filtered; cancelled
    excluded; self-exclusion for reschedules).
  - `rescheduleHearing` mutation — `hearing.manage` capability + `requireMatter`
    + `requireEditableHearing`; server re-validates the pure rules; mandatory
    ≥3-char reason; appends the audit record (old time preserved, never
    overwritten); reminders carry forward (re-anchor to the new time);
    chronology event + org audit log; `refreshNextHearing` maintained.
  - Status note: an adjourned hearing that is moved becomes `scheduled` again
    (its adjournment is captured in the reason + audit trail).
- **UI** — new `src/components/HearingRescheduleDialog.tsx` (mandatory reason,
  optional courtroom/advocate update, live clash warnings from the same query,
  warnings are non-blocking and say so); `Reschedule` action added to hearing
  rows in `src/pages/MatterDetail.tsx` (wired with matter lead as fallback
  diary).

### Verification (actual results, this turn)

- `bun run test` → **20 files, 329/329 passed** (302 prior + 27 new).
- `bunx tsc -b --noEmit` → **0 errors**.
- `bunx convex dev --once` → **push OK 19:41 UTC to the development deployment**
  (`moonlit-elk-307`, dev). Additive schema change only. No git push, no
  production deployment.
- Mid-turn issues found and fixed en route: one contract bug in clash detection
  (TDD), one branded-id type mismatch (resolved by making the audit builder
  generic), and one transient edit-tool anomaly that briefly corrupted the
  `audit()` helper in matters.ts (repaired; final typecheck + tests green).

### What to test in the preview

1. Open a matter → Hearings → a scheduled hearing now shows **Reschedule**.
2. Reschedule with a short reason → rejected; ≥3 chars → moved, chronology
   event appears, hearing shows the new time.
3. Set the new time to overlap another hearing of the same advocate (same IST
   day, within 30 min) → amber clash warning listing the conflicting matter,
   hearing, and reason; rescheduling is still allowed.
4. Re-check the Calendar/Court Day views — the hearing appears on its new day;
   reminders fire relative to the new time.
5. Audit log (Settings → audit view) records "Hearing rescheduled" with actor.

### In progress next

Document integrity hashes + chain-of-custody events (§6 audit gap), continuing
the master sequence.

---

## Read-only audit — 26 Sep 2026, 19:07 UTC (turn 3)

Scope: the six Phase-2 legal workflows + deployment-fact reconciliation.
No application code or backend was changed in this run (read-only turn).

### Deployment facts (corrected record)

- **This run executed:** `bunx tsc -b --noEmit` (exit 0) and `bun run test`
  (302/302) at 19:07 UTC. **`bunx convex dev --once` was NOT executed in this
  run** — the 26 Sep 10:47/10:55 IST pushes were cited from the earlier session.
- **Dev deployment (`moonlit-elk-307`, "vintage-customer-app (dev)"):** last
  pushed in the previous session when Phase-1 schema landed (added the 19-table
  `hrTables` group; no new functions). No Convex deployment of any kind in the
  audit run.
- **Git:** none — platform-managed; never committed/pushed/merged by the agent.
- **Production:** no deployment initiated by the agent; platform/operator action.

### Fresh verification (run NOW in this turn, 19:07 UTC)

- `bunx tsc -b --noEmit` → **exit 0**
- `bun run test` → **19 files, 302/302 passed**

### Historical results (prior session, 26 Sep morning)

- `bunx convex dev --once` → push OK 10:47 & 10:55 IST (schema + codegen).

### Workflow-by-workflow audit findings

Evidence basis: server-code inspection of `src/convex/*` (handlers re-derive
access per request; capability gates confirmed) + pure-logic unit tests. Per the
verification vocabulary, none of this constitutes an E2E browser walkthrough.

**1. Client intake & onboarding — Implemented and verified (code + unit tests; no E2E pass)**
- Files: `src/convex/intake.ts` (1,276 lines), `src/lib/intakeFlow.test.ts`, `src/pages/Intake.tsx`.
- Evidence: intake→conflict gate→client/matter conversion chain read in code
  (`conflictCheckId` gate at conversion); `intakeFlow` unit tests green.
- Gaps: no E2E walkthrough recorded; consultation booking exists
  (`consultRequests.ts`) but no automated test covers booking→conversion.

**2. Conflict checks & reviewed decisions — Implemented and verified (code + unit tests; no E2E pass)**
- Files: `src/convex/conflicts.ts` (621 lines), `src/lib/conflictFlow.test.ts`, `src/pages/Conflicts.tsx`.
- Evidence: `classify`/`override`/`reject` mutations with `conflict.override`
  capability gate (support-staff excluded), 10-char minimum override reason,
  audit insert + `logUserAction`; `canProceedToMatter` blocks matter creation
  on unoverridden confirmed conflicts; explicit no-guarantee framing.
- Gaps: no E2E walkthrough; match-quality against realistic data untested.

**3. Matters: creation/update/closure/access — Implemented and verified (code + denial tests; no E2E pass)**
- Files: `src/convex/matters.ts` (1,748 lines), `src/convex/accessPolicy*.ts`, `src/convex/accessPolicy.test.ts` (2-tenant denial fixture), `src/pages/Matters.tsx` + `MatterDetail.tsx`.
- Evidence: every list/get re-filters via `canViewMatter`; team-restrict only by
  authorized roles; `closeMatter`/`reopenMatter` lifecycle present.
- Gaps: no E2E walkthrough; closure cascade effects on billing not re-verified.

**4. Hearings, deadlines, reminders — Implemented and verified (code + unit tests; no E2E pass), with 2 gaps**
- Files: `src/convex/matters.ts` (hearings), `src/convex/deadlineRules.ts`, `src/convex/schemaExtras.ts` (versioned rules), `src/convex/crons.ts` + `reminders.ts`, `src/convex/calendar.ts`, `src/pages/Calendar.tsx`, `CourtDay.tsx`, `DeadlineRules.tsx`.
- Evidence: versioned deadline rules with frozen specs + calculation breakdowns;
  lawyer-approval gate on rule-generated deadline drafts; reminder cron every
  5 min (hearings 24h, deadlines due/reminder-day); IST day model shared by
  calendar and briefing code.
- **Gaps (newly found):** (a) no audited reschedule action — hearings are
  editable until outcome recorded, but no dedicated reschedule-with-reason flow;
  (b) no calendar-clash warning when scheduling (`addHearing` has double-click
  dedupe only).

**5. Documents, sharing, revocation — Implemented and verified (code; no E2E pass), with 3 gaps**
- Files: `src/convex/documents.ts`, `src/lib/documentManager.ts` + test, `src/convex/schemaExtras.ts` (vault), `src/pages/Documents.tsx`.
- Evidence: dual-layer tenant middleware + per-request `canViewMatter`/
  `canViewDocument`; share links token-verified (unit-tested in
  `documentManager.test.ts`); vault versioning preserves originals; permission-
  aware library query.
- **Gaps (newly found):** (a) no evidence integrity hashes / chain-of-custody
  events on `matterDocuments`; (b) no document-level legal holds/retention
  (backup `retentionNote` is unrelated); (c) no E2E walkthrough.

**6. Client portal & explicit visibility — Implemented and verified (code; no E2E pass)**
- Files: `src/convex/portals.ts` (clientPortal/clientUploadDocument/
  clientMessage/completeTask), `src/convex/commOutbox.ts` (approval outbox), `src/pages/ClientPortal.tsx`.
- Evidence: portal queries resolve server-side from memberships; client uploads
  land as `submittedByClient` rows via generated upload URLs; outbox approval
  flow unit-tested (`commOutboxFlow.test.ts`); notifications link to records.
- Gaps: no E2E walkthrough; invoice payment inside portal needs merchant config
  (blocked externally).

### Audit conclusion & proposed next task (awaiting approval)

All six workflows are implemented with server-side enforcement and unit-test
evidence, but **none has a recorded end-to-end walkthrough**. Two audit gaps are
user-visible defects in a live practice: hearing rescheduling and calendar-clash
warnings. The proposed bounded task addresses the higher-impact one:

**Proposed bounded task — hearing rescheduling with audited trail + clash
warnings (workflow 4):**
1. Pure logic in `src/lib/hearingSchedule.ts`: `describeClashes()` (detect
   same-advocate/lead-lawyer hearings within a configurable buffer on the target
   IST day) + `rescheduleTransition()` (validate current status allows
   reschedule, carry forward reminder cadence, record {oldAt,newAt,reason,by}
   for the audit trail). Unit-tested first.
2. Server: `rescheduleHearing` mutation in `src/convex/matters.ts` (capability
   `hearing.manage` + requireMatter + audited via `logUserAction`; clamps
   `matters.nextHearingAt`); optional `clashes` return from a new
   `checkHearingClash` query consumed by the scheduling dialogs.
3. UI: Reschedule action on MatterDetail hearing rows + clash warnings in the
   add/reschedule dialogs (Calendar/CourtDay share the same query).
4. Verify: unit tests + `bunx convex dev --once` + `tsc -b --noEmit` + full
   suite; checkpoint tar before editing.

Alternatives considered: E2E browser evidence collection (needs operator or
browser tooling — not available this run); document integrity hashes (valuable
but less urgent than scheduling integrity in daily practice). Awaiting approval.

## Regression baseline (recorded before any Phase-1a edit)

- `bunx tsc -b --noEmit` → **exit 0, no errors**
- `bun run test` (vitest) → **19 files passed, 302/302 tests passed**
- `bunx convex dev --once` (26 Sep, prior session) → **push succeeded** ("Convex functions ready")

These numbers are the baseline. Any later run that differs indicates a regression
introduced by new work, distinguishable from pre-existing state.

## Audit snapshot (bounded — Phase 1a scope)

Verified working in code (server-side enforcement, not just UI):

- Four portals: `/login` unified entry; role/portal resolved server-side by
  `orgs.resolve` (memberships first, legacy roles fallback). Landing page lists
  Lawyer/Firm/Staff/Client access paths; `Find a Lawyer` is public.
- `RequireAuth` route guard: unauthenticated → `/login?returnTo=…` (open-redirect
  safe: only same-origin paths starting with a single `/`); 2FA challenge enforced
  on console routes; portal routes (`/portal` client, `/staff` staff) authorize
  server-side; wrong-portal accounts redirected to their own home.
- Logout → portal selector: `ChamberShell.handleSignOut` navigates to
  `/login?reason=signedout` after `signOut()`.
- Permissions: 9 OrgRoles, per-org editable matrix, 47 capabilities incl. the
  11 HR/payroll/finance/pm keys added 26 Sep; support-staff escalation guard in
  `normalizePermissions`; salary-record ceiling in `canViewSalaryRecord`
  (all pure + unit-tested: 302 tests incl. 2-tenant denial fixture).
- No build or authentication blockers found: tsc clean, full suite green,
  Convex push succeeds. **No fixes were required for Phase 1a** — the "identify
  and fix blockers" task concluded with zero blockers found (nothing was broken).

Feature inventory: see `ADVOKATE_REQUIREMENTS.md` (complete per-section statuses)
and `docs/DELIVERY.md` (module-by-module history).

## What changed this run

1. Created and verified both checkpoint artifacts (table above).
2. Recorded regression baseline (tsc/tests/convex push results).
3. Bounded audit of portal lifecycle + auth (results above; no blockers).
4. Created `ADVOKATE_REQUIREMENTS.md` and `ADVOKATE_PROGRESS.md` (durable files).
5. No application code was modified this run — zero regression risk.

## What can be tested in the preview (unchanged app)

1. Open `/` → four access paths visible (Lawyer / Law Firm / Support Staff /
   Client) + public Find a Lawyer.
2. Sign out from any console page → lands on `/login` (portal selector).
3. While signed out, visit `/dashboard` → redirected to `/login?returnTo=%2Fdashboard`;
   after signing in you return to `/dashboard`.
4. Client account visiting `/staff` (or vice versa) → redirected to its own portal.
5. Settings → permission matrix shows the new HR/Payroll/Finance/PM labels
   (26 Sep); support-staff rows cannot be granted those capabilities.

## Tests executed (actual results, 26 Sep)

- `bunx tsc -b --noEmit` → 0 errors.
- `bun run test` → 302/302 passed (19 files) — includes 285 pre-existing tests,
  17 access-policy program tests added 26 Sep (salary ceiling, org isolation,
  support-staff escalation stripping, normalization).
- `bunx convex dev --once` → push OK (schema incl. 19-table `hrTables` group).

## Remaining blockers / external dependencies

- Email delivery (verification codes, notifications): needs provider keys —
  **Blocked by external setup**.
- AI live verification: needs OPENAI_API_KEY — **Blocked by external setup**.
- Payments (Razorpay) and subscription checkout: need merchant config —
  **Blocked by external setup**.
- Malware scanning, OCR, e-signature provider, mail infrastructure (domain/DNS),
  conferencing TURN/SFU hosting: not configured — **Blocked by external setup**
  when their phases begin.
- Restore drill against a staging environment: operator action on the launch
  checklist — **Not started**.

## Next bounded development task (awaiting instruction)

**Phase 2 — HR module, first bounded slice:**

`src/convex/hr.ts` with requireAccess/can() gates + audit logging:
1. Employees CRUD (create/update/offboard lifecycle), salary fields stripped
   from list reads unless `hr.view_salary` or self, enforced server-side.
2. Departments + leave profile setup queries/mutations.
3. Leave application workflow: apply → approve/reject (`hr.approve`) → taken
   (balance decrement), employee self-service reads.
4. `src/pages/HR.tsx` route `/hr` (RequireAuth + ChamberShell nav entry,
   capability-gated UI) + staff-portal self-service surface.
5. Unit tests for the salary-strip logic and leave-balance math; then
   `bunx convex dev --once && bunx tsc -b --noEmit && bun run test`.

Checkpoint before starting: create `backups/source-checkpoint-<date>.tar.gz`
(excluding `backups/`) and record results in this file.
