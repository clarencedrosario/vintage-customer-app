# Acceptance report (section 30)

Date: 25 September 2026 (updated after Feature 4 — Client Intake & Matter
Opening; Features 1–3 verified earlier). This report states what was actually
exercised and what was not. HTTP 200s and mocked tests are not treated as
live proof.

## Automated verification performed

| Check | Result |
| --- | --- |
| TypeScript (solution build, `tsc -b --noEmit`) | **0 errors** (app, node, tests projects) |
| Unit & component tests (`bun run test`, vitest) | **202 passed / 0 failed** (14 files) |
| Production build (`bun run build`) | **Passes** — clean bundle, ~16s |
| Convex functions push (`bun convex dev --once`) | **Success** — includes `commandCentre.matterOverview` |
| Dependency audit (`bun audit`) | **0 vulnerabilities** (as of the last full check) |

## Feature 1 — Case Command Centre (implemented this run)

**Built:** `src/convex/commandCentre.ts` (`matterOverview` aggregate query),
`src/lib/commandCentre.ts` (pure urgency/gating/empty-state helpers),
`src/components/CommandCentre.tsx` (tab UI) and the **default** "Command
Centre" tab on the matter file (`/matters/:id?tab=command`, deep-linkable).

- Derives everything from existing tables — no duplicate tables, no schema
  change, no migration required.
- Tenant + matter access enforced server-side: `getAccessContext` gate, then
  the shared `canViewMatter` rule; cross-tenant and out-of-team callers get
  `null` (identical to a missing matter — no existence leak).
- Single aggregate subscription; one indexed `by_matter` read per table, batched
  user-name resolution through a shared cache — no N+1. The payments section
  reads `payments` per invoice (indexed, capped at 12 invoices) only for
  `billing.payment` holders.
- Sections gated server-side by capability: invoices (`billing.invoice`),
  payments (`billing.payment`), internal-event chronology
  (`document.view_internal`), audit (`matter.edit` / owner-partner-admin, the
  same rule as `matters.listAudit`). A role without the capability never
  receives the data — hiding is not the security boundary.
- Urgency tiers: red for overdue, sepia `#8a6a33` for ≤48h, ordinary
  otherwise; invoices are overdue only after the **IST end** of their due date.
- Every row links to its authorized record (docket, tasks desk, document room,
  requests, orders, invoices, audit). Empty states for every section.
- Undertakings: no dedicated undertakings table exists in the schema, so the
  section derives from **open `court_order`-category deadlines** plus
  **outstanding order directions** — a deliberate mapping, not a new table.

**Tests added:** `src/lib/commandCentre.test.ts` (30 tests) covering the
urgency classifier (overdue / ≤48h / ordinary, undated rows, future hearings),
overdue stamps, task open/blocked buckets, the update-due flag with the
30-minute post-hearing grace, invoice outstanding math and IST due-date
boundaries, **permission-controlled section gating** (billing roles vs
paralegal, capability arrays, loading state), and empty-state coverage for
every section. Cross-tenant / matter-access denial is enforced through the
same `canViewMatter` pure policy already exercised by the two-tenant fixture
in `src/convex/accessPolicy.test.ts` (17 tests); the Command Centre adds no
new access rule of its own.

**Not verified (stated honestly):** no browser-driver tooling exists in this
environment, so the tab was **not** clicked through live; cross-tenant denial
over a real two-tenant HTTP session is covered at the decision layer only
(see item 8 below).

## Feature 4 — Client Intake & Matter Opening (implemented this run)

**Built:** `src/lib/intakeFlow.ts` (pure lifecycle/required-fields/KYC/duplicate/
invitation/acceptance/approval-guard engine), `src/lib/intakeFlow.test.ts`
(40 tests), `src/convex/intake.ts` (server module), `intakes` table in
`schema.ts` (by_org, by_org_state indexes), `src/pages/Intake.tsx`
(`/intake` desk with staged wizard), `src/pages/IntakeComplete.tsx`
(`/intake/complete?token=…` public client-completion page), route + sidebar
nav; `matters.nextMatterReference` exported for reuse.

- **Staged intake:** identity/contact, individual-or-organization details,
  matter description + urgency, adverse/related parties, conflict
  disclosure, KYC checklist, referral source, fee arrangement, engagement
  letter, risk assessment, responsible team, review — one wizard, draft
  saving at every stage, per-stage required-field dots in the rail.
