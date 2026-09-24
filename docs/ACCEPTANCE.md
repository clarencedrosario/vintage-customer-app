# Acceptance report (section 30)

Date: 24 September 2026 (updated after Feature 1 — Case Command Centre).
This report states what was actually exercised and what was not. HTTP 200s
and mocked tests are not treated as live proof.

## Automated verification performed

| Check | Result |
| --- | --- |
| TypeScript (solution build, `tsc -b --noEmit`) | **0 errors** (app, node, tests projects) |
| Unit & component tests (`bun run test`, vitest) | **142 passed / 0 failed** (12 files) |
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
