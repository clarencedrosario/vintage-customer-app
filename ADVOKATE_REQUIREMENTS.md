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

Last updated: 28 September 2026 (turn 7: **status precision + corpus integrity audit** — anchor-coverage audit found and fixed real extraction defects (Constitution anchors had pointed at the table of contents; same-number lettered sections such as IPC 124A/498A and Constitution 371A–371J were missing as anchors; CrPC § 329 was lost to out-of-order column flow) and re-ingested all 7 obtainable statutes as new immutable versions; scheduler-triggered ingestion now runs from the deployment's cron with persisted execution records; uncited-assertion detection added next to the citation validator; POCSO recorded precisely as "not obtained from sources attempted" with the full URL/error attempt log; source archive + migration manifest + secure model-configuration instructions + manual browser-verification checklist delivered as documents. Turn 6: real statute text ingested for 7 of 8 registered Indian sources with section anchors + PDF-hash provenance (POCSO honestly failed), bounded SCI judgments, backend citation validation with needs_citation_review gating, run state machine demonstrated, European register inclusion criteria, automated end-to-end research checks. **Status is a LIMITED collection:** corpus ingestion and automated citation checks are complete for the ingested slice only; model-backed answers, browser verification, and qualified legal review remain PENDING; section/anchor counts do NOT certify completeness or currency of consolidation). Evidence: `ADVOKATE_PROGRESS.md`, `docs/LEGAL_CORPUS_MIGRATION.md`, `docs/LEGAL_INTEL_MODEL_SETUP.md`, `docs/BROWSER_VERIFICATION.md`.

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
- MFA and session/device management — **Implemented and verified; REQUIRED for internal platform accounts** (28 Sep: TOTP + single-use hashed recovery codes; `requireInternalMfa` gates platform-ops mutations, workforce administration, and internal staff ticket reads; per-session challenge; the emailed sign-in OTP is authentication, NOT a second factor; customers and chamber accounts exempt — capability/ownership is checked before MFA so refusals never leak to non-internal callers; proven by real-backend tests in `internalMfa.test.ts` and the MFA-bound `workforce.test.ts` lifecycle)
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
- Required test categories (isolation, revocation, sensitive records, reconciliation, retries, regressions, E2E, restore, performance) — **Partially implemented** (isolation/revocation/retry/restore covered: the restore test is an AUTOMATED one-click drill since 30 Sep 2026 — archive → sandbox restore with count verification → purge → honest register, see restoreVerification.ts; realistic performance runs outstanding)

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

## 26. ADVOKATE LEGAL INTELLIGENCE — FLAGSHIP (added 28 Sep 2026)

CJ GLOBAL's core product requirement: a jurisdiction-aware legal AI
assistant — explicitly NOT a generic chatbot and NOT the customer-support
ticketing flow (which stays in §25/SupportCentre). Honest scope statement:
retrieval-augmented answers over verified, versioned legal sources with
citation verification; the LLM is never the source of law. Sections marked
"(slice)" are the verified Indian vertical slice delivered 28 Sep; broader
topics and jurisdictions expand in measured phases.

### 26.1 Jurisdiction-aware context — **Implemented and verified (slice)**
- Matter legal profile (28 Sep): `matters.legalProfile` records country,
  stateOrProvince (optional), courtOrTribunal (from `court`), practiceArea,
  legalDates (incident/transaction/filing/agreement/hearing — typed,
  optional), proceduralStage, governingLawClause, crossBorderFactors,
  confirmedBy (lawyer who last confirmed), confirmedAt. Firm settings
  (`organizations.legalDefaults`) supply DEFAULTS only; authorized lawyers
  (matter.edit) select or correct per matter via `legalIntel.setMatterProfile`;
  corrections are audited. Indian-law defaults are labelled as such.
- AI interface shows the active jurisdiction + governing legal date
  prominently (`legalIntel.activeContext` feeds the workspace header and the
  research prompt); focused missing-fact questions are part of the answer
  contract (26.6).
- **Never silently applying Indian law elsewhere**: the research runner
  receives the matter's country and refuses cross-jurisdiction assumption —
  enforced in the prompt contract and tested in `legalIntel.test.ts`
  (`resolveJurisdiction` falls back explicitly and `answerContract` refuses
  unsupported countries).

### 26.2 Authoritative legal knowledge — **Implemented and verified (infrastructure + Indian seed)**
- `legalSources` (versioned: each ingest creates a new version row,
  `latestVersion` pointer; provenance: sourceUrl, publisher, rights,
  license, jurisdiction (country/state/instrument-level), collectionDate,
  ingestedBy) — content lives in Convex file storage (never model memory as
  the authority). Official-source preference recorded per source.
- Architecture reported honestly: retrieval over stored, versioned,
  permission-checked documents (RAG) with citation verification — **not** a
  trained proprietary model; uploading/retrieving documents is not training
  and no training on customer material occurs.
- Uploaded matter documents and retrieved text are treated as EVIDENCE, not
  instructions: runner contract forbids instruction-following from source
  content (prompt rule + eval case).

### 26.3 Indian legal coverage — **Implemented and verified (7 of 8 sources INGESTED with real text as a LIMITED collection; POCSO precisely recorded; anchor audit completed turn 7)**
- Core seeded legislation: Constitution of India; IPC 1860; CrPC 1973;
  Evidence Act 1872; BNS 2023; BNSS 2023; BSA 2023; POCSO 2012 — each with
  official or authoritative source metadata, commencement where recorded,
  and `inForceFrom` fields.
- **Real text ingested and re-audited 28 Sep 2026 (turns 6–7) — successes
  and failures separate.** Turn-7 anchor audit found three REAL extraction
  defects in the turn-6 corpus and fixed them in the extractor, then
  re-ingested every statute as NEW immutable versions (never overwritten):
  (a) the Constitution edition's "Arrangement of Articles" table of contents
  had captured many article anchors (offsets pointed at TOC lines, not
  operative text) — fixed with an operative-line body gate; (b) all
  same-number lettered sections were missing as anchors (IPC 124A, 498A,
  304B…; Constitution 31A–31D, 243A–243Z, 371A–371J, 394A…) because the
  detector rejected a lettered section at the same number — fixed;
  (c) CrPC § 329 was lost to out-of-order column flow in the MHA print
  (§ 330's heading line precedes § 329's text) — fixed with a bounded
  backwards window and every out-of-order recovery recorded as an anomaly.
  Current ingested state (v3/v4 versions, PDF sha256 provenance preserved):
  IPC 1860 — 555 anchors to § 511; CrPC 1973 — 497 anchors to § 484;
  Evidence Act 1872 — 171 anchors to § 167; BNS 2023 — 358; BNSS 2023 —
  531; BSA 2023 — 170; Constitution — 480 anchors to § 395 (repealed
  articles absent = correct for a consolidated edition). Document tails
  checked — no truncation. **LIMITED-COLLECTION CAVEATS (deliberately not
  claimed):** anchor/section counts do NOT prove text completeness or that
  these are the current official consolidations; schedules, provisos and
  explanations are ingested as body text but NOT separately verified as
  complete; Constitution article suffixes were normalized to the printed
  variants. **FAILURE (precise):** POCSO 2012 — text NOT OBTAINED FROM
  SOURCES ATTEMPTED (not "unavailable anywhere"): eleven documented attempts
  across India Code (504, JS app shell, hanging deep links), SCI Sankalan
  API (0 bytes), WCD/mission-Vatsalya/NCPCR (shell/403/file-not-found),
  legislative.gov.in (404), web.archive.org (403/429), and login-walled or
  Cloudflare-gated mirrors — full log in
  `docs/evidence/pocso-attempt-log.txt`; retrieval NOT exhaustive, official
  mirrors may exist. Its registry row carries the attempt summary in
  `statusNote`; citations from it are BLOCKED by the validator; no text
  fabricated. State legislation, tax, family, employment and commercial
  texts are STAGED, not present.
- Historical versions preserved (`legalSourceVersions`; IPC stays in force
  for pre-01-Jul-2024 conduct under savings provisions — `applicability`
  logic resolves old vs new codes by the governing legal date within the
  relevant CODE FAMILY and records WHY).
- **Temporal applicability is reasoned, never a blanket date switch (turn
  6):** `resolveApplicability` returns `reviewFlags` for lawyer review —
  repeal-era savings around the matter date, a succeeding code commencing
  shortly after the matter date (current procedural stage may already sit
  under the new code), the within-two-years-of-commencement transitional
  window (s.358(2) BNS general savings; s.531(2)(a) BNSS and s.170(2) BSA
  pending-proceedings savings — section numbers verified against the
  INGESTED text, correcting a prior wrong section reference), mapped
  no-equivalent provisions, and special acts never displacing the general
  code. Flags surface in the workspace and the research answer; unresolved
  applicability is always labelled for lawyer review rather than silently
  resolved by one date.
- **IPC↔BNS cross-references are verified mappings, not blind substitution**:
  `legalCrossRefs` rows carry mappingKind (renumbered/renumbered_reworded/
  substantive_change/split/merged/no_equivalent), notes for changed wording
  and missing equivalents; `resolveApplicability` prefers the era-correct
  code and surfaces the cross-reference + differences rather than auto-
  replacing. Common abbreviations normalize gently with the official title
  shown (`normalizeCitation` — "ipc" → "Indian Penal Code, 1860").

### 26.4 All-European-country coverage — **Implemented and verified (register + explicit inclusion criteria); content ingestion staged**
- `legalCountryCoverage`: one row per country with per-domain statuses
  (legislation, judgments, procedure, tax, payroll, drafting) =
  not_started | partial | verified — a country appearing in a selector does
  NOT imply AI support; the workspace renders unsupported/stale states.
- **Inclusion criteria (defined 28 Sep 2026, turn 6):** the register lists a
  sovereign state when (a) it is broadly recognised as such, AND (b) it has
  a territory wholly or partly within the Council of Europe's geographical
  scope (Europe incl. the South Caucasus and Türkiye) or is a European
  microstate. Transcontinental states (Russia, Türkiye, Kazakhstan,
  Azerbaijan, Georgia) are included on their European territory; Kosovo is
  included with its partially-recognised status noted. The count of
  registered countries (51 incl. Kosovo) is a REGISTER fact, NOT a coverage
  claim: every European row is `not_started` for legal-data readiness until
  real ingestion happens country by country. Country entries and legal-data
  readiness are deliberately kept distinct.
- Instruments tagged national | subnational | eu_regulation | eu_directive |
  echre (CoE/ECHR kept distinct from EU institutions) | other. Legal systems
  within a country supported via stateOrProvince granularity. Seed: India
  legislation/procedure/drafting `partial` (7 statutes + 2 SCI judgments
  ingested; POCSO pending — see §26.8/progress log); European rows honestly
  `not_started` pending lawful ingestion.

### 26.5 Lawyer workflows — **Implemented and verified (slice: research + source search + applicability + cross-jurisdiction separation)**
- Natural-language research (existing `prepareLegalResearch`, now
  jurisdiction-aware), suggested provisions with applicability explanations
  (`resolveApplicability`), element→fact mapping is part of the answer
  contract, supporting AND adverse authorities required by the answer
  contract, evidence gaps + client questions generated when facts are
  missing, source-linked drafting (existing drafting kinds), document
  comparison + chronology extraction (existing `compare`/`chronology`
  kinds), cross-jurisdiction comparisons with per-jurisdiction separation
  (answer contract section rules).
- Factual assumptions labelled; supplied facts vs AI inference distinguished;
  NO outcome guarantees or success probabilities (runner contract + eval).

### 26.6 Verifiable answers — **Implemented and verified (contract + citation verification)**
- Nine-part answer contract (`buildAnswerContract` in `src/lib/legalIntel.ts`):
  jurisdiction+date, brief answer, applicable provisions, relevant judgments,
  application to facts, contrary authority/uncertainty, missing information,
  clickable sources with section/paragraph anchors, source freshness +
  coverage limitations. Enforced in the `legal_research` runner prompt.
- **Citation verification (BACKEND CODE, turn 6 — not only the prompt)**:
  the runner extracts cited stable keys, pinpoints and quotations from the
  generated text (`extractCitations`, unit-tested), re-reads the STORED
  source text via `storedSourceForCheck`, and runs the pure
  `checkCitation` validator: source existence, pinpoint/anchor validity
  against section boundaries, and quote fidelity (whitespace-normalized)
  with the passage offset for the clickable link. Every check is persisted
  (`legalCitationChecks`, `citationReportForJob`); any failure flips the
  answer to `needs_citation_review` with a blocking banner prepended before
  the result is ever presented as verified. `verifyCitations` remains the
  interactive path. Whether a verified passage SUPPORTS the claim is a
  separate legal judgement — labelled for lawyer review, never automated.
- **Uncited assertions are flagged too (turn 7):** `detectUncitedAssertions`
  (pure, unit-tested, wired into the runner beside the citation checks)
  flags substantive sentences — "shall/must/liable/punishable/held that…"
  — that carry NO citation marker, so an answer cannot pass with verified
  citations in one paragraph and unsupported legal claims in another.
- **Invalid citation markers are flagged too (turn 8):**
  `invalidCitationMarkers` (pure, unit-tested, persisted as failed checks
  by the runner) catches plausibly-formatted markers that reference
  NOTHING verifiable — "[IPC § 302]", "[BNS 2023, s.103]", bare
  reporter cites (AIR/SCC/SCR) — so a wrong marker cannot pass as
  "cited" merely because a marker exists.
- **Real research workflow (turn 8):** `prepareLegalResearch` (matter
  access + note.write required) records on the job: the question,
  a frozen `legalSourceVersions` snapshot (ONLY sources with real ingested
  text — stubs excluded, so an answer cannot cite text the corpus lacks),
  and `clarificationQuestions` output — focused questions asked ONLY when
  missing facts change applicability (unknown governing date, unconfirmed
  jurisdiction, missing procedural stage on Indian matters). `retryJob`
  re-runs a failed/expired request WITHOUT losing the question, snapshot
  or clarifications; `listJobs`/`getJob` expose the saved history for
  reopen. Provider-unavailable runs fail honestly ("Live AI is not
  configured") — never simulated answers. Access verified: unauthenticated
  rejected, cross-tenant read returns null + mutation/report throws.
- **The clarification gate is a real gate (turn 9; live-verified turn 10):**
  when facts that change applicability are missing, the shared submission
  core stores the job as `blocked_clarification` and NEVER schedules the
  runner — merely displaying clarification cards was insufficient. The
  LABELLED RESUME PATH (clarified turn 10): supply the facts on the matter
  profile, then press "Retry after updating the matter" — `retryJob`
  recomputes the gate through the same shared core; facts supplied → the
  job runs; still missing → it is re-parked with refreshed questions.
  Only PENDING jobs and blocked NON-research jobs refuse retry. Verified
  live on 29 Sep: submission on a profile-less matter → blocked with 3
  focused questions; after facts supplied the same core produced a
  pending job that reached the runner.
- **Authorization re-checked at runner time and on every read (turn 9,
  live turn 10):** `claimPendingJob` re-verifies the requester's
  membership status BEFORE the claim wins — a suspended/removed
  requester's scheduled run fails honestly with "no longer has access"
  and the model is never called. Provenance/report queries
  (`sourceVersionsForJob`, `citationReportForJob`) keep enforcing org +
  matter membership at read time, and the public mutations keep refusing
  identity-less calls (observed live: "Sign in and select an
  organization").
- **Retry cannot duplicate execution (turn 9):** pending and
  blocked_clarification jobs refuse retry; retries recompute the gate and
  usage cap, and execution is guarded by the existing `aiJobClaims`
  occurrence-key table — a second concurrent claim with the same key
  loses, so the model can never run twice for one request (regression
  tested).
- **Zero-check answers can never show a success banner (turn 9; live
  turn 10):** `citationReportForJob` reports `unchecked`
  (allVerified=false) when no usable checks exist, and the UI renders an
  explicit amber "NOT passed any citation checks" banner in that state —
  success text appears only on a strictly-positive verified report.
  Live-verified with fabricated-quote + un-ingested-source (POCSO) rows
  attached to a real job: report = 2 checks, 2 failed, anyVerifiedAll
  = false.
- **POCSO stays blocked (turn 8):** `storedSourceForCheck` treats the
  `[INGESTION PENDING]` stub as NOT ingested, so citations from
  un-ingested sources are validator-blocked until real text arrives.
  Scope honesty: existence + quote-fidelity + uncited-assertion +
  invalid-marker checks together establish the answer cites REAL stored
  text and leaves no naked or wrongly-marked substantive claims; they do
  NOT establish that any cited passage legally supports the conclusion —
  that remains a lawyer judgement.
- **Refusal with honesty**: when insufficient reliable sources exist the
  contract requires saying so and offering verified material only — never a
  confident unsupported answer (runner rule + eval case).

### 26.7 Precedent & judgment treatment — **Partially implemented (register + provenance + BOUNDED REAL JUDGMENTS ingested); subsequent-treatment ingestion staged**
- **Bounded real judgments (28 Sep 2026):** two Supreme Court of India
  judgments retrieved as full PDFs from official government hosts and
  ingested as paragraph/page-anchored bounded excerpts with court, bench,
  decided date, citations as printed in the retrieved document, source URL
  and PDF sha256: Tofan Singh v. State of Tamil Nadu (29 Oct 2020,
  NARCORD/gov.in copy; 43 paragraph anchors — reporter citation not printed
  on the document, so none was invented) and K.M. Nanavati v. State of
  Maharashtra (24 Nov 1961, AP High Court portal copy; 4 page anchors —
  1961 judgments are not paragraph-numbered). India coverage `judgments`
  status honestly moved to `partial` (bounded excerpts of 2 judgments, NOT
  a case-law corpus).
- Judgments are first-class `legalSources` with court, bench, date,
  citation, procedural posture fields and binding/persuasive determination
  per jurisdiction rules (pure helper provided; per-country binding rules
  expand with each jurisdiction).
- Overruled/reversed/distinguished/questioned status requires supporting
  source evidence — the model allows the status only with a citation to the
  treatment source; "no negative treatment found in available sources" is
  distinct from "confirmed good law" and is labelled as such. Holding vs
  submissions vs narrative vs AI interpretation separated in the answer
  contract. Automated subsequent-treatment ingestion is STAGED.

### 26.8 Continuous updates — **Implemented and verified (run state machine DEMONSTRATED on the live deployment); live source feeds staged**
- `ingestionRuns` (per source: detected change, retries, failure alerts to
  platform audit, version creation, index refresh timestamp, review queue
  for uncertain changes, lastSuccessfulAt) + `runIngestionSweep` scheduled
  action and `recordIngestionResult`/`recordResultCli`. Change-detection
  fetchers per upstream official source are STAGED (needs lawful source
  agreements); the pipeline, limits, audit and staleness surfacing are live.
  No real-time completeness is promised; stale/unavailable sources warn in
  UI. Historical research reproducible via saved versions + the governing
  legal date.
- **Demonstrated 28 Sep 2026 (real run rows, live deployment):** real
  statute text ingested for 7 of 8 registered sources (v2 immutable
  versions + freshness timestamps), POCSO 2012 recorded as FAILED with a
  specific reason and review note (India Code host HTTP 504; no text
  fabricated), BSA re-ingest closed a scheduled run at attempts=2 after
  openRun duplicate prevention skipped the racing second enqueue
  (skipped=true), and freshness (`collectionDate`, `lastSuccessfulAt`)
  updated only through the run state machine — not by table existence.
- **Scheduler-triggered execution DEMONSTRATED (turn 7, real trigger +
  real records):** `crons.ts` registers
  `legal-source-ingestion-sweep` (daily 00:00 IST →
  `internal.legalIntel.scheduledSweep`); the scheduler FIRED it on the live
  deployment at 2026-09-28T18:30:52Z opening 10 run rows, and a second
  scheduled-path execution at 19:04Z demonstrated duplicate prevention
  (opened=0, skipped=10). Every execution writes a `legalSweepLogs` row
  (trigger=schedule|manual, opened/skipped counts, run ids) — the record
  that distinguishes a scheduler-triggered run from a manual retry.
  **Honest scope:** no automated fetcher exists; a scheduled run OPENS run
  rows (deduped) which are CLOSED by explicit authenticated ingestion.
  Automatic change-detection updates remain STAGED pending lawful source
  agreements; scheduled retries alone are not claimed as automatic updates.

### 26.9 Confidentiality & human review — **Implemented and verified (enforced via existing permission model)**
- Permissions enforced BEFORE retrieval and generation (same
  requireAccess/canViewMatter rules as all AI kinds — no new data path).
- Cross-firm leakage prevented by org-scoped queries on sources, indexes,
  caches and logs (orgId-scoped tables; no cross-org retrieval path).
- No training on customer legal material by default; provider handling/
  retention documented in the AI section (§18 notes; provider DPA status
  recorded when a live key is configured).
- Lawyer approval gates unchanged for sends/filings/deadline changes;
  monetary calculations route through versioned payroll/accounting functions
  (existing), never free-form model arithmetic.

### 26.10 Lawyer-facing interface — **Implemented and verified (slice)**
- `/legal-intel` workspace: jurisdiction + legal-date selector, matter
  context selector, research mode (existing AI pipeline) and **source search
  that works without AI generation** (verified stored sources, highlighted
  statutes, era-correct applicability badges), answer/source panes
  (contract-structured), clickable provision anchors, saved-research linkage
  via existing AI jobs, visible unsupported-country/stale-source states,
  feedback/correction reporting recorded to platform-adjacent audit.
- Drafts and inferred conclusions labelled; unsupported coverage states
  explicit — never a generic chat box.

### 26.11 Quality evaluation — **Implemented and verified (harness + seed set + automated E2E on real ingested text); lawyer-reviewed sets pending**
- `legalEvalCases` + runner structure measuring: citation accuracy (only
  real seeds cited), source support, jurisdiction/historical applicability
  (IPC-vs-BNS by date), adverse-authority recognition, missing-fact
  handling, refusal-to-invent, confidentiality/instruction-resistance
  (prompt-injection-in-document case). Adversarial cases included:
  outdated statutes, conflicting decisions, wrong-country questions,
  user-supplied false citations, unavailable sources.
- **Automated end-to-end check on REAL ingested material (28 Sep 2026):**
  `researchDryRun` (internal, no LLM) drives jurisdiction → governing date
  → retrieval of actual provisions (pinpoint anchors) → era applicability
  with review flags → grounded answer with passage offsets → `checkCitation`
  verification, over the deployed corpus. Verified live: pre-BNS date
  retrieves IPC § 302 with a quote-verifying passage; post-BNS date
  retrieves BNS § 103; France refuses inside the same pipeline. Evidence
  tiers stay separated: this is AUTOMATED evidence; LLM generation
  (OPENAI_API_KEY absent on the deployment) and browser verification are
  PENDING; qualified legal review is PENDING and is never simulated.
- **Software tests passing ≠ legal accuracy.** Results are published as
  internal readiness evidence; NO "smartest AI" claims. Lawyer-reviewed
  evaluation sets per enabled jurisdiction: PENDING (operator work).

### 26.12 Delivery & priority — **Adopted (this section re-ranks the roadmap)**
- Flagship workstream alongside platform reliability. Verified Indian
  vertical slice shipped 28 Sep: question → jurisdiction/date selection →
  verified retrieval → source-linked answer contract → lawyer inspection of
  cited passages. Expansion order: more Indian topics → EU instruments →
  country-by-country European verification. Coverage, update status, test
  results and dependencies are reported from actual data (coverage rows,
  ingestion runs, eval results) — never asserted.


## 27. ADVANCED MATTER INTELLIGENCE & AI LEGAL ASSOCIATE (added 30 Sep 2026)

- **27.1 Matter workspace & source-linked facts** — **Implemented (deterministic slice, review-gated)**: `matterFacts` carry explicit epistemic status (allegation / extracted / disputed / confirmed / rejected) with page/paragraph pinpoints; analyses extract dates, parties, obligations, amounts (tested integer-paise math, never model arithmetic), issues, duplicates, missing information. Lawyer-only paths: confirm / reject (reason recorded) / correct. Correcting a CONFIRMED fact never overwrites it — the correction enters as a competing extracted row, the pair is flagged, and a lawyer resolves; unconfirmed typo fixes supersede directly. Every state change lands in `matterFactRevisions`.
- **27.2 Advokate AI associate** — **Implemented (deterministic + citation-checked)**: versioned matter summaries built ONLY from confirmed facts with allegations labelled; per-version `inputsHash` means older versions go stale (never deleted) when sources change; findings (obligations / missing clauses) each carry passage + explanation + suggested next step. Citation machinery (quote verification) is reused from the Legal Intelligence core — quote-match ≠ conclusion-support is stated to the lawyer. No "zero hallucination" claims; unsupported findings are withheld.
- **27.3 Governed template library** — **Implemented (honest seed: 6 templates, jurisdiction "in" across five practice areas; long-term target 300+ reported as an ACTUAL count via templates.stats, never claimed in advance)**: each template carries type/practice area/jurisdiction/version/review date/author-source/usage-rights/required fields/approval status/instructions/limitations. Prefill uses ONLY confirmed facts or matter fields (provenance-tagged); gaps stay visible {{PLACEHOLDER}}s — nothing is invented. Optional clauses, template-vs-draft comparison, HTML print/PDF + Word-openable export, partner approval gate. Google Docs sync: **blocked — no credentials/integration access**; drafting and export remain usable and sync is labelled unavailable.
- **27.4 Knowledge vault** — **Implemented (extends existing knowledge module)**: kinds expanded (argument, playbook, hearing_strategy, checklist, matter_lesson) with jurisdiction/court/issue/practice-area/doc-type/outcome tagging and public-source vs firm-confidential separation. Ethical walls enforced during search AND suggestion retrieval; precedent suggestions state their match reason and label firm arguments as the firm's own (never a court's ruling). Outcome analytics define the denominator (tagged entries only), separate settlements/withdrawals/pending/partial, show sample size + missing data, and carry an explicit not-a-prediction caution.
- **27.5 Tasks/hearings/calendar automation** — **Implemented (proposal + approval slice)**: suggestions from reviewed analyses (missing material) and orders (un-done directions), duplicate-safe against open tasks; approval creates the real task (with assignee/due date), dismissal records a reason. Proposed dates carry a stated calculation basis and are never treated as lawyer-verified deadlines. Cause-list import/matching and two-way calendar sync remain **staged** (existing manual cause-list module retained).
- **27.6 Security & lawyer control** — **Enforced in code**: every AI surface re-checks org + matter access (cross-tenant read AND write tested); no cross-firm retrieval; provenance + version history + audit retained; the AI proposes/drafts/explains but has NO path to file, send, pay, or change permissions — those remain separate human-approved workflows. DPDP/privacy review and legal-compliance review remain OUTSTANDING (recorded, not claimed).
- **27.7 Acceptance workflow** — **Automated end-to-end test passes**: upload synthetic document → extract source-linked facts → lawyer review (confirm/reject/correct) → contradiction scan + lawyer resolution → stale-marked versioned summary → template prefill with visible placeholders → task suggestion approved into a real task. Test categories exercised: extraction pinpoints, disputed facts, stale summaries, cross-tenant denial, prefill accuracy, duplicate tasks, human-approval boundaries. Browser verification pending as usual; qualified legal review separate and outstanding.
