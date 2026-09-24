# Acceptance report (section 30)

Date: 24 September 2026 (updated). This report states what was actually
exercised and what was not. HTTP 200s and mocked tests are not treated as
live proof.

## Automated verification performed

| Check | Result |
| --- | --- |
| TypeScript (solution build, `tsc -b --noEmit`) | **0 errors** (app, node, tests projects) |
| Unit & component tests (`bun run test`, vitest) | **55 passed / 0 failed** (6 files) |
| Production build (`bun run build`) | **Passes** — clean bundle, ~15s |
| Convex functions push (`bunx convex dev --once`) | **Success** — all functions deployed |
| Dependency audit (`bun audit`) | **0 vulnerabilities** (was 25: 1 critical, 14 high, 9 moderate, 1 low) |

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
