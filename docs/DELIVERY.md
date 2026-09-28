# Implementation & delivery map (section 31)

## Handoff — 28 Sep 2026 (3): MFA required for internal accounts; landing CTA removed; pending items kept honest

- **Landing page reverted**: "Open owner console" is REMOVED from the public
  hero — internal administration does not sit among customer registration and
  sign-in buttons. Direct access to `<preview-origin>/owner` is unchanged,
  and the server keeps rendering the activation card for the eligible
  account. The top-bar entry is now authority-gated three ways (resolved
  server-side, never by client email matching): activated platform owner →
  "Open owner console" (+ /platform Shield); the verified eligible bootstrap
  account BEFORE activation → "Open owner console" (leading to its
  activation card); active workforce employees → "Open team console" →
  /owner (capability-reduced workspace). Customers and chamber-only users
  see no platform navigation.
- **MFA is REQUIRED for internal platform accounts** (owner flag or active
  workforce role). The earlier "optional" wording was wrong and is
  retracted. Implementation: TOTP enrollment + 8 single-use recovery codes
  (Settings → Security; codes hashed at rest); `requireInternalMfa` gates
  every platform-ops capability mutation, the workforce-administration
  mutations, and internal staff's ticket reads; the /owner console renders
  a challenge card until the session completes it. **The emailed sign-in
  OTP is authentication, NOT a second factor** — it proves mailbox
  possession once at login and never satisfies the internal challenge.
  Refusal order is capability-first so MFA errors never leak to customers.
  Proven by real-backend tests (`internalMfa.test.ts` 3 tests;
  `workforce.test.ts` now runs its lifecycle through enrolled, challenged
  sessions; a sessionless chamber-owner identity still completes all
  customer flows — customers face no internal MFA).
- **Redirects vs shareable links, separated and tested**: post-auth
  redirects (`?returnTo=`) go through `safeInternalPath` (relative
  same-origin paths only; `//host`, `https://host`, scheme smuggling, and
  any backslash refused — browsers treat `\\` as `/`), while shareable
  links go through `appLink` (always absolute, built on the configured or
  live origin). 20 unit tests cover both, plus configured-URL validation
  (unparseable values fall back to the live origin instead of producing a
  bogus host).
- **`VITE_PUBLIC_APP_URL` requires a frontend rebuild/redeploy**: Vite
  injects it into the JS bundle at BUILD time, so changing the env value
  takes effect only after the frontend is rebuilt and republished (set it
  via the platform env/Keys config, then redeploy). Server-side Convex env
  vars are unrelated and need no rebuild. Until a domain exists, leave it
  unset — links then use the live preview origin.
- **Preview link**: not determinable from this environment (no env/config
  access). Open the Freebuff preview and note its origin; append `/owner`
  for the console. No URL is invented here.
- **STILL PENDING (until they actually succeed, not before)**: owner
  activation (requires the user's OTP sign-in + activation click + MFA
  enrollment) and the invite → accept → console browser pass. Automated
  evidence: tsc 0 errors; **29 files, 472/472 tests**; push OK.
- **Customer workflows preserved**: client/staff portals, ticketing,
  billing, and all chamber surfaces are untouched; internal MFA applies
  only to platform-owner and workforce accounts.

## Handoff — 28 Sep 2026 (2): preview-origin links; production domain stays configurable

- **No domain is owned** and advokate.in is unavailable. **No URL in the app
  points at advokate.in** — remaining occurrences are display wordmarks and
  an OTP label fallback, not links.
- **Link policy**: every shareable URL (platform-workforce invitation links,
  chamber member invites, client invites, intake completion links) composes
  from `appLink()` in `src/lib/appLinks.ts`: it uses `VITE_PUBLIC_APP_URL` if
  configured, else the **current preview origin** — so a link copied in the
  preview always opens the preview. In-app navigation stays relative.
- **Production domain later**: set `VITE_PUBLIC_APP_URL` (e.g.
  `https://yournewdomain.com`) in the project environment/Keys configuration
  once a domain is connected; nothing else changes. No code edit, no
  hard-coded host.