- **Required fields per kind/matter type:** organizations (company/trust/
  government) must supply organisation name, registration number and an
  authorised representative; litigation matters require a court/forum;
  court-deadline urgency requires the deadline date; individuals are never
  asked for registration numbers.
- **Lifecycle:** draft → submitted → returned_for_correction | rejected |
  approved | cancelled, enforced by the pure state machine
  (`canTransitionIntake`) on every server mutation — terminal states never
  transition, editing only while draft/returned, reviewer notes mandatory
  for return/reject. Corrections resubmit through the same machine.
- **Duplicate-client prevention:** every draft save re-scores the
  prospective client against the org's clients using normalized email,
  last-10-digit phone, punctuation-insensitive registration number and the
  **conflict module's name normalizers** (honorifics/initials/corporate
  suffixes) — identity hits are "definite", name-only hits "possible";
  definite duplicates block approval until a human acknowledges with an
  audit trail.
- **Secure client completion:** expiring (7-day) completion links with
  per-link salt + salted-hash storage (raw token returned once, never
  stored — same scheme as staff/client invitations); NEW clients complete
  via the token; **EXISTING clients must authenticate** — the link alone
  discloses nothing and the token redeems only against the invited email's
  signed-in account; links can be revoked and reissued; single-use on
  submit.
- **Consent & engagement:** consent recorded by staff with audit;
  engagement letters are the chamber's approved template; **unsigned ≠
  accepted** — `engagementAccepted` is only ever set together with a
  signature timestamp by the client's own acceptance (via link or
  authenticated portal), never by a saved form flag; approval refuses an
  unsigned engagement.
- **Approval — exactly-once creation:** approver needs `matter.create`;
  the Feature-3 conflict gate is enforced (cleared check must be attached
  and re-validated against `openingGate` — rejected/downgraded checks
  abort); missing required fields, unacknowledged definite duplicates or an
  unsigned engagement abort **before any record is created**; client and
  matter are then inserted once, guarded by `createdClientId`/
  `createdMatterId` (re-approval is idempotent and returns the existing
  ids); the matter carries the conflict check id as provenance.
- **Access control:** firm-side register/detail gated by `matter.create` |
  `client.view_all` with org-scoped index queries; client-side reads are
  bound to the redeeming account (`getForClient` returns null otherwise);
  token-authorized writes exist only for NEW-client intakes whose link is
  live; cross-org ids are "not found"; every state change is audit-logged.

**Tests added:** `src/lib/intakeFlow.test.ts` (40 tests) — full transition
matrix incl. terminal states, edit-window rule, required-fields per client
kind and matter type (org fields, litigation court, deadline date,
whitespace-only), KYC checklist per kind, duplicate detection (email/
phone/registration/normalized-name variants, definite vs possible,
no-hits, garbage inputs), invitation expiry (7-day TTL, blocker matrix),
engagement unsigned-≠-accepted rule, and the approval guard (state,
capability, conflict check, missing fields, unsigned engagement, missing
KYC, exactly-once detection).

**Not verified (stated honestly):** no browser-driver tooling, so the
wizard, completion link and portal round-trip were **not** clicked through
live; invitation expiry is enforced by comparison against server time and
is covered by unit tests only; the live two-tenant HTTP round-trip remains
the standing open item (below).

## Feature 3 — Conflict-of-Interest Check (earlier run)

**Built:** `src/lib/conflictFlow.ts` (pure matching engine),
`src/convex/conflicts.ts` (intake, search, classification, override, gate,
report), gated `matters.create`, `src/components/ConflictGatePanel.tsx`,
`src/pages/Conflicts.tsx` (Conflicts desk, `/conflicts`), route + sidebar
nav.

- **Full intake captured:** proposed client, adverse parties, related
  companies, directors/beneficial owners, witnesses, aliases, related
  matters, referring party, engagement description (schema: `conflictChecks`
  extended; legacy columns kept so the original desk keeps working).
- **Labelled search tiers** across current/former clients, matters and their
  opposing parties, contacts, chronology/notes mentions (witnesses/related
  parties), organizations (visible matter courts), aliases from earlier
  checks and prior checks themselves: **exact** (byte-identical),
  **normalized** (case/punctuation/honorifics/initials/Indian corporate
  suffixes stripped; org-form and person-name variants), **possible**
  (fuzzy token overlap / containment) — every row shows its tier, and
  email/phone identity matches count as normalized.
