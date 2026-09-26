# ADVOKATE_PROGRESS.md — Implementation Status, Evidence, and Next Steps

Durable progress file so development resumes without repeating completed work.
Companion to `ADVOKATE_REQUIREMENTS.md` (the master checklist). Handoff log also
maintained in `docs/DELIVERY.md`.

Last checkpoint: **26 September 2026**

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