- **Landing page**: the hero now carries an **"Open owner console"** button
  (third CTA next to sign-in / find-a-lawyer) linking to the relative
  `/owner` route — it works in the actual preview regardless of origin.

## Handoff — 28 Sep 2026: CJ GLOBAL internal workforce shipped; conflation corrected

- **Correction (recorded honestly):** earlier handoffs labelled the chamber
  *Team & Access* feature (`invitations.inviteStaff`, `workspace.setMemberRole`,
  `workspace.suspendMember`) as satisfying the CJ GLOBAL "workforce" request.
  That was a conflation — Team & Access manages **chamber members inside one
  law firm**, not CJ GLOBAL's own platform staff. The platform now has a real,
  separate internal workforce system (below).
- **Internal workforce (platform-level, chamber-independent)** — new
  `platformEmployees` + `platformInvitations` tables (no orgId anywhere) and
  `workforce.ts`: owner invites by email → one-time token link
  (`/accept-platform-invite?token=…`, 14-day TTL, supersedes live invites) →
  the invitee signs in (email-verified account required, email must match) →
  platformEmployees row created/reactivated in-transaction. Owner-only
  suspend/unsuspend/role-change; revoke kills the token. Roles are exactly
  `support_agent | support_supervisor | developer` — **ownership is NOT a
  role**: it stays the audited `isPlatformAdmin` flag, and no workforce
  function can set it.
- **Capability-gated operations (real-backend tested)** — `platformOps.ts`
  mutations moved from the blanket `isPlatformAdmin` check to per-capability
  authority (`operatorForCapability`): agents claim/reply/resolve/set-priority,
  supervisors add handoff view/diagnostics, developers get read-only queue +
  rebuild but cannot reply to customers. `getTicket` now lets queue-capable
  staff read the ticket they work. The pure model lives in
  `platformWorkforce.ts`; 4 real-backend integration tests
  (`workforce.test.ts`) run the full lifecycle across owner/agent/developer/
  chamber-owner identities and prove each refusal by its error.
- **Console + nav** — `/owner` WorkforcePanel (invite form with one-time
  copyable link, pending invites with revoke, roster with role/suspend
  controls) and capability-gated sections; the top-bar Headset link now also
  appears for workforce identities (titled "Open owner console"), never for
  customers or chamber-only users.
- **Verification:** push OK (moonlit-elk-307 dev), `tsc -b` 0 errors,
  **27 files, 449/449 tests** (445 prior + 4 workforce integration).
  **Browser unverified** — no E2E pass of the invite/accept/console flow yet.
  Owner activation still pending the user's OTP sign-in.

## Handoff — 27 Sep 2026: owner activation shipped (verified gate, activation pending user sign-in)

- **Configured**: `PLATFORM_OWNER_EMAIL=clarencedrosario@gmail.com` set on the
  dev deployment. **Gate proven negative**: `platform:bootstrapAdmin` refused
  the grant because the account's email was not yet OTP-verified — an
  unverified account cannot become owner (by design, executed and recorded).
- **Added**: audited `platform.selfActivateOwner` (grants the operator flag
  only to the signed-in, server-side-verified account matching the env var;
  refuses all others generically), `platform.myOwnerActivationEligibility`,
  an activation card on `/owner`, and `platform.bootstrapStatus` diagnostics.
  **Activation is NOT yet executed** — it completes at first OTP sign-in + one
  click on `/owner`; until then owner access is honestly "code-verified,
  activation pending".
- **Owner steps**: preview → `/owner` → sign in with the owner email → enter
  the emailed 6-digit OTP → click **Activate platform ownership** (audited) →
  console loads. 2FA challenge applies per the console-route gate; enroll via
  Settings → two-factor.
- **Team & Access (chamber-level)** verified implemented + capability-tested
  (invite with seat gating, role set with last-owner protection,
  suspend/reactivate effective immediately; owner/administrator hold
  team.invite+team.manage, accountant/support_staff do not; support_staff
  cannot be normalized into administration). NOTE: this is the in-chamber
  member system — it does NOT manage CJ GLOBAL platform staff; see the 28 Sep
  handoff above for the real internal workforce.