- **Restricted conflicts:** matches visible only to a team the caller
  cannot see are returned as **placeholders with no label, id or detail** —
  a visible conflict indicator with zero data leakage; restricted matches
  are counted in the summary so classification cannot be silently weakened,
  and the rendered report contains no confidential text (asserted in
  tests).
- **Classification & gate:** authorized lawyers classify
  no_conflict / possible_conflict / confirmed_conflict /
  investigation_required with required reasoning; `matters.create` refuses
  to open a matter until a check for the proposed client is cleared —
  confirmed conflicts block until an **elevated override**
  (`conflict.override`; owner/partner/administrator by default, never
  grantable to support staff via the normalizePermissions ceiling) records
  a reason; every action lands in the audit log; a **timestamped report**
  renders per check.
- Cross-tenant: a check id from another organization is refused at the
  gate ("belongs to a different organization") and invisible in
  get/search/register (org-scoped index queries).

**Tests added:** `src/lib/conflictFlow.test.ts` (20 tests) — normalization,
exact/normalized/possible tiers, **alias & adverse-party matching**, former
clients/contacts/witnesses/directors/organizations coverage,
**restricted-result hiding + summary counting + report leak check**,
**opening gate** (pending/middle/confirmed/override-reason) and report
rendering with override. **Tenant isolation** and role ceilings are enforced
through the shared policy layer already covered by the two-tenant fixture
(`accessPolicy.test.ts`, 17 tests) plus the new support-staff ceiling test
for `conflict.override`; the live two-tenant HTTP round-trip remains the
known open item (below).

**Design decisions, stated:** bulk CSV matter import (`imports.ts`) is an
administrative migration path and is deliberately **not** gated by the
conflict check (importing an existing book of business is not an engagement
decision); the intake search indexes chronology/notes text for
witness/related-party mentions with a ≥4-character token threshold and
clamps results to 40 matches per check.

**Not verified (stated honestly):** no browser-driver tooling, so the desk
was not clicked through live; matching is heuristic (token-based, not
semantic) — it is evidence for human review, never an automatic bar.

## Automated verification performed (history)

Outstanding TypeScript diagnostics: **none remaining.** The one real issue found
during the pass (`@types/node` resolution inside the tests project, caused by the
generated `api.d.ts` importing `"use node"` convex modules) was fixed by adding
explicit `types` to `tsconfig.tests.json`.

## Dependency vulnerabilities — remediation performed

25 advisories were open. Actions taken:

- **`@auth/core` 0.41.3** (critical homoglyph-email bypass, high Bearer-header
  crash, OAuth cookie binding) — updated via `@convex-dev/auth`'s dependency.
- **`react-router` 7.18.4** (high RSC-mode CSRF bypass) — updated within ^7.
- **`hono` 4.13.8** (moderate: ReDoS in CORS, memo() cross-user retention,
  query-parser, parseBody, proxy headers) — updated within ^4.
- **`postcss` 8.5.28, `js-yaml`, `nanoid`, `brace-expansion` 1.1.18/5.0.12,
  `browserslist` 4.29, `baseline-browser-mapping` 2.11.25** — updated, plus
  package `overrides` forcing every transitive copy (eslint/babel/vite chains)
  above the fixed versions.
- **`vite` 7.3.6 + `@vitejs/plugin-react` 4.7.0** — the vite dev-server advisories
  (high `server.fs.deny` bypasses, WebSocket file read) required vite 7.3.x; the
  originally pinned plugin-react 6.x imports `vite/internal`, which 7.3.x removed,
  so the plugin was matched to a compatible major.

Residual risk honestly stated: the audit is clean today; advisories recur, so
`bun audit` should run on each dependency change. The overrides pin minimum
fixed ranges and will not silently regress.

## Tests added (regression suite)

No test framework existed previously; vitest was added (jsdom, jsdom-free pure
logic split from component tests). Existing regression tests: there were none to
preserve; the new suite is the baseline going forward.

- `src/lib/csvImport.test.ts` — RFC-4180 parsing (quotes, CRLF/CR, BOM, blank
  lines), formula-injection-guarded escaping, template round-trips, batch cap,
  required-column coverage for all five import entities.
- `src/lib/format.test.ts` — INR grouping (1,00,000 style), lakh/crore
  compaction, IST date rendering, financial-year label.
