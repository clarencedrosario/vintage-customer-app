# ADVOKATE_REQUIREMENTS.md — Master Requirements Checklist

The complete specification for Advokate (all 24 sections of the master prompt).
Every item carries one of these statuses, applied honestly:

- **Implemented and verified** — code complete, exercised by the automated suite (or live typecheck/push) with evidence recorded in `ADVOKATE_PROGRESS.md`.
- **Implemented but unverified** — code complete; needs live operator testing (e.g. real provider keys, real browser pass) before it can be trusted.
- **Blocked by external setup** — integration boundary built, but needs an external account/key/DNS/domain/decision to proceed.
- **Not started**.

> Rule: no item is marked complete because its screens exist. Mock data is never
> substituted for real functionality without explicit labelling. Where a claim
> would be dishonest (e.g. "guaranteed no conflict", "e2e encrypted", "verified
> e-signature"), the requirement itself says no — and so does this file.
>
> Verification vocabulary (tightened after the 26 Sep audit): **"verified"** means
> the implementation is enforced server-side and exercised by the automated suite
> or a clean typecheck/push — it is NOT an operator end-to-end browser pass.
> No legal workflow has had a recorded E2E browser walkthrough yet; that evidence
> category is tracked separately in `ADVOKATE_PROGRESS.md`.

Last updated: 28 September 2026 (turn: CJ GLOBAL internal workforce shipped — platform roles support_agent/support_supervisor/developer, invite→accept→suspend lifecycle, capability-gated platform operations, real-backend 4-identity integration tests; chamber Team & Access formally separated from the platform workforce). Evidence and test results: `ADVOKATE_PROGRESS.md`.

---

## 1. Inspect the project before changing it
- Master checklist maintained here + `ADVOKATE_PROGRESS.md` — **Implemented and verified**
- Reuse over rebuild; no framework/backend/auth/DB replacement — **Implemented and verified** (Convex/Convex Auth/shadcn retained throughout)

## 2. Four portals and account lifecycle
- Four portal entries: Lawyer, Law Firm, Support Staff, Client — **Implemented and verified** (single unified `/login`; role/portal resolved server-side via `orgs.resolve` from memberships; portal cards never grant privileges)
- Role-based sign-in and routing — **Implemented and verified**
- Logout returns to the portal selector — **Implemented and verified** (`ChamberShell.handleSignOut` → `/login?reason=signedout`)
- Invalid portal selections rejected safely — **Implemented and verified** (`RequireAuth` portal guard redirects to the account's own home)
- Registration, email verification (OTP), password reset, invitations, activation, expiry, revocation — **Implemented but unverified** (email delivery needs provider config; invitation lifecycle unit-tested)
- Individual-lawyer and "Enroll my chamber" onboarding — **Implemented but unverified**
- Multiple memberships + explicit organization switching — **Implemented and verified** (`orgs.resolve` picks active membership; `activeOrgId` switch)
- Owner/administrator/lawyer/associate/HR/accountant/support-staff/client permissions — **Implemented and verified** (9 OrgRoles; editable per-org matrix; HR/finance/payroll/pm capabilities added 26 Sep; support-staff escalation guard enforced in `normalizePermissions`)
- Server-side firm isolation + matter-level authorization — **Implemented and verified** (pure `canViewMatter`/`canViewDocument` + 2-tenant denial fixture in tests)
- Clients see only explicitly shared info; support staff only assigned work — **Implemented and verified** (portal routes resolve server-side; portal-specific queries)
- Subscription suspension/closure access + retention rules — **Implemented but unverified** (subscription read-only gate implemented & unit-tested; closure/retention process documented, needs operator walkthrough)
- Never UI-only authorization — **Implemented and verified** (every Convex module re-derives access server-side)

## 3. Client intake, onboarding, and conflict checks
- Enquiry capture, prospective-client records — **Implemented and verified**
- Contacts, related parties, referral sources — **Implemented and verified**
- Consultation scheduling, intake questionnaires — **Implemented and verified**
- Conflict searches (current/former clients, opposing parties, related entities, matters) — **Implemented and verified**
- Flagged matches with human review + documented decisions — **Implemented and verified**
- Controlled conflict overrides (capability `conflict.override`, support-staff excluded) — **Implemented and verified**
- Engagement letters, fee agreements, e-signature integration — **Implemented but unverified** (e-signature = typed/acknowledged acknowledgement only — NOT a verified electronic signature; real provider integration **Not started**)
- Document requests & onboarding checklists — **Implemented and verified**
- Enquiry→client→matter conversion without duplicate entry — **Implemented and verified**
- Secure client invitations, explicit access grants — **Implemented and verified**
- "No match" is never a guarantee — **Implemented and verified** (explicit disclaimer in conflicts flow)

## 4. Complete matter and case management
- Matter lifecycle: creation, numbering, practice areas, jurisdiction, court, case number, responsible team — **Implemented and verified**
- Parties, advocates, opposing counsel, judges, contacts — **Implemented and verified**
- Stages, status, priorities, budgets, fee arrangements, custom fields — **Implemented and verified**
- Chronology, case history, internal notes, legal issues, documents, evidence, hearings, orders — **Implemented and verified**
- Tasks, dependencies (basic), deadlines, reminders, escalation — **Implemented and verified**
- Settlement, closure, reopening, archival, retention — **Implemented and verified**
- Matter dashboards (upcoming work, activity, financial position, missing info) — **Implemented and verified**
- Internal notes kept separate from client-visible updates — **Implemented and verified**

## 5. Hearings, deadlines, and court workflows
- Shared firm calendar + personal calendars — **Implemented and verified**
- Hearing dates, court details, appearances, outcomes, next dates — **Implemented and verified**
- Court-day views for lawyers and assigned support staff — **Implemented and verified**
- Configurable deadline rules, holiday calendars, rule versions, calculation explanations — **Implemented and verified** (versioned rules; frozen specs; breakdown trail)
- Mandatory recorded lawyer verification for legally consequential deadlines — **Implemented and verified** (draft → lawyer approval → acknowledged lifecycle)
- Reminders, escalation — **Implemented and verified** (5-min reminder cron + escalation in `crons.ts`/`reminders.ts`)
- Rescheduling (audited reschedule action) — **Not started** (gap found in 26 Sep audit: hearings are editable until outcome is recorded, but there is no dedicated audited reschedule-with-reason flow)
- Calendar-conflict warnings when scheduling — **Not started** (gap found in 26 Sep audit: `addHearing` double-click dedupe exists, but no clash detection against a lawyer's existing hearings/deadlines)
- Hearing packs (documents, chronology, notes, pending work) — **Implemented and verified**
- Reviewed orders linked to follow-up tasks and deadlines — **Implemented and verified**
- Court-status integrations via authorized sources only — **Blocked by external setup** (manual import is the only source; clearly timestamped and labelled)
- Ordinary task dates distinguished from verified legal deadlines — **Implemented and verified**

## 6. Documents, evidence, and signatures
- Secure uploads, folders, tags, search, previews, matter linking — **Implemented and verified**
- Version history, review, controlled downloads, revocable share links — **Implemented and verified** (Document Vault + vaultVersions)
- Drafting templates, generation, reusable clauses — **Implemented and verified** (Drafts module)
- E-signature integration with accurate status — **Not started** (no provider; typed names/images never described as verified signatures)
- Evidence numbering, metadata, integrity hashes, chain-of-custody events — **Not started** (gap found in 26 Sep audit: `matterDocuments` has no integrity-hash field; file-access logging exists, hashing does not)
- Original-file preservation, derived-file tracking — **Implemented and verified** (vault versions preserve originals)
- File-type/size validation, malware scanning, secure storage — **Implemented but unverified** (validation implemented; malware scanning **Not started** — no scanning service configured)
- Retention rules, legal holds, audited deletion — **Not started** (gap found in 26 Sep audit: the only retention code is `backupRecords.retentionNote`, which is unrelated to document legal holds)
- Permission-aware document search — **Implemented and verified**

## 7. Lawyer collaboration
- Share a specific matter with an authorized colleague — **Implemented and verified** (matter team model)
- Separate access to notes/documents/chronology/tasks/messaging/financials — **Implemented and verified** (capability + visibility model)
- Optional access expiry — **Implemented but unverified**
- Immediate revocation enforcement — **Implemented and verified** (permissions re-derived per request)
- Audit of sharing/permission changes — **Implemented and verified** (auditLog)
- Historical message/attachment access on membership change — **Implemented and verified** (conversation access re-checked server-side per request)
- External collaboration via explicit invitations only — **Implemented and verified**
- Revocation ≠ retraction of downloaded files — **Implemented and verified** (stated honestly in UI copy)

## 8. Full HR management
- Employee profiles (lawyers, associates, paralegals, interns, accountants, support) — **Partially implemented** (26/27 Sep: employees CRUD in `hr.ts` — upsert with code/PAN/bank-last-4 validation, unique codes, user linking; list/get strip salary+PAN+UAN/ESI+bank fields server-side via `canViewSalaryRecord`; `/hr` UI live. Remaining: documents, reviews, offboarding)
- Departments, branches, designations, managers, employment types — **Partially implemented** (departments add/list + designation/employment-type fields on employee rows; branches & manager hierarchy pending)
- Recruitment: vacancies, candidates, interviews, offers, onboarding — **Not started** (schema ready)
- Employment documents, qualifications, contracts, expiry reminders, policy acknowledgements — **Not started** (schema ready)
- Attendance, shifts, holidays, leave balances/applications/approvals — **Partially implemented** (attendance upsert per employee-day; leave lifecycle apply→decide→mark-taken→cancel with balance decrement + LOP split; pure math in `hrLeave.ts`, 13 tests; shifts & holiday calendar pending)
- Billable/non-billable timesheets linked to matters & projects — **Partially implemented** (matter time entries live in billing; HR `workLogs` schema ready; project linkage lands with Phase 5)
- Performance reviews, goals, probation, training — **Not started** (schema ready)
- Expense claims, receipts, approvals — **Partially implemented** (matter expenses live; HR reimbursements schema ready)
- Resignation, clearance, offboarding, final settlement, access revocation — **Not started** (schema ready)
- Employee self-service — **Partially implemented** (own profile via `hr.view_own`; self leave application; separated employees blocked from applying; full portal surface pending)
- Salary/confidential HR records restricted to authorized roles — **Implemented and verified** (pure `canViewSalaryRecord` policy + 8 authorization tests; module enforcement live in `hr.ts` — sensitive fields stripped server-side unless granted; "restricted" shown in `/hr` UI)

## 9. Full payroll
- Configurable salary structures, earnings, allowances, deductions, bonuses, overtime, reimbursements, advances, loans — **Partially implemented** (27 Sep: effective-dated component-wise structures CRUD with whole-paise validation — any named component incl. allowances/advances can be entered; dedicated bonus/overtime/loan workflows pending)
- Payroll periods, attendance-based calc, LOP, arrears, joining/leaving proration — **Partially implemented** (runs per period; LOP from attendance rows + approved unpaid leave; arrears & explicit join/leave proration inputs pending)
- PF/ESI/PT/TDS/LWF workflows with verified effective-dated settings — **Partially implemented** (statutory CRUD + versioned freezing done; run-time computation applies frozen PF/ESI/PT/LWF specs — unit-tested; **TDS withholding at run time not yet computed**, config + payable mapping ready; NO rates invented, operators enter verified values)
- Previews, validation, approval, finalization, payslips — **Implemented and verified** (draft → in_review → approved → finalized enforced server-side with separate payroll.approve / finance.manage gates; payslips frozen at finalize; skip reasons explicit; browser pass still outstanding)
- Bank payment exports + payment-status tracking — **Implemented and verified** (file generation and payment marking are separate mutations by design; masked account details; hr.view_salary required)
- Final settlements, payroll reports — **Not started**
- Balanced accounting entries on finalization — **Implemented and verified** (journal identity Dr expense = net + mapped payables unit-tested; unmapped statutory payables REFUSE posting instead of being dropped; seeded-code mapping; dedupe-keyed idempotent)
- Audited corrections/reversals — **Implemented and verified** (mirrored reversal entry, ≥3-char reason, payslip history preserved)
- Duplicate-run protection, finalized-run immutability — **Implemented and verified** (per-(org, period) existence check; finalized rows immutable except audited reversal)

## 10. Full accounting and legal billing
- Billing: invoices, GST (CGST/SGST/IGST), payments, Razorpay links, partial payments — **Implemented but unverified** (live payment needs merchant config)
- Double-entry accounting: chart of accounts, fiscal years, journals, period closing — **Implemented and verified** (26 Sep: seeded 23-account Indian law-practice COA incl. client-fund pair + GST/TDS payables; balanced-journal posting enforced server-side; closed-period blocking; audited reversals; dedupe-key idempotency; pure math unit-tested)
- GL, trial balance, P&L, balance sheet, cash-flow — **Implemented but unverified** (ledger with running balance, trial balance with server-side reconciliation flag, P&L — 26 Sep; balance sheet & cash-flow **Not started**)
- AR/AP, vendor bills, receipts/payments, credit/debit notes — **Partially implemented** (AR posted from billing — 26 Sep; AP/vendor bills/credit-debit notes **Not started**)
- Billing → ledger integration (invoices sent, payments received incl. Razorpay path) — **Implemented and verified** (dedupe-key idempotent; skips honestly when chart unseeded)
- Retainers, time billing, fixed fees, milestones, disbursements — **Partially implemented** (hourly/fixed/retainer arrangements exist in billing; milestone **Not started**)
- Payment gateway integration — **Blocked by external setup**
- Refunds, allocation, reconciliation — **Partially implemented** (payment events tracked; allocation flows partially built)
- Bank accounts, statement imports, reconciliation, petty cash — **Not started**
- Budgets, branches, cost centres, matter/project profitability — **Not started**
- Fixed assets & depreciation — **Not started**
- GST/TDS workflows with verified effective-dated rules — **Implemented but unverified** (GST on invoices implemented; TDS **Not started**; no unverified rates shipped)
- Client-fund vs operating-fund separation — **Not started** (accounts.clientFund flag ready)
- Accountant permissions, approvals, exports — **Implemented and verified** (capabilities enforced server-side)
- Posted journals balance; paise-safe; audited reversals; closed-period lock; retry-safe; reports reconcile — **Implemented and verified** (invariants enforced in finance.ts, pure rules unit-tested in accounting.test.ts — 26 Sep; import dedupe remains for bank statements)
- Firm accounting separate from Advokate SaaS billing — **Implemented and verified** (separate table families)

## 11. Advanced project management
- Projects, workspaces, phases, milestones, tasks, subtasks, templates — **Not started** (Phase 5; pm capabilities shipped)
- List/Kanban/calendar/timeline/Gantt views — **Not started**
- Dependencies, recurring tasks, priorities, assignees, watchers, tags, custom fields — **Not started**
- Workload, capacity, estimates, actuals, budgets — **Not started**
- Approval stages, document reviews, deliverables, checklists — **Not started**
- Risks, issues, blockers, reminders, escalation, activity history — **Not started**
- Restricted client-facing progress views — **Not started**
- Dashboards (overdue, workload, completion, budgets, profitability) — **Not started**
- Configurable automation (e.g. onboarding tasks on matter open) — **Partially implemented** (matter automation rules exist in Knowledge module; project automation **Not started**)
- Circular-dependency prevention, duplicate automation prevention — **Not started**

## 12. Proprietary Advokate messaging
- Direct messages, groups, firm channels, matter channels — **Implemented and verified** (conversations model with participant permissions)
- Controlled client–lawyer conversations — **Implemented and verified**
- Attachments, replies, threads, mentions, search — **Implemented and verified** (voice messages **Not started**; reactions **Not started**)
- Unread counts, delivery status, read receipts, typing indicators, presence — **Partially implemented** (unread counts & read state implemented; typing indicators/presence **Not started**)
- Notifications, mute, archive, pinning — **Partially implemented**
- Membership controls, reporting, retention, audit — **Partially implemented**
- Reconnection, offline queues, duplicate-send prevention — **Implemented and verified** (offline centre + comm outbox pattern)
- Responsive mobile + PWA — **Implemented but unverified**
- Server-side conversation/attachment permissions — **Implemented and verified**
- E2E encryption claims — deliberately **not claimed** (transport + at-rest via infrastructure only)

## 13. Integrated video conferencing
- Instant/scheduled meetings linked to clients/matters/projects/calendar — **Not started** (Phase 7)
- Invitations, guest controls, waiting rooms, passwords, host permissions — **Not started**
- Camera/mic/device selection, screen share, participants, chat — **Not started**
- Host controls (mute, remove, lock, end) — **Not started**
- Reconnection handling, connectivity errors — **Not started**
- Optional recording with consent, retention, deletion — **Not started**
- Meeting notes & follow-up tasks — **Not started**
- WebRTC infra (TURN/SFU), self-hostable preference — **Not started**; will be reported as external dependency (hosting/bandwidth/storage) when built

## 14. Proprietary Advokate email service
- Email filing to matters/threads with structured metadata + AI work — **Implemented and verified** (recordEmail → emailMeta; AI email summary/reply jobs; briefing integration)
- Branded email application (inbox, folders, labels, threading, search) — **Not started** (Phase 8)
- Firm-domain mailboxes, aliases, shared mailboxes, delegated access — **Not started**
- Rich-text composition, attachments, signatures, autosaved drafts — **Not started**
- Outgoing queues, retries, bounces, delivery status — **Not started** (comm outbox exists for notifications; full mail pipeline **Not started**)
- Quotas, retention, exports, admin controls — **Not started**
- Spam/malware protection, rate limits, abuse controls — **Not started**
- Domain verification, SPF/DKIM/DMARC guidance — **Not started**
- Internal notifications vs external email distinction — **Implemented and verified** (commOutbox = notifications; conversations = internal)
- External sending/receiving verified — **Blocked by external setup** (needs domain, DNS, and mail provider credentials; will be reported honestly when built)

## 15. Proprietary case-law database and research
- Source registry, content-rights records, provenance — **Not started** (Phase 9)
- Background ingestion with retries/checkpoints/failure reports/dedupe — **Not started**
- Originals, text extraction, scanned-document handling — **Not started** (OCR **Blocked by external setup** — external service needed)
- Structured metadata (court, bench, judges, dates, case numbers, parties, citations, jurisdiction, subject, source URL) — **Not started**
- Full-text/phrase/Boolean search, filters, sorting, highlighting, paragraph refs — **Not started**
- Citation links, cited-case relationships — **Not started**
- Bookmarks, folders, annotations, matter-linked research — **Not started** (basic research page exists — **Not started** against this spec; current page is a stub-level experience)
- Corrected-document versioning — **Not started**
- Admin review, corrections, takedowns, ingestion reports — **Not started**
- Measured indexing/search performance — **Not started**
- Honest reporting: no "massive" claims until ingestion happens; no good-law inference from absence of negative treatment — principle adopted in `docs/DELIVERY.md`

## 16. Client portal
- View explicitly shared matter updates and hearing dates — **Implemented and verified**
- Upload requested documents, track requests/pending actions — **Implemented and verified**
- Request appointments, attend authorized meetings — **Partially implemented** (appointments implemented; meeting attendance **Not started** — awaits Phase 7)
- Message the legal team — **Implemented and verified**
- Review and pay invoices (configured gateways) — **Implemented but unverified** (payment Blocked by external setup)
- Access approved documents and engagement records — **Implemented and verified**
- Manage permitted personal info and notification preferences — **Implemented and verified**
- Never expose internal notes/staff conversations/other clients' data/confidential firm finances — **Implemented and verified** (server-side filters; denial-tested for matter access)

## 17. Lawyer directory and paid advertising
- Optional profile publication, practice areas, languages, locations, qualifications — **Implemented and verified**
- Search, filters, enquiries, moderation — **Implemented and verified**
- Verification labels with defined process — **Implemented and verified** (VerificationDesk)
- Basic listings + paid sponsored placements, clearly labelled — **Implemented and verified**
- Advertising packages, dates, budgets, billing, performance reports — **Implemented and verified**
- Spam prevention, enquiry-abuse controls — **Implemented and verified**
- Jurisdiction-aware publication controls — **Implemented but unverified** (BNI-appropriate defaults; professional-advertising legal review is a launch-checklist item, not yet commissioned)

## 18. SaaS subscriptions and platform administration
- Individual and firm plans, trials, seats, storage quotas, entitlements, usage limits — **Implemented and verified** (seat gating unit-tested)
- Upgrades/downgrades/renewals/cancellation/payment failures/grace — **Implemented but unverified** (needs live merchant events)
- Server-side entitlement enforcement — **Implemented and verified** (isSubscriptionReadOnly gate, unit-tested)
- Platform administration, support requests, operational dashboards — **Implemented and verified** (Platform page, platform admin audit)
- Audited, limited admin access to tenant data — **Implemented and verified** (platformAdminAudit)
- Defined export/retention/closure processes — **Implemented but unverified**
- Subscription changes never silently delete data — **Implemented and verified**

## 19. Firm knowledge and automation
- Internal precedents, clauses, templates, checklists, research notes — **Implemented and verified**
- Permissions, versioning, review, approval, search — **Implemented and verified**
- Event-driven automation (onboarding, reminders, approvals, transitions) — **Implemented and verified**
- Visible automation history, failure handling, duplicate prevention — **Implemented and verified**
- Human approval before consequential automated actions — **Implemented and verified**

## 20. Cross-module integration
- HR/attendance → payroll → accounting — **Not started** (data model designed for it; phases 2–4)
- Timesheets → billing, workload, profitability — **Partially implemented** (billing side done; HR/project side pending)
- Matters connect documents/evidence/hearings/orders/email/messaging/meetings/research/tasks — **Partially implemented** (all except meetings/research DB — Not started)
- Client visibility follows explicit sharing — **Implemented and verified**
- Global search respects permissions — **Implemented but unverified** (command centre permission filtering implemented)
- Notifications link to authorized records — **Implemented and verified**
- Deletions/revocations/membership changes propagate — **Implemented and verified** (per-request re-derivation)

## 21. Security, data ownership, and reliability
- MFA and session/device management — **Implemented and verified** (2FA challenge gate on console routes; login history)
- Server-side object-level authorization, cross-firm isolation — **Implemented and verified** (pure policy + denial tests)
- Secure credential storage, no secrets in browser — **Implemented and verified** (server-side keys via Convex env; Keys tab is operator-managed)
- Encryption in transit and at rest via supported infrastructure — **Implemented and verified** (Convex managed transport/storage; no custom crypto claimed)
- Audit trails, access reviews, restricted administration — **Implemented and verified**
- Validated imports with previews/duplicate checks/error reports — **Implemented and verified** (data import card)
- Authorized exports (clients, matters, documents, financials) — **Implemented but unverified**
- Retention policies, legal holds, controlled deletion — **Implemented but unverified**
- Backups and tested restoration — **Implemented but unverified** (backup records module exists; restore test is a launch-checklist item; source+DB checkpoints created 26 Sep, verified — see PROGRESS)
- Background-job monitoring, rate limiting, failure reporting — **Implemented but unverified**
- Dev/prod config separation — **Implemented and verified** (env-based config; Keys tab)
- Migrations with rollback/recovery planning — **Partially implemented** (checkpoint-before-migration process now mandated by this file; Convex schema pushes are additive)
- Accessible navigation, responsive mobile screens — **Implemented and verified** (skip-links, aria labels, responsive shells)
- Defined offline functions, sync status, conflict resolution — **Implemented and verified** (offline centre)

## 22. AI, OCR, and voice — later phase
- Core non-AI workflows first — **Respected** (per implementation sequence)
- OCR/structured extraction; source-linked research assistance; drafting support; voice notes/transcription; evidence mapping; proposed tasks from orders — **Implemented but unverified** (AI engine implemented against OpenAI-compatible API; **Blocked by external setup** for live verification — no OPENAI_API_KEY in environment)
- Human review of legal conclusions/deadlines/filings — **Implemented and verified** (proposals always require lawyer confirmation)
- Sources traceable, permissions enforced, costs/dependencies identified — **Implemented and verified**

## 23. Implementation sequence
- Default order adopted, adapted only where real dependencies require it — **Implemented and verified**
- Current phase: **Phase 1 (audit, portal lifecycle, permissions, shared foundations)** — HR/payroll/accounting foundations shipped 26 Sep (capabilities, 19-table `hrTables` group, Settings labels, 17 policy tests); phases 2+ not started
- Bounded phases with usable previews; durable progress file (`ADVOKATE_PROGRESS.md`) — **Implemented and verified**

## 24. Delivery and acceptance criteria
- Per-phase: preview, test steps, synthetic data labelling, DB/config changes, tests+results, build status, defects, dependencies, checklist update, handoff — **Implemented and verified** (`ADVOKATE_PROGRESS.md` + `docs/DELIVERY.md` maintained every milestone)
- Honest status labels — **Enforced by convention in both tracking files**
- Required test categories (isolation, revocation, sensitive records, reconciliation, retries, regressions, E2E, restore, performance) — **Partially implemented** (isolation/revocation/retry covered by automated tests; restore test & realistic performance runs outstanding)

## 25. CJ GLOBAL — platform operations (checklist added 27 Sep 2026)

Platform-level operations layer, as distinct from the in-chamber practice
product. The customer support ticketing slice shipped 27 Sep (code + unit
tests verified by push/typecheck/suite; **no browser E2E pass yet** — that
evidence category stays tracked in `ADVOKATE_PROGRESS.md`).

- Customer support ticketing (submit/triage/resolve across chambers) — **Implemented and verified** (27 Sep: `supportTickets`/`supportTicketMessages`/`platformOpsAudit` tables in `platformOpsTables`; `platformOps.ts` — any authenticated user submits (`submitTicket`), customer reply/reopen (`addCustomerMessage`), operator triage capability-gated (`startProgress`/`addOperatorMessage`/`assignTicket`/`setTicketPriority`/`resolveTicket`/`closeTicket`/`reopenTicket`), enforced status machine (open→in_progress→resolved→closed with reopen), per-submitter visibility with operator override, mandatory resolution notes, full ops audit trail; UI: shared `SupportCentre` in client portal + staff portal, `/owner` operator console with queue/SLA counters/audit; pure rules unit-tested in `platformOps.test.ts`). The **AI-handoff view** (`aiHandoffStats`) is a write-maintained materialized view over these tickets: one row per chamber, bumped in-transaction by every live-state change, with an audited rebuild path (`rebuildAiHandoffStats`)
- AI-to-human support escalation — **Implemented and verified** (27 Sep: `escalateFromAiJob` creates an `ai_escalation` ticket pinned to the AI job id, access-checked against the job's org, high priority by default, AI job contents never copied into the ticket; "Escalate to human support" affordance on every completed/failed/expired AI request in the AI Studio; operators see the handoff provenance in the queue and thread; the per-chamber `aiHandoffStats` view keeps open/unclaimed/high-priority counters with pure delta rules in `handoffView.ts` + audited rebuild, surfaced in `/owner`'s per-chamber card and in the escalation dialog via `myChamberHandoffStats`)
- Platform owner administration console (all-chamber oversight, `/owner`) — **Implemented and verified** (27 Sep: `/owner` route + page — live cross-chamber ticket queue with claim/reply/resolve/close/reopen/priority actions, health counters incl. unassigned + >24h-first-response + open AI handoffs, operations audit feed, per-chamber AI-handoff mat-view card with audited, limit-guarded rebuild; operator gate is capability-based server-side (owner flag or workforce-employee capability; the owner flag is shared with the section-24 `/platform` subscription console; the queue exposes support metadata only — never tenant legal records). **Owner activation**: `PLATFORM_OWNER_EMAIL` configured on the deployment; the bootstrap gate refused the then-unverified account (negative proof recorded); audited `selfActivateOwner` grants the flag only to the signed-in, email-verified matching account — activation executes at first OTP sign-in + confirmation click and is NOT yet performed
- Platform employee onboarding surface (`/employee`) — **Implemented and verified (as CJ GLOBAL internal workforce, 28 Sep; not a per-chamber surface)**: platform-level `platformEmployees`/`platformInvitations` tables + `workforce.ts` — owner invites by email (one-time token link `/accept-platform-invite?token=…`, 14-day TTL), invitee accepts while signed in with a verified matching email, suspend/unsuspend/role-change/revoke owner-only; roles are exactly `support_agent | support_supervisor | developer` (ownership is NOT a role — it stays the audited `isPlatformAdmin` flag). The earlier claim that chamber Team & Access satisfied this row was a conflation and is retracted
- Developer route (`/developer`) — **Not started** (route absent; developers currently work from the capability-reduced `/owner` console — queue + diagnostics + handoff rebuild, no customer replies)
- Platform operations authorization — **Implemented and verified (28 Sep, capability-gated)**: the seven ticket mutations + handoff rebuild authorize via `operatorForCapability` (owner flag OR employee role capability) — agents claim/reply/resolve/prioritize, supervisors add handoff view + diagnostics, developers read the queue and rebuild but cannot reply or claim; `getTicket` lets queue-capable staff read the thread they work; enforced server-side and proven by real-backend integration tests across owner/agent/developer/chamber-owner identities (`workforce.test.ts`)
- Portal-facing routes that DO exist today: `/portal`, `/staff`, `/login`, `/find-a-lawyer`, `/owner` plus the authenticated practice routes