- **Support workflow**: policy-level sequence automated (445/445); **browser
  unverified** — 8-step manual script recorded in ADVOKATE_PROGRESS.md.
- **Rebuild**: operator-only, explicit scan limits (REBUILD_MAX_TICKETS=5000 /
  REBUILD_MAX_ORGS=500, abort-with-error, test-pinned); two drift-correction
  fixtures added (missed resolve-bump detected + corrected; missed reopen-bump
  detected).

## Handoff — 27 Sep 2026: CJ GLOBAL support-ticketing slice shipped

**Delivered (push OK moonlit-elk-307 dev, tsc clean, 422/422 tests — code +
automated-suite evidence; no browser E2E pass yet):**

- **Customer support ticketing** — new `platformOpsTables` (`supportTickets`,
  `supportTicketMessages`, `platformOpsAudit`) + `src/convex/platformOps.ts`:
  any authenticated user submits and replies (client portal, staff portal,
  console via the shared `SupportCentre`); platform operators (`users.isPlatformAdmin`)
  claim/reply/assign/set-priority/resolve/close/reopen from the new `/owner`
  console; status machine, per-submitter visibility, mandatory resolution
  notes, and a full ops audit trail are enforced server-side; pure rules
  unit-tested in `platformOps.test.ts` (11 tests, incl. the guard that a
  chamber owner WITHOUT the platform flag cannot read foreign tickets).
- **AI-to-human escalation** — `escalateFromAiJob` pins a high-priority
  `ai_escalation` ticket to the AI job (access-checked against the job's org;
  job contents never copied into the ticket); "Escalate to human support"
  affordance added to every completed/failed/expired request in the AI Studio.
- **Operator console** — `/owner` route + page: live cross-chamber queue,
  health counters (unassigned, open AI handoffs, >24h no-first-response),
  thread/resolve/reopen dialogs, ops audit feed, and the **"AI handoffs by
  chamber" mat-view card** (open/unclaimed/high-priority per chamber with an
  audited rebuild button); top-bar Headset entry for platform admins
  alongside the existing `/platform` Shield link.
- **AI-handoff materialized view** — `aiHandoffStats` is write-maintained:
  one row per chamber, bumped in the same transaction as every ticket change
  that moves a handoff's live state (create/claim/priority/resolve/close/
  reopen); pure before/after-snapshot delta rules in `handoffView.ts`
  (counters floored at zero, timestamps forward-only); audited
  `rebuildAiHandoffStats` recomputes from base tables for self-heal; the AI
  Studio escalation dialog shows the chamber's live counters via
  `myChamberHandoffStats`.
- **Known gaps flagged**: operator flow needs the section-24 bootstrap grant
  (`PLATFORM_OWNER_EMAIL`) before anyone can triage; no push notification to
  operators on new tickets (console polling only); the rebuild's drift
  correction has no test fixture (its pure rules are tested); `/employee` and
  `/developer` remain Not started.

## Handoff — 27 Sep 2026: five-question audit closed, HR module live, payroll next

**Answers delivered (evidence in ADVOKATE_PROGRESS.md):**

1. **Q1 deployment identity** — one project: moonlit-elk-307
   (`clarencedrosario:vintage-customer-app`, dev). `cautious-kingfisher-954`
   appears nowhere in the repo, the earliest checkpoint tar, or the DB export
   schema — stale report reference, not a second deployment. Env files are
   platform-blocked to tooling, so the CLI banner + grep + tar analysis is the
   evidence basis.
2. **Q2 billing→ledger gaps** — cancellation/refund journals added (idempotent
   dedupe keys), payment posting race closed (post by inserted id),
   `billingPostingGaps` + `reconcileBillingJournals` with an Accounting-page
   gap panel; unsupported workflows honestly listed in the UI.
3. **Q3 custody** — append-only `documentCustodyEvents` store mirrors every
   event (the 200-cap in-memory trail no longer loses history), paginated
   complete-history UI, hash-provenance explainer.
4. **Q4 HR** — capability matrix confirmed against `accessPolicy.ts` (9 roles,
   no hr_manager; accountant has payroll.run, not payroll.approve), then
   implemented: employees with server-side salary-field stripping
   (`canViewSalaryRecord`), departments, leave lifecycle with pure-math balances
   (13 tests), attendance, versioned statutory settings with an
   anti-invented-rates guard, `payrollPrerequisites`. `/hr` route + nav live.