- `src/lib/reportExports.test.ts` — CSV export quoting, header propagation,
  missing-cell fill, formula-injection neutralisation, BOM for Excel.
- `src/pages/SettingsImport.test.tsx` — component tests: import card renders
  column specs and entity picker; template download produces a Blob/URL;
  backup card states that restore tests must be real and manual; admin actions
  are disabled while capabilities load; recorded exports/restore tests render
  with results.
- `src/convex/accessPolicy.test.ts` — **multi-tenant denial fixture** (added
  24 September 2026; it was previously referenced in comments/docs but did not
  exist): two-tenant fixture asserting cross-organization matter denial for
  every role including owner, direct-row document denial, matter team
  restriction, internal-document capability checks, the support-staff
  permission ceiling (override attempts cannot escalate), unknown-capability
  handling, and the subscription read-only gate boundary conditions. These are
  the exact pure functions `access.ts` delegates to on every server request.

Scope note, stated honestly: this fixture exercises the **decision layer** —
org-scoping, role/team/document rules and the write gate — without a live
database. It does not execute live authentication or a real two-tenant
network round-trip; that remains under item 8 below.

## What is verified live vs. not — the honest list

**Verified in this environment (tooling permitted):**
- Type-level integrity of the whole codebase; all Convex functions compile and
  push; production bundle builds.
- Pure-logic correctness of the import/export pipeline and formatting.
- Client-side rendering and interaction logic of the import and backup cards
  (with Convex mocked at the module boundary).

**Not verified — stated plainly, not marked done:**

1. **Authenticated browser journeys.** No browser-driver tooling is available in
   this environment, so the four login/logout journeys, wrong-portal behavior,
   keyboard-only navigation and responsive layouts were **not** executed against
   the running app. Route guards (`RequireAuth`, `RequireAuth portal=`) exist in
   code and typecheck, but no end-to-end click-through was performed.
2. **Fresh install / migration upgrade without data loss.** No staging database
   was available to run a migration and restore cycle. Convex `--once` pushes
   schema-deployable functions; an existing-data upgrade was **not** rehearsed.
3. **Backup restoration.** `docs/BACKUPS.md` documents the procedure, and the
   restore-test register exists, but **no restore has been executed** — the
   register is intentionally empty and must stay that way until a real
   non-production restore is performed by the operator.
4. **Payments / subscription lifecycle.** No payment provider credentials are
   configured (`paymentsProvider.ts` reads server-side env vars that are unset
   here). Checkout, verified payment events, renewal/cancellation/expiry,
   SaaS invoices and grace-period read-only behavior are implemented but
   **unexercised with a live provider**. Required before commercial launch:
   a merchant account approval, provider API keys, and webhook verification
   against real events. Provider policy review for lawyer advertising (section
   23) also remains an operator obligation before enabling paid placements.
5. **AI/OCR workflows.** The full pipeline (job preparation, runner claim,
   usage limits, transcript preservation) compiles and pushes, but no OpenAI
   credentials are configured in this environment, so **no live model call was
   made**. Per section 26's rule, the integration is complete but live
   verification is blocked — nothing claims AI works with canned answers.
6. **Email/SMS delivery.** Notification records and preference checks are
   implemented; no external email/SMS provider is connected, so delivery
   beyond in-app is unverified.
7. **Persistence after restart.** Convex is a managed database; data model
   durability is the platform's contract. Application-level persistence across
   a restart was not separately rehearsed here.
8. **Cross-organization denial and privilege escalation.** The decision layer
   is now covered by the automated multi-tenant denial fixture
   (`src/convex/accessPolicy.test.ts`): cross-org matter denial for all roles,
   cross-org document denial, team restriction, the support-staff ceiling and
   the subscription write gate. What is **still not** exercised: a live
   two-tenant deployment asserting denial over real HTTP/websocket
   authentication (the ctx-bound membership lookup in `getAccessContext` and
   the org-scoped index queries). That remains the most valuable next check on
   a real deployment.

## Cost / credentials checklist for the operator

- OpenAI API key (AI/OCR) — usage-based cost; monthly token cap is enforced
  app-side (`MONTHLY_TOKEN_LIMIT`).
- Payment provider account + webhook secret (subscriptions, consultations,
  promotions) — per-transaction fees apply; merchant approval timelines vary.
- Email/SMS provider credentials (outbound notifications).
- Professional advertising rules review (section 23) before enabling paid
  listings — a legal/policy obligation, not a code task.