5. **Q5 CJ GLOBAL** — Section 25 checklist added to ADVOKATE_REQUIREMENTS.md;
   all five platform-operations items honestly **Not started** (no schema, no
   routes).

**Payroll slice (delivered same turn):** `src/lib/payrollMath.ts` (23 tests —
zero-drift proration, LOP flooring, frozen-spec statutory computation,
balance-refusing journal plan) + `src/convex/payroll.ts` (structures CRUD,
run lifecycle with frozen `statutoryVersionIds`, separate bank-file/payment
marking, audited reversal, dedupe-keyed journal posting that REFUSES unmapped
statutory payables) + `PayrollPanel` UI in `/hr` with statutory/structure
editors. `employeesWithoutStructures` now real. No statutory rates ship —
operators enter verified values; payroll refuses to run on missing kinds.

**Verification:** push clean (moonlit-elk-307 dev), `tsc -b` 0 errors,
**411/411 tests**. **Not yet done:** any browser/E2E pass over these flows.

**Next up:** CJ GLOBAL platform-operations (owner console, employee
onboarding, customer tickets, AI-to-human escalation). Payroll follow-ups:
run-time TDS withholding, arrears, explicit join/leave proration inputs,
payslip PDF export, final settlements.

---

## HR / Payroll / Accounting expansion — Phase 1: shared foundations (added 26 Sep 2026)

Program status checklist (10 phases, user-requested labels):

| Phase | Scope | Status |
|---|---|---|
| 1 | Codebase audit, shared permissions, data-model foundations | **Implemented and verified** |
| 2 | HR management & employee self-service | Not started |
| 3 | Accounting foundation integrated with billing | Not started |
| 4 | Payroll & accounting integration | Not started |
| 5 | Advanced project management | Not started |
| 6 | Proprietary messaging | Not started |
| 7 | Video conferencing | Not started |
| 8 | Proprietary email | Not started |
| 9 | Case-law research database | Not started |
| 10 | Cross-module security, backups, release validation | Not started |

**Phase 1 delivered this session:**

- 11 new capability keys in `src/convex/accessPolicy.ts`: `hr.manage`, `hr.view_own`, `hr.view_salary`, `hr.approve`, `hr.recruit`, `payroll.run`, `payroll.approve`, `finance.view`, `finance.manage`, `pm.manage`, `pm.view_all`. Defaults: owner = all; partner = all HR/finance/payroll/pm; administrator = HR management + salary visibility (no payroll/finance posting); accountant = finance.view/manage + payroll.run + own self-service (explicitly **no** hr.view_salary, no hr.manage); lawyers/paralegals/juniors = self-service + pm visibility; support_staff = self-service only.
- `normalizePermissions` forbidden-set for support_staff extended: support staff can never be granted hr.manage/hr.view_salary/hr.approve/hr.recruit/payroll.*/finance.*/pm.* — normalization strips them even from a browser-supplied override list.
- New pure policy rule `canViewSalaryRecord(ac, employeeOrgId, employeeUserId)`: org isolation first; reads of salary/payslip/statutory-ID data require `hr.view_salary` (or self via `hr.view_own`). A role is **not** a bypass — the per-org grant is required even for owners, so salary visibility is auditable and revocable. Plus `canManageHr`/`canManageFinance` helpers.
- `hrTables` in `src/convex/schemaExtras.ts` (19 tables, org-scoped, by_org indexes): employees, departments, leaveProfiles, leaveRequests, attendance, orgHolidays, vacancies, candidates, hrDocuments, reviews, hrExpenses, workLogs; payroll: statutorySettings (versioned, effective-dated — operators enter verified PF/ESI/PT/TDS values; payroll refuses to run on empty config, no invented rates), salaryStructures (component-wise, effective-dated), payslips, payrollRuns (draft→in_review→approved→finalized→reversed, bank-file generation separate from payment-status marking); accounting: accounts (chart of accounts, clientFund flag), fiscalYears (closing), journalEntries (debits/credits arrays in paise, balance enforced at post, immutable posted rows, reversals, dedupeKey idempotency). All money integer paise; dates YYYY-MM-DD IST.
- Settings permission matrix labels added for all new capabilities (`src/pages/Settings.tsx`).
- Tests: `src/convex/accessPolicy.program.test.ts` — 17 tests covering capability registration, default-matrix role boundaries, salary-record ceiling (org isolation, self-service boundary, grant-revocation semantics), write-authority helpers, support_staff escalation stripping (including pm.*), unknown-key dropping, and regression of existing invariants.

Verified 26 Sep 2026: `bunx convex dev --once` push clean, `bunx tsc -b --noEmit` 0 errors, **302/302 tests** (285 prior + 17 new). Not yet built: all module logic/UI (phases 2–9). Accountant default now includes `hr.view_own` (self-service) — matrix change recorded here for operator review.

---
Status legend:
- **Implemented & tested** — code complete, exercised by the automated suite and/or live typecheck/build/push.
- **Awaiting external config** — implemented, but needs credentials/approvals you must supply (keys, merchant accounts, provider review).
- **Incomplete** — not built yet.

Last verified: 28 September 2026 — `tsc -b` 0 errors, 449/449 tests (27 files), Convex push OK. Earlier: 26 September 2026 — 285/285 tests.

## The connected chamber (this milestone's focus)

The core chain now runs end-to-end inside a matter:

**Hearing outcome recorded → suggested tasks created (lawyer-confirmed) →
chronology event logged → client update draft opened → next hearing scheduled
→ next Hearing Pack preselected and one click away.**

Every scheduled hearing row offers **Prepare pack** (dialog preselects that
hearing) and **Record outcome**; after saving an outcome with a next hearing,
the pack builder can be reopened with that next hearing already selected.

- Backend: `matters.recordHearingOutcome` (atomic outcome + optional next
  hearing, `refreshNextHearing` maintained, chronology event + audit entry),
  `matters.addTask` (assignee notification), `drafts.create` (routed to the
  review/approval desk), `matters.listHearings`, `matters.matterForHearing`.
- UI: `HearingOutcomeDialog` — result (held/adjourned), what happened,
  immediate next action, optional next-hearing scheduling, reviewable
  suggested-task checklist, and a client-update draft preview explicitly
  labelled "Draft — review required". The draft reaches the client only
  after approval via the existing gate in `comm.sendClientUpdate`
  (approved draft version or thread auto-send rule).
- Suggestion logic in `src/lib/outcomeFlow.ts` is pure and unit-tested
  (adjourned vs held branches, filing-kind mapping, promise-free client
  wording, length caps).

## Implemented & tested

| Area | Notes |
| --- | --- |
| Accounts & auth | Convex Auth (email OTP), sessions, 2FA, invitation/reset flows |
| Org & permissions | Roles, capability matrix, per-role editing, audit trail |
| Clients & matters | Create/edit/close/reopen/archive, Client 360, team restriction |
| Hearings | Schedule/edit, outcome + next hearing (now wired to UI), authorities |
| Chronology & docket | Events with precision, per-matter docket, audit log |
| Tasks & deadlines | Desk with views, deadlines with IST day-end, playbooks (template + apply) |
| Deadline rules engine | Versioned rules, court holidays, drafts from orders/hearings, lawyer approval, adjustments with reasons, escalation (Feature 5) |
| Undertakings register | Given/received register, supervisory approval before activation, completion evidence + verification, breach records, correction history, escalation in the reminder scan, confidential-safe firm report (Feature 9) |
| Documents | Upload/share/version metadata, request flow, review desk, comparison |
| Drafts | Versions, comments, review/approval desk, client-update gate |
| Billing | Time/expense, invoices from matter, payments, reconciliation, PDF |
| Reports | Permission-scoped dashboard + CSV/PDF export |
| Notifications | In-app centre, preferences, scheduler-based reminders (crons) |
| Automation | Trigger/condition/action rules with history, duplicate prevention |
| Directory & consults | Public profiles, verification, booking, conversion |
| Promotions | Packages, owner approval, expiry, metrics, labelled separately |
| SaaS subscriptions | Plans, trials, checkout-ready, invoices, grace, owner tools |
| Firm knowledge | Precedents/templates/notes/authorities, versions, approval states |
| Court info | Cause-list import/link, court updates, source labels |
| AI/OCR | Studio, sources with roles, 12 job kinds, usage caps, audit |
| Legal AI (contextual) | Ask My Matter quick-ask, Ask This Document (pinned single-source), Smart Timeline, Document Comparison, AI Morning Briefing from the docket, Legal Research over the approved firm library with strict retrieved-vs-generated labelling |
| Offline mode | Bundle prepare/sync, queued notes, conflicts, expiry |
| Import | 5 entities, validation/preview/duplicates/error report, apply-once |
| Backups | Archive export, restore-test register, documented procedure |
| Navigation | Section 29 grouped sidebar, simplified portal navs, deep links |
| Tests | 68 automated tests (parsing, formatting, exports, outcome chain, cards, multi-tenant denial fixture, invitation lifecycle) |

## Awaiting external configuration

| Area | What is needed from you |
| --- | --- |
| AI/OCR live calls | OpenAI API key (server-side env); usage-based cost |
| Legal-authority verification | AI research cites only the firm's own approved library; no external case-law provider is configured, so retrieved authorities are limited to that library by design |
| Payments (SaaS, consultations, promotions) | Merchant account + webhook secret; per-transaction fees |
| Email/SMS delivery | Provider credentials for outbound notifications |
| Paid legal-service advertising | Professional-advertising rules review for your jurisdiction (policy obligation) |
| Restore test | A real restore in a non-production environment (register stays empty until then) |

## Incomplete / operator actions before launch

| Item | Status |
| --- | --- |
| Browser-journey test run | Not executed here (no driver tooling); routes/guards verified by typecheck and code review |
| Migration upgrade rehearsal | Needs a staging deployment with existing data |
| Multi-tenant denial test fixture | Done as a pure-policy fixture (`src/convex/accessPolicy.test.ts`); a live two-tenant run on a deployed environment remains an operator check |
| Source repository handover | Platform-managed VCS; export/ownership transfer happens at publishing time |
| Demo/synthetic account removal | None shipped; verify none exist before public deploy |

## Document Vault & Billing (added 25 Sep 2026)

- **Document Vault** (`/vault`): the specified 10-folder structure, rename/move/tag/classify/archive/delete, version control with restore and direct version uploads, filename + natural-language full-text search over extracted document text (₹/percent aware, page-anchored snippets, matter-boundary safe). Search and AI analysis read only extracted text (`aiSources`) — scans need OCR first.
- **Billing & Time**: timer and manual time entries, billable/non-billable on time and expenses, expense categories (court fee / filing / travel / printing / courier / misc), receipt attachments, and the existing rates / fixed-fee / retainer / GST / payment-tracking engine now surfacing the new fields.
- Verified: `tsc -b --noEmit` clean, 271/271 tests, `bun convex dev --once` push (new `vaultMeta`/`vaultVersions` tables + extended `timeEntries`/`expenses` fields), production build. Not verified live: browser click-through of the Vault and new billing forms, real-file version/receipt uploads, OCR on scans, live AI calls (no OPENAI_API_KEY in this environment).

## Email Integration — thread filing & AI email work (added 25 Sep 2026)

Feature §2 of the current spec, built as an extension of the existing thread system (no parallel email store):

- **File an email** (`conversations.recordEmail` extended): an email is filed into a matter/client thread with structured metadata (`messages.emailMeta` — direction, from, to, subject, email date, filed-by) plus optional attachments that must already exist as vault documents on the same matter. Every filing is audit-logged. The Comms thread view renders filed emails with their own header strip.
- **Create tasks from emails**: the existing `conversations.createTaskFromEmail` is now reachable from every filed email (task.manage holders only); the task lands on the thread's matter.
- **AI email summarisation & reply drafting**: two new AI kinds — `email_summary` and `email_reply` — flowing through the existing job pipeline (saved requests, usage caps, idempotent claims, professional-review banner). `ai.prepareJob` pins the filed email at request time (snapshot stored on the job, so the runner never re-reads a message); the runner adds it as a single labelled "FILED EMAIL" source with the matter's extracted sources as supporting context. The reply prompt forbids invented commitments/dates, requires `[NEEDS LAWYER'S INPUT: …]` and `[AUTHORITY NEEDED]` placeholders, and never predicts outcomes.
- **UI**: "File an email" button on matter threads; "AI summary" and "AI reply draft" actions on each filed email (note.write holders); results deep-link to the matter's AI tab. Kind labels added in the studio and AI page.

Verified: `tsc -b --noEmit` clean, 285/285 tests, `bun convex dev --once` push (messages.emailMeta + aiJobs.emailMessageId/emailBody/emailDigest). Not verified live: no OPENAI_API_KEY in this environment, so no live model call — prompts, access checks and pipeline compile and push; mailbox auto-sync (Gmail/Outlook OAuth) remains unimplemented, stated as such rather than faked.

## Morning Briefing × filed emails (added 26 Sep 2026)

The AI Morning Briefing now includes **yesterday's filed inbound emails** alongside the matter sources:

- `prepareMorningBriefing` collects emails filed via `conversations.recordEmail` whose `emailMeta.receivedAt` falls in the previous **IST calendar day** (fixed UTC+5:30 — same day model as the reminder engine), builds a capped digest (`emailDigestForBriefing`, newest first, 8 emails max, bodies truncated with an explicit marker) and snapshots it onto the job at request time.
- **Access discipline:** the digest is built only over the caller's *visible* matters — the exact same team/role rule that filters the briefing's matter sources. A team-restricted matter's emails cannot leak into a briefing just because the requester holds `note.write`. Only `inbound` direction is included; filed emails on threads without a matter are excluded by construction.
- The runner prompt adds a final "Emails received yesterday" section, cites each as `[EMAIL n]` with its matter reference, folds email-set dates into the 14-day deadline section, and keeps the no-inference / no-prediction rules. Briefings without any filed emails are byte-identical to the previous behaviour (no empty-section noise).
- Pure logic (`istDayWindow`, `emailDigestForBriefing`) lives in `src/convex/ai.ts` and is unit-tested in `src/convex/briefingEmails.test.ts` (11 tests: day-window boundaries across midnight/month/year, window classification, ordering, cap, truncation, citation format).

Verified: `tsc -b --noEmit` clean, 285/285 tests, `bun convex dev --once` push (aiJobs.emailDigest). Not verified live: still no OPENAI_API_KEY in this environment — prompt behaviour needs live verification by the operator.



1. **Source reconciliation, opening screen, account lifecycle** — done (landing, login/OTP, portals, invitations). Verified 24 Sep 2026: invitation lifecycle logic extracted to `src/lib/invitationFlow.ts` (pure, 13 unit tests: status register, SHA-256 salted token hashing, blocker precedence, invited-email match, seat gating) and one defect fixed — accepting a client invitation no longer overwrites an existing user's legacy `role` (which mis-routed firm members' fallback portal).
2. **Clients, matters, teams, support-staff workflows** — done.
3. **Hearings, chronology, tasks, deadlines, documents** — done (outcome chain now connected).
4. **Client requests, Hearing Packs, review/approval** — done.
5. **Billing, payments, communications, notifications** — done; live payment/email run needs provider config.
6. **Client portal, reports, directory, SaaS subscriptions** — done; subscription checkout needs merchant config.
7. **Firm knowledge, automation, court integrations, offline** — done (court data is manual-import, honestly labelled).
8. **AI, OCR, voice, evidence mapping, Order→Action** — done; awaiting API key for live verification.
9. **Final production validation & launch prep** — acceptance matrix in `docs/ACCEPTANCE.md`; launch checklist below.

## Launch checklist (before public deploy / paid activation)

1. Configure provider keys (OpenAI, payments, email/SMS) in the Keys tab — never in code.
2. Approve merchant account and verify webhooks with real events.
3. Commission the professional-advertising rules review if enabling paid listings.
4. Run one real restore test into staging and record it.
5. Confirm no demo accounts/passwords exist; rotate all secrets.
6. Transfer the repository to your control and publish the approved deployment.
