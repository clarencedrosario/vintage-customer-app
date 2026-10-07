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

Last updated: 1 October 2026 (turn 17: **official-source connector** implemented, pushed and demonstrated end-to-end on a real source — per-source inspection reports, five-way implementation distinction, separated evidence categories, real retrieval + repeat-import dedupe, honest scheduler status; full record in `docs/OFFICIAL_SOURCES.md`. Sequence note: connector work was user-prioritized ahead of §32 Phase 6; Phases 6–12 remain pending. Previous major update: 28 September 2026 (turn 7: **status precision + corpus integrity audit** — anchor-coverage audit found and fixed real extraction defects (Constitution anchors had pointed at the table of contents; same-number lettered sections such as IPC 124A/498A and Constitution 371A–371J were missing as anchors; CrPC § 329 was lost to out-of-order column flow) and re-ingested all 7 obtainable statutes as new immutable versions; scheduler-triggered ingestion now runs from the deployment's cron with persisted execution records; uncited-assertion detection added next to the citation validator; POCSO recorded precisely as "not obtained from sources attempted" with the full URL/error attempt log; source archive + migration manifest + secure model-configuration instructions + manual browser-verification checklist delivered as documents. Turn 6: real statute text ingested for 7 of 8 registered Indian sources with section anchors + PDF-hash provenance (POCSO honestly failed), bounded SCI judgments, backend citation validation with needs_citation_review gating, run state machine demonstrated, European register inclusion criteria, automated end-to-end research checks. **Status is a LIMITED collection:** corpus ingestion and automated citation checks are complete for the ingested slice only; model-backed answers, browser verification, and qualified legal review remain PENDING; section/anchor counts do NOT certify completeness or currency of consolidation). Evidence: `ADVOKATE_PROGRESS.md`, `docs/LEGAL_CORPUS_MIGRATION.md`, `docs/LEGAL_INTEL_MODEL_SETUP.md`, `docs/BROWSER_VERIFICATION.md`.

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

## 28. INDEPENDENTLY DEVELOPED LEGAL WORKSPACE FEATURES (added 30 Sep 2026)

Functional specification implemented as original Advokate functionality owned or appropriately licensed by CJ GLOBAL. No competitor source code, prompts, templates, documentation, marketing text, screenshots or distinctive interface designs were used; neutral working module names are not represented as trademark-cleared. Provenance register: `docs/PROVENANCE.md` + in-app `thirdPartyProvenance` register.

- **28.1 Originality & third-party rights** — **Implemented (register + seed)**: `provenanceRegister.ts` seeds the per-org register with the ACTUAL runtime dependencies (react/react-dom/react-router MIT, @noble MIT, @convex-dev/auth Apache-2.0, lucide ISC, tailwind MIT, recharts MIT, zod MIT, framer-motion MIT) plus in-house template content (`proprietary (CJ GLOBAL)`). The Convex source-available licence is **flagged_for_review, not cleared**. Idempotent seed; owner/admin-only status updates; notices recorded per entry. No guaranteed-non-infringement or patent/trademark-clearance claims made anywhere.
- **28.2 Matter workspace & background extraction** — **Implemented (turn 13 + 14)**: source-linked statements carry document/version pinpoints and epistemic labels (allegation / extracted / disputed / confirmed); extraction runs through the visible processing queue (queued → running → done/failed with attempts, lastError, optional batch label, retry) via `matterIntelligence.requestAnalysis / runQueuedAnalysis / processingQueue`. Lawyer-confirmed information is never silently overwritten — corrections create competing rows + revisions.
- **28.3 Case timeline** — **Implemented and verified**: `caseTimeline.ts` proposes entries from analyses with date-kind classification (event / document / filing) and precision labels (exact / approximate / uncertain); lawyers approve, correct (new version, old row superseded and retained), merge (source refs absorbed), or reject (reason recorded); approval history in `matterTimelineRevisions`. Approval binds the entry to a hash of the CURRENT SOURCE TEXT + title/date; when a source row's text changes, `flagAffectedBySourceChange` flips affected APPROVED entries to `needs_review` — the accepted chronology is never silently rewritten. Lawyers can also add entries directly (`proposeEntry`, provenance `lawyer`).
- **28.4 Matter review dashboard** — **Implemented and verified**: `health` indicators are documented deterministic rules with visible inputs — now 8: overdue tasks, unresolved contradictions, unreviewed extraction, stale summaries, **unreviewed orders, missing evidence (analyses' missing-information flags), upcoming hearings (14-day window), unanswered client document requests** — with `rulesVersion: "v1"` and an explicit operational-health ≠ legal-merits note; no probabilities, no unexplained scores (regex-tested).
- **28.5 Source-linked matter brief** — **Implemented and verified**: `matterBriefs.ts` proposes versioned briefs (procedural position from the matter's legal profile; key facts ONLY from lawyer-confirmed facts with source refs; disputed/allegation points labelled NOT established; recent developments from APPROVED chronology entries only; outstanding questions from extraction flags; proposed next actions as suggestions). `inputsHash` staleness: regenerating with unchanged inputs returns the existing version honestly ("unchanged"); changed inputs create a new proposed version, mark prior versions stale (never deleted), and record `changesFromPrior`. Stale versions CANNOT be approved; lawyer approval is the only path into the record; `interpretationNote` distinguishes verified quotations from machine-assembled interpretation and states that reviewing sources reduces but does not eliminate error.
- **28.6 Argument & evidence review** — **Carried by existing modules** (fact register with contradiction scan + resolution; knowledge vault with match reasons; adverse/superseded-fact pairing) — lawyer owns strategy; speculation is labelled, never presented as established fact.
- **28.7 Drafting workspace** — **Extended and verified**: on top of the governed template library (6-template honest seed, actual-count reporting), `draftingRevisions.ts` adds proposed edits as true diff pairs (excerpt must EXIST in the current draft; duplicates collapsed; reason required; risk level), lawyer accept (applies replace + snapshots `bodyBefore`), reject, and undo (restores the exact prior body; revision row retained — traceable, not an erasure). `draftRiskComments` pin potential-risk flags (excerpt/concern/reason/source key) that resolve to addressed/dismissed and never auto-edit the draft. "One-click improvement" = a lawyer-approved proposed edit, nothing autonomous. DOCX/HTML export existing; Google Docs sync remains **blocked** (no credentials) and is labelled unavailable.
- **28.8 Firm reference library & historical outcomes** — **Carried by knowledge module** (turn 13: tagging, ethical walls, firm-argument-vs-ruling labelling, outcome analytics with defined denominator + sample size + not-a-prediction caution).
- **28.9 Daily work and calendar** — **Implemented and verified**: `dailyPriorities.priorities` consolidates the firm's ACTUAL items per matter-day — overdue tasks + open overdue deadlines, scheduled hearings within a configurable window (cancelled/adjourned excluded), upcoming open deadlines, unreviewed orders, unanswered client requests (status `requested`), and AI proposals awaiting approval — with AI-proposed and extracted dates (proposed timeline entries, suggestion `dueBasis`) kept in SEPARATE, clearly labelled buckets so a machine-proposed date is never displayed as a lawyer-verified deadline. Cause-list import + two-way sync remain staged (authorized-API basis required).
- **28.10 Security, privacy & audit chain** — **Implemented and verified**: tenant isolation extended to every new surface (cross-tenant read AND write denied by test, including the drafting path); `auditChain.ts` adds a hash chain over `auditLog` (seq = max+1 per org, prevHash linkage from genesis, entryHash = sha256(prevHash|seq|actorId|action|detail|createdAt)); `verify` walks the chain and reports seq breaks, linkage breaks, recomputed-hash mismatches (tamper detection) and unchained legacy rows; `backfillLegacy` folds pre-chain rows in createdAt order. Positioned honestly as **tamper-EVIDENT, not immutable** — the database remains the trust root. DPDP/privacy assessment: **OUTSTANDING**, recorded in `docs/DPDP_REVIEW.md` with deployment facts (shared infrastructure, logical isolation, no residency claim) and gap list; no compliance claim made.
- **28.11 Human approval boundaries** — **Unchanged and enforced**: the AI proposes, drafts and explains; filing, signatures, legal communications, payments, permission changes and consequential-deadline confirmation remain human-only, permission-gated workflows.
- **28.12 Delivery & verification** — **Automated**: `workspace28.test.ts` (8 tests) covers the timeline lifecycle incl. source-change review flagging on corrected entries, brief generation/staleness/changesFromPrior/approval-gate, revision accept→undo restoring the exact prior body, audit chain backfill + tamper detection (modified row breaks verification at the exact seq), daily priorities composition (cancelled hearings excluded; AI proposals separate), provenance seed honesty + idempotence, extended health indicators with rulesVersion, and cross-tenant denials across briefs/drafts/timeline/priorities. Suite at turn 14: **35 files / 539 tests green**; `convex dev --once` push + `tsc -b --noEmit` clean. Browser verification and DPDP/legal review remain **BLOCKED/OUTSTANDING** and are labelled as such.

## 29. INDIA-SPECIFIC CAPABILITIES (added 30 Sep 2026)

Indian privacy/governance, court connections, drafting, and source-verified AI — implemented on the existing modules with CJ GLOBAL-owned code and original designs; no competitor code, templates, wording, branding or proprietary workflows used. Product name remains **Advokate Legal Intelligence**.

- **29.1 Indian privacy & data governance** — **Implemented (register + workflows)**: DPDP commencement facts verified from official-source-derived records (Act gazetted 11 Aug 2023; Rules 2025 notified **13 Nov 2025, G.S.R. 846(E)**, phased to full effect by 13 May 2027 — mid-phase today) and recorded in `docs/DPDP_REVIEW.md` §0. In-product compliance implementation register (`dpdpRegister`, 10 seeded requirements) per requirement × activity: official source, effective date, controls, evidence, `legalReview: outstanding` default, responsible-person/review-date fields. Data-principal request workflow (access/correction/erasure/grievance with due dates + human resolution); consent records where consent IS the basis (withdrawal stops future consent-based processing and opens an erasure REVIEW that must record its retention basis — never silent erasure); incident register with containment + notification trail (dates + human-stated basis). The register explicitly records that consent is NOT the only lawful basis (S.7 legitimate uses row) and that no software setting establishes legal compliance.
- **29.2 Data location & residency** — **Implemented (inventory + honest gate)**: `dataLocations` inventory covers primary DB, documents, backups, search/embeddings, AI processing, logs, email, payments and support access — every region seeded `unverified` (verified only via the explicit `verifyRegion` human step; no extrapolation from the main database). Per-org policy: default `record_only`; `restrict_in` (only when law/contract/customer policy actually requires India-only) BLOCKS processing in services not verified in-region via `assertProcessingAllowed` and logs every block — no silent transfers. `docs/DATA_LOCATIONS.md` states the isolation model (logical, shared infrastructure) and forbids advertising residency the stack cannot guarantee; no universal India-only obligation is assumed.
- **29.3 Tenant & matter isolation** — **Extended**: every new surface (DPDP registers/requests/consents/incidents, residency inventory/policy, court sources/listings/matching, draft review) is org-checked server-side; cross-tenant read-empty AND write-refused tests added for each (rival org cannot confirm/reject matches, complete legal reviews, verify regions, or see listings). Isolation described accurately (logical, not dedicated); no claim that architecture alone guarantees legal privilege.
- **29.4 Indian court & cause-list connections** — **Implemented (extensible registry)**: `courtSources` registry (seed: SCI / High Courts / District Courts — extensible) records official source + AUTHORIZED access method (official_api | permitted_download | manual_upload | reviewed_entry), supported info, refresh schedule, last-check status/error, and limitations. No CAPTCHA or access-control bypass exists anywhere; manual upload/reviewed entry are labelled as such; NO nationwide live-sync claim is made anywhere.
- **29.5 Case matching & court updates** — **Implemented and verified**: imports preserve the original record, source key, retrieval timestamp and republication chain (changed publications supersede — stale rows preserved; identical re-publications collapse). Matching: CNR (4 letters + 12 digits, format-checked) and case number + year → `identifier_exact`; number without year → `identifier_partial`; party names alone → `suggested` ONLY (never confirmed, never consequential). Confirmation/rejection/conflict states are lawyer actions; a listing disappearing from a cause list is never auto-cancelled (human review states only).
- **29.6 Calendar & action suggestions** — **Implemented and verified**: only lawyer-CONFIRMED matches apply to the calendar (duplicate-safe; one hearing per listing; published listing date stored as a hearing, never as a lawyer-verified legal deadline); order records generate proposed tasks through the existing `taskSuggestions` approval flow with source passage, rationale, due-date basis and required review; cause lists are never treated as a filing-deadline source. Dashboard reports new / reviewed / conflicting / stale / failed counts + recent items.
- **29.7 Original Indian drafting library** — **Extended (6 → 10 templates, actual reviewed count)**: added execution application (Order XXI), board resolution for bank account (corporate), advocate engagement letter (practice management), and application u/s 156(3) Cr.P.C./S.175(3) BNSS — all authored in-house with jurisdiction, forum, type, version, review-date field, required fields, provenance and limitations. The 300+ target remains reported as an ACTUAL count (`templates.stats`); no external collection imported.
- **29.8 Matter pre-fill & draft review** — **Implemented and verified**: prefill remains confined to lawyer-approved matter data (provenance-tagged; gaps stay visible placeholders). NEW `draftReview.ts` analyses drafts in three SEPARATED layers: formatting (unfilled placeholders, cross-reference verification, definition-structure signals), factual (draft dates/amounts conflicting with the confirmed fact register; unpopulated required fields), legal (advisory passage-anchored signals — e.g. interest without rate/period, WP-language mixing, S.138 sequence gaps — each explicitly requiring lawyer assessment against applicable sources; no conclusions asserted). Fixes go through the governed revision flow (diff + reason + accept/reject/undo — nothing silently rewrites accepted documents); legal findings are recorded as risk comments, not edits.
- **29.9 Google Docs integration** — **Blocked (unchanged, labelled)**: no credentials/API access; in-app drafting + DOCX/HTML export remain usable. Nothing simulates synchronization.
- **29.10 Source-verified Indian legal AI** — **Carried + verified**: matter-document assertions retain document/version pinpoints and quoted passages with extraction/review status (fact register); legal propositions cite the legalIntel corpus with backend quote verification (`legalIntel.verifyCitations`); allegation/witness/documentary/court-finding/confirmed/inference distinctions live in the fact-status model; jurisdiction/date handling via matter legal profiles + corpus applicability. Quotation match ≠ factual truth/legal applicability/admissibility is stated in the surfaces; no hallucination-elimination claims.
- **29.11 Human-controlled consequential actions** — **Unchanged and enforced**: the AI has no path to file, sign, send legal communications, pay, grant permissions, or confirm consequential deadlines; payments keep their existing human-authorized controls (provider confirmations unchanged); consequential approvals record who approved and what.
- **29.12 Audit, verification & delivery** — **Automated**: `indiaCapabilities.test.ts` (10 tests): registry seeding + authorized-method assertions; CNR-exact / partial / name-only-suggestion ladder incl. WRONG-MATTER guard and the refusal of name-only suggestions to self-apply; duplicate collapse + changed-publication supersession (stale preserved, unappliable); confirmed-order task proposals; dashboard states; DPDP register sourcing/phases + request lifecycle + consent-withdrawal→erasure-review + incident trail; residency inventory honesty + verified-region path + `restrict_in` gate refusing and logging an unverified service while allowing a verified one; three-layer draft review (formatting/factual/legal) with governed fix + undo + risk-comment path; library 6→10 with new practice areas; cross-tenant denials across all new surfaces. Suite at turn 15: **36 files / 549 tests green**; push + typecheck clean. Browser verification, live court connectivity and qualified legal/DPDP review remain BLOCKED/OUTSTANDING and labelled.

## 32. LEGAL-INTELLIGENCE & PRACTICE-MANAGEMENT ENHANCEMENTS (added 30 Sep 2026)

Twelve-phase extension programme on the existing modules. Dependency order: conflicting-evidence review → evidence bundles → adverse-authority recheck → matter-impact alerts → the rest. Deployment for this programme: moonlit-elk-307 (re-verified each turn, never assumed). Git is Vly-managed in this environment (recoverability via platform version control; no data migrations — additive schema only).

**Sequence reconciliation (1 Oct 2026):** after Phases 1–5, the user redirected priority to official-source integration BEFORE Phase 6. That work is recorded below as **32.17** (connector programme, turn 17, with `docs/OFFICIAL_SOURCES.md` as the full evidence record). Phases 6–12 are UNCHANGED and remain pending; nothing in the connector work substitutes for them.

**§32 user-facing UI (turn 25).** All twelve §32 backend programmes now have their user-facing screens, wired into the existing router/shell (no new routes): rows 1–4 + 7-matter-card → Matter file **Review (§32)** tab; row 5 → Matter **Filing** tab; row 6 → Matter **Documents** tab redaction section; row 9 → Matter **Translations** tab; row 10 → Matter **Client updates** tab; row 7 → **Conflicts desk** (`/conflicts`) Walls & holds section (org-wide walls with per-wall emergency-grant history + revoke, holds, matter-level place/lift in `MatterHoldCard`); row 8 → instruction-defence banner + signals in the shared AI job view (`AiStudio.tsx`); row 11 → firm dashboard at the bottom of `/ai`, platform dashboard at the top of `/platform`; row 12 → **Settings** Export & exit section (job lifecycle, included-parts vs omitted-records manifest view, verification failures shown before any success labelling, single-use downloads, hold-aware close, verbatim reauth refusals). Every capability gate is mirrored only for honest disabled states — the server re-checks everything. Drift tests pin UI literal unions to backend validators (group1/3/4 tests). STATUS SEPARATION per the reporting rules: backend **implemented + automated tests green**; UI **implemented + typecheck 0 + suite green**; browser verification **PENDING** (`docs/S32_BROWSER_SCRIPT.md` Groups 0–4, manual steps — browser automation unavailable this session); live third-party integration **NOT VERIFIED** (no OPENAI_API_KEY — dashboards show honest `liveModelConfigured:false`); legal review **PENDING**. Connector work (32.17) remains recorded as outstanding in its own row above.

**Turn 26 (6 Oct 2026) — completion language, connector advancement, AI config readiness.**
(1) **Corrected completion language adopted** as the reporting rule for every artifact: state exactly "backend and UI implemented; automated checks passed", and keep **browser verification**, **live provider execution**, **live source-connector scheduled verification**, and **legal review** as SEPARATE pending statuses. No turn record claims all acceptance criteria passed; the readiness table below is the single summary.
(2) **eGazette connector (32.17) advanced from refused to working.** Root cause of the turn-17 TLS refusal: egazette.gov.in serves an INCOMPLETE chain (leaf + YR2 intermediate only); Node's global fetch cannot carry extra trust anchors. Resolution WITHOUT disabling anything: `src/convex/gazetteCa.ts` pins the PUBLIC Let's Encrypt/ISRG root + intermediates (re-derivable from the chain's own AIA URLs) and a node:https GET helper; certificate verification stays fully enabled; no login/CAPTCHA/access-control bypassed. New notice `in:rules:dpdp-2025` (DPDP Rules 2025 English gazette PDF, G.S.R. 846(E)) + 9th registry row (kind `rules`). **Live on moonlit-elk-307**: scheduled-path fetch → `updated` v2 `hh7zwadhdkne600vdmgkyn5h1h8frc95`, 118,579 chars, 23/23 sections; repeat → `unchanged` (dedupe). **Cron-fired connector executions OBSERVED** (POCSO daily schedule runs Oct 1–5, `lastCheckedAt` = Oct 5 17:45:30 UTC, all unchanged). POCSO text is IN the corpus (v2, citable); DPDP Rules text likewise IN the corpus as of turn 26 — the corpus never contained fabricated placeholders for either.
(3) **8-workflow browser walkthrough** written into `docs/S32_BROWSER_SCRIPT.md` (prioritized P1–P8, exact routes/roles/expected results) — **marked NOT EXECUTED**; browser tooling unavailable.
(4) **AI config readiness**: the generation code reads exactly `process.env.OPENAI_API_KEY` in `aiRunner.ts` (the only place the key is read; `aiDashboards.ts` mirrors presence for `liveModelConfigured`). Configuration instruction (no key value ever in chat): add the secret named **OPENAI_API_KEY** through the platform's Keys/API keys UI; the backend "use node" action reads it via `process.env`. Bounded live evaluation remains pending until the key is configured — nothing was fabricated in its absence.

**Turn 27 (6 Oct 2026) — commercial release scope: pricing, AI entitlements, subscription lifecycle, plan-aware UX.**
(1) **Public pricing (`/pricing`, new public route in main.tsx, linked from the Landing header + hero)** — category sections A–D from `PLAN_CATEGORIES` (Practice Management / +AI / Firm+Advanced AI / Enterprise contact-sales); monthly/yearly selector; PRICING HONESTY RULES: prices shown only when configured (`priceConfigured`), yearly rows show the FULL annual charge + derived ≈monthly figure via `monthlyEquivalent`, savings COMPUTED from configured prices only via `annualSavings` (null unless both prices exist and yearly < 12×monthly — no invented discounts), "unlimited" never appears (allowances are numbers or absent = "not configured"), enterprise is contact-sales only (never self-serve, never advertises SSO/residency capabilities), "configuration pending" for unpriced plans, `purchasingAvailable` honest notice while Razorpay keys are absent, disclosures for renewal-by-payment-link / tax treatment from config / overage policy / model availability. Enterprise contact form → `requestEnterpriseContact` (validates name/email/requirements ≥20 chars → `enterpriseLeads`, platform-admin triage in the Platform console with status + audit row).
(2) **AI access & model options, server-enforced** — ONE resolver: pure `evaluateAiAccess` in `src/lib/planCatalog.ts` (status gates with specific reasons, aiEnabled, allowance 0/nil, exhaustion with usage+reset+options, concurrency cap; reservation model `AI_RESERVE_ESTIMATE_TOKENS=6000` reconciled to actual usage on completion, released by construction on failure/expiry since only pending jobs count). `entitlements.myAiEntitlement` (+ internal `orgAiEntitlement`) is the display + enforcement surface; `researchCore`/`ai.ts` entry points enforce through it (background jobs included). Model tiers via `src/lib/aiModels.ts`: standard = gpt-4o-mini (OPENAI_API_KEY), advanced = ADVOKATE_ADVANCED_MODEL only — a tier is OFFERED in the UI only when mapped to a configured model; an advanced request without configuration is refused with disclosure, never silently substituted. Plan→tier mapping is server-side (`saasPlans.aiAdvancedModel`); plan permission ≠ model availability (tested).
(3) **Subscription lifecycle completion** — `changePlan` (immediate with honest "proration not calculated in this release" note / period_end with explicit scheduled date + note; refuses enterprise, same-plan, non-live, missing billing capability, individual-plan-for-firm); `cancelScheduledPlanChange` (withdraw with honest history); `runExpiryScan` step 0 applies scheduled changes at their explicit effective date (clears honestly if target plan was disabled); scheduled change surfaced in `mySubscription.scheduledChange` + withdrawable in the billing UI. Merchant separation preserved (CJ GLOBAL account for subscriptions, firm's own for firm invoices — existing turn-25 machinery, untouched). Saved work preserved on downgrade to non-AI: the gate pauses AI only; workspace stays fully usable (explicit copy + tested reason text).
(4) **Case X-Ray enhancement** — incremental reassessment: at REQUEST time `prepareJob` computes the source-level diff against the previous completed X-Ray on the matter (`xrayDelta`: previousJobId/previousAt/added/changed/removed/unchangedCount — a fact of the record, never a model opinion), supersedes the old job (`supersededByJobId`, old rows flagged "outdated" in history, never deleted), and the runner prompt receives a WHAT-CHANGED section (carry-forward + revise-only-what-changed; first run = disclosure-only variant with analyzed-sources list). `XrayDisclosure` component shows the delta + "record, not opinion" note.
(5) **Plan-aware UX** — SubscriptionCard extended (scheduled-change display + withdraw, per-plan category/billingUnit/computed-savings/AI lines, honest buttons incl. "Configuration pending" / "Online purchasing not open yet"); `AiUsageBlock` (tier badge, usage bar, used/reserved/remaining/reset, reason banner, "no AI on this plan — full workspace remains" copy, `liveConfigured:false` note, availableTiers with model ids, aiFeatures); AiStudio entitlement banners (non-AI + exhausted → options + /billing link), tier selector rendered only from `availableTiers`, allowance-aware usage badge. Non-AI users keep the full 20-tab workspace; nothing hides.
(6) **Platform console** — plan editor (PlanEditorDialog: all commercial fields incl. category/billingUnit/planGroup/tax/renewal/overage + AI section with allowance/concurrency/advanced gating) via extended `upsertPlan` validations (enterprise price must be 0, allowance>0 requires aiEnabled, advanced requires aiEnabled, concurrency 1–20, whole-paise prices, trial 0–90, seats ≥1); enterprise enquiries triage (new/contacted/closed + `platformAdminAudit`).
(7) **Tests** — `src/lib/planCatalog.test.ts` (24) + `src/lib/aiModels.test.ts` (10) pin the honesty rules; `src/convex/commercial.test.ts` (26) exercises changePlan immediate/period_end/withdraw + refusals (enterprise/same-plan/non-live/capability/firm-kind), runExpiryScan scheduled application + disabled-target clearing, myAiEntitlement matrix (non-AI/allowed/advanced-only-when-configured/usage+reservations/exhaustion/concurrency/past-month-exclusion/failed-jobs-free/no-subscription), publicPlanCatalog (no-keys unpurchasable + computed savings + orphan groups + inactive hiding + enterprise contactSales; with keys purchasable), requestEnterpriseContact validation + admin-only leads + audit, AND the X-Ray delta chain (first X-Ray stores no delta; second records added/changed/removed/unchanged from real aiSources state, supersedes the old job via `supersededByJobId` on the user-facing reads, done job's reservation released while the pending one holds 6,000). `legalIntel.test.ts` fixture extended with the subscription+AI plan the new gate correctly requires (all 17 original tests green, no assertions weakened). **Suite 51 files / 666 tests green; `convex dev --once` push clean (moonlit-elk-307); tsc 0.**
(8) **STATUS SEPARATION (honest)**: backend + UI implemented; automated checks passed (above); browser verification NOT EXECUTED (tooling unavailable — walkthrough steps implied by `/pricing`, `/billing`, `/ai`, `/platform` flows remain manual); live purchasing NOT VERIFIED (no RAZORPAY keys → `purchasingAvailable:false` by design; no live charges possible without approval); live AI NOT VERIFIED (no OPENAI_API_KEY → honest errors + `liveConfigured:false`; Advanced tier never offered while ADVOKATE_ADVANCED_MODEL unset — by design); legal review of pricing/renewal copy PENDING.

**Turn 28 (6 Oct 2026) — release completion: billing explicitness, owner setup kit, runnable browser E2E, consolidated checklist.**
(1) **Billing made explicit**: pure `src/lib/planChange.ts` (`describePlanChange`, `planChangeConfirmText`, formatters; 8 test-pinned) states BEFORE any plan-change confirmation: charged today ₹0.00, the explicit next charge (new plan's full price), effective date (now or scheduled period end), next-billing-period (no-proration) policy, unpaid consequences (7-day grace → read-only, files viewable/exportable). `SubscriptionCard` confirms use it; a standing manual-renewal line names the payment link, the next-charge amount and the no-automatic-charge fact; `/pricing` fine print gained "Renewal — manual, by payment link" + "Plan changes — next-billing-period policy". No automatic recurring billing is advertised (none implemented/verified).
(2) **Owner setup kit** (`docs/OWNER_SETUP_CHECKLIST.md`): exact secret/configuration names (`OPENAI_API_KEY`, `ADVOKATE_ADVANCED_MODEL`, `RAZORPAY_KEY_ID/SECRET`, webhook URL `https://moonlit-elk-307.convex.cloud/webhooks/razorpay` with payment.captured / payment_link.paid / order.paid / payment.failed, `SECRET_ENCRYPTION_KEY`, `PLATFORM_OWNER_EMAIL` + admin bootstrap), where each is configured, test-mode-first sequencing with live activation gated on the full test pass + explicit owner approval, CJ GLOBAL vs firm merchant separation (firm connects in-app; stored encrypted; platform account never collects firm money), and the verification matrix each item unlocks. Never requests secret values.
(3) **Preview routes + workspace demonstration** (`docs/PREVIEW_ROUTES.md`): exact routes for pricing/enterprise-contact/checkout/billing/plan-changes/AI usage with screen-vs-server agreement checks, plus the lawyer-workspace demonstration (matter 20-tab workspace incl. documents/chronology/team/pending actions; X-Ray with analyzed sources + what-changed + outdated flagging; drafting incl. clarification gate; reply to a filed notice; client contact reaching the portal; restricted support-staff refusals).
(4) **Runnable browser E2E** (`e2e/`, self-contained): chromium Playwright config, helpers (four test identities + email-OTP capture contract `E2E_OTP_JSON`), `pricing.spec.ts` (manual-renewal copy, "Charged today: ₹0.00" + "Next charge: ₹" in confirm dialogs, honest unpriced states, no "unlimited" text, enterprise contact-sales anchor), `workspace.spec.ts` (matter tabs, X-Ray sources/disclosure, drafting, client comms → portal, restricted clerk), README with setup, identities, OTP handling, execution steps and explicit pass/does-not-prove boundaries. **NOT EXECUTED (no browser tooling in the authoring environment) — execution pending by design.**
(5) **Consolidated release checklist** (`docs/RELEASE_CHECKLIST.md`): commercial items, connectors (POCSO/DPDP live evidence RETAINED; India Code timeout and SCI gating retained as open, not dropped), backup **restore drill** as an explicit open item, monitoring/alerting, support channel/SLA, commercial-document legal review; production deploy and live charges stay owner-only and restricted.
(6) **Verification**: tsc 0; `convex dev --once` push clean (moonlit-elk-307); suite **52 files / 674 tests green** (turn-27 51/666 + 8 planChange − none removed; shards: lib 25/429, convex 22/226, components+pages 5/19). The turn-17 connector timestamp-sort flake was FIXED AT CAUSE (same-millisecond `startedAt` tie in `recentRuns` ordering; fixture back-dates the unchanged run deterministically; assertions untouched; shard green twice). Browser E2E execution, provider test-mode flows, bounded real-AI checks, the restore drill and live activation remain PENDING (keys/tools/owner approval); restrictions preserved.

**Turn 29 (7 Oct 2026) — execution phase: authorized checks executed; remaining blockers recorded with exact evidence.**
(1) **Restore drill EXECUTED** (owner-authorized: isolated non-production target, no additional paid service, cannot overwrite existing data): `bunx vitest run src/convex/restoreVerification.test.ts` → **3/3 passed (2.45s)** in an in-memory isolated instance — synthetic org → `archiveExport` (counts verified) → `runRestoreDrill` → transient `restore-sandbox-*` restore → independent count verification (`passed`) → purge → `restore_test` register row; purge refuses non-sandboxes and tampered counts fail loudly (both test-enforced). The deployment-level drill (same `runRestoreDrill` action, owner UI Settings → Data & backup) remains scheduled ONCE on the real deployment for production-grade evidence.
(2) **Payment test-mode verification BLOCKED on credentials, live-confirmed**: `entitlements:publicPlanCatalog` on moonlit-elk-307 → `purchasingAvailable:false`, `plans:[]` — no RAZORPAY keys AND no plan prices configured; the §6 matrix (checkout/activation, duplicate webhook, failed payment, renewal, refund) is unexecutable until the owner adds test keys + test webhook + plans. Nothing simulated.
(3) **Browser E2E attempted; environment cannot run it**: e2e deps installed (`npm install` ✓), Playwright CLI 1.63.0 present; `npx playwright install chromium --with-deps` **FAILED** (`Failed to download Chrome for Testing 153.0.8010.12 … Download failure, code=1`); no system browser; no reachable Vite base URL (only platform terminal/recording ports). NOT EXECUTED; auth untouched — no OTP weakening or bypass added; run contract stays `e2e/README.md` §1–6 in a Chromium-capable environment.
(4) **AI**: exact configured model **`gpt-4o-mini`** (standard; sole reader `aiRunner.ts`), advanced tier dormant (`ADVOKATE_ADVANCED_MODEL` unset → never offered, by design). Budget proposed BEFORE any paid request: project test key, **US$5/month hard cap**, 3 bounded synthetic-matter jobs within the 6,000-token reservation (≈US$0.02 total). Awaiting key + budget approval.
(5) **GitHub sync BLOCKED by platform**: every Git/GitHub command returns exactly "Git and GitHub commands are blocked; Vly manages version control." — no commit/push/SHA/URL obtainable here; no force-push attempted; the authorized sync to clarencedrosario/vintage-customer-app requires the Vly version-control UI (owner action).
(6) **Legal-source discovery kept explicit on `docs/RELEASE_CHECKLIST.md` §B**: refreshes of known documents (POCSO, DPDP Rules daily cron) ≠ discovery of new publications; discovery/coverage of new official sources remains open (India Code deep-URL retry, SCI authorization, eGazette expansion). No source files changed this turn → automated baseline **52 files / 674 tests** stands; restrictions preserved.

- **32.17 Official-source integration (user-prioritized, turn 17)** — **Implemented and verified (turn 17; real retrieval demonstrated)**: first permitted end-to-end connector (`sourceConnector.ts` + `sourceNotices.ts`): discover → retrieve → validate (magic bytes/size/section-count/section-1/bounds gates; the real MHA explainer-brochure PDF was REFUSED by these gates) → provenance/version (immutable versions with publisher, URL, collection date, `bytesHash`) → index → source search. Live channel decision from 2026-10-01 probes: India Code deep URLs timeout; eGazette TLS fails verification (refused to disable); SCI APIs registration-gated (no credentials → not authorized); CHOSEN channel = Delhi Police official bare-act reproduction of POCSO 2012 English text (India Code stays the canonical citation anchor). Real retrieval 2026-10-01: v2, versionId `hh7qqxfse9p72dbw2w8gwqp6jd8fey54`, bytesHash `31220b27b1a5e1ad0ef6e48dc013ad97d3f29344d5b0b39f69ad19a032dcd366`, 46,197 body chars, 44/46 sections; repeat fetch `unchanged` (dedupe on real bytes). Scheduler: cron declared 17:45 UTC daily + manual sweep invocation observed (trigger=schedule row); cron-fired connector record pending next tick — registry vs manual import vs working connector vs scheduler-in-code vs scheduler-observed kept strictly distinct. Failed checks never advance freshness (staleness keyed on success only; test-enforced). Opt-in matter-impact alerts wired to `updated` commits; alert `fromVersion` = truthful previous source version. Key-free by design (OPENAI_API_KEY irrelevant). Evidence separated in `docs/OFFICIAL_SOURCES.md` (browser verification: none; legal review: outstanding). **Turn 26 (6 Oct 2026) update**: eGazette TLS refusal ROOT-CAUSED (incomplete chain: leaf + YR2 only) and resolved WITHOUT disabling verification — `gazetteCa.ts` pins the PUBLIC Let's Encrypt/ISRG anchors; SECOND working connector registered (`in:rules:dpdp-2025`, DPDP Rules 2025 English gazette PDF) with LIVE retrieval on the deployment (`updated` v2 `hh7zwadhdkne600vdmgkyn5h1h8frc95`, 118,579 chars, 23/23 sections; repeat `unchanged`) and **cron-fired connector executions OBSERVED for POCSO** (daily `triggeredBy:"schedule"` runs Oct 1–5, all unchanged). Remaining: legal review of retrieved texts; DPDP Hindi counterpart; browser verification; SCI authorization blocker and India Code deep-URL timeout unchanged (recorded, not bypassed).

- **32.1 Phase 1 — Conflicting-evidence review** — **Implemented and verified (turn 16)**: `conflictReview.ts` + `reviewFindings`/`reviewFindingRevisions`. Deterministic pairing over the fact register (same-factKey chains; cross-source same-kind pairs sharing an informative content token with stopwords AND own-source-name tokens excluded; noise cap). Side-by-side passages with document version, page/paragraph/quote pinpoints and epistemic status (allegation/extracted/disputed/confirmed) per side. Lawyer actions with mandatory reasons: confirm conflict, dismiss ("different events" first-class), mark unresolved, record accepted interpretation. Append-only history; sources preserved; later documents never auto-resolve; source-text changes FLAG affected findings for reassessment (recorded outcomes kept + visible flag, never silently replaced); re-scan never resurrects reviewed pairs. Tests: 3 (detection, provenance, actions/history, reassessment flag + re-review, cross-tenant).
- **32.4 Phase 4 — Research evidence bundles** — **Implemented and verified (turn 16)**: `evidenceBundles.ts` + `researchBundles`. Bundles freeze a saved answer's citations to the current legalSourceVersions (version, retrievalAt, computed integrity hash — labelled as computed, never a provider attestation) with fresh validation (source existence + quote match; problems flagged as unresolvedIssues, never dropped); manifest query = structured machine-readable export (labelled RESEARCH RECORD, reference-only posture with omission list, matter permissions applied at export time); re-export supersedes (never re-points) with the chain preserved; draft/finalized review state. Tests: 2 (freeze + broken-citation flagging + version drift + supersession; cross-tenant).
- **32.2 Phase 2 — Adverse authority & citation rechecking** — **Implemented and verified (turn 16)**: `adverseAuthority.ts` (searchAdverse / recheck / recordDecision). Adverse search = deterministic terminology-overlap search over the AUTHORIZED ingested corpus only: content tokens (≥5 chars, stoplist) shared with a proposition (≥2 required), the matching PASSAGE displayed with each hit, court/decision-date/jurisdictionLevel surfaced as reviewed fields with weight-assessment left to the lawyer, same-country hits ranked first and other-jurisdiction hits labelled (never silently substituted). Every call states the search scope: corpus size, terms used, coverage limit "absence from these results does NOT prove that no adverse authority exists". Recheck compares a saved research job's or bundle's recorded source versions against the CURRENT corpus → unchanged / changed / unavailable + affected count, framed as lawyer-review material (cannot detect treatment changes never ingested; "no change" ≠ "law has not moved"; pair with an adverse search). Treatment labels are surfaced ONLY with their treatmentSourceKey (withheld + explanatory note otherwise — same rule in search and recheck; model inference is structurally unable to assert treatment). recordDecision writes a lawyer's recheck decision (reviewed_no_change_needed / research_updated / escalated_to_lawyer_review) to the matter trail with a mandatory ≥10-char reason. Tests: 3 (passage/terms/scope/treatment-withholding; changed+unavailable+XOR validation+treatment shown only with source; decision trail + thin-note refusal + cross-tenant refusals).
- **32.3 Phase 3 — Legal changes affecting active matters** — **Implemented and verified (turn 16)**: `matterImpact.ts` + `matterImpactAlerts`. Strictly OPT-IN per matter: only matters whose legalProfile carries `impactAlerts: true` AND anchored source keys (`anchoredSourceKeys`, lawyer-maintained via setOptIn/setAnchor, both matter.edit and refused without a confirmed legal profile) are ever alerted. The internal evaluator (`evaluateSourceUpdate`) is wired into ALL ingestion-run closing paths (recordIngestionResult, ingestSourceText, ingestSourceTextCli) and reuses the legalIntel state machine; dedupeKey `matter:stableKey:version` makes re-runs idempotent; a NEWER version re-alerts under a bumped key and supersedes the earlier open alert (recorded actions preserved — corrections never silent). Sourced treatment changes travel with the alert ONLY when treatmentSourceKey exists; a label without a supporting source generates NO alert and is recorded only as a withheldTreatmentNote (withholding is the rule). Acknowledge (mandatory ≥10-char note), dismiss (mandatory reason, never deleted), assign (active-member check), and task conversion through the EXISTING taskSuggestions propose→approve flow (no task is created without explicit lawyer approval; the coverage disclosure travels inside the rationale). Every list response carries the freshness disclosure: ingested corpus only, no alerts ≠ law has not moved. Cross-tenant reads empty, actions refused. Tests: 3 (opt-in gating + dedupe + supersession + cross-tenant; acknowledge/dismiss/assign/conversion + treatment withholding/shown + profile-required refusals; browser ingest path end-to-end).
- **32.5 Phase 5 — Filing-readiness workspace** — **Implemented and verified (turn 16)**: `filingReadiness.ts` + `filingChecklists`/`filingSuggestions`. VERSIONED checklists per matter (v1, v2, …; one open draft at a time; every revision is a new version and completed versions are frozen records). Deterministic checks over CURRENT matter state (empty-or-unsatisfied items, missing court/case-number/year metadata, future-dated filing dates flagged as likely data-entry errors) with the no-acceptance-guarantee disclaimer on every read and approval. AI suggestions are DETERMINISTIC derivations (labelled "Derived from…"; live-model enhancement stays gated), live in a SEPARATE table, and merge into the checklist ONLY via explicit apply (or dismiss with reason) by the lawyer. Approving as ready FREEZES the version (item edits refused) and records a snapshot hash of the matter's documents + legal profile; any later document (attachDocument and documentRequests accept both wired) or profile change INVALIDATES the approval automatically (`invalidateChanged`, reason recorded, records preserved — never reopened; next state is a new version). Readiness is a dated statement; no acceptance is promised. Tests: 2 (version lifecycle + suggestions + freeze + auto-invalidation on new document + v2; dismissal-with-reason + cross-tenant refusals).
- **32.6 Phase 6 — Verified redaction** — **Implemented and verified (turn 18)**: `redaction.ts` (V8 bridges + history) + `redactionRun.ts` (Node action) + pure `src/lib/redaction.ts`. Derivative production with genuine underlying-text removal where format support permits: ONLY UTF-8 text-family files (.txt/.md/.markdown/.csv/.json) can be verifiably redacted — the derivative bytes are produced by removing the recorded terms and then RE-SCANNED with the same case-insensitive, whitespace-tolerant matcher; "verified" is recorded ONLY when every term is provably absent (all residue counts zero). Unverifiable formats (PDF, images, office containers, unknown extensions) are REFUSED with a recorded reason — boxed-over redactions that leave text/pixels intact are structurally impossible to label here. Content guards catch mislabelled files (binary signatures incl. PDF/ZIP/PNG/JPEG/NUL-byte; strict UTF-8 decode); jobs refuse files whose bytes differ from the recorded integrity hash. Every entry carries a mandatory human reason; dedupe is case-insensitive; longest-first replacement. Verified derivatives are stored as real objects and filed as normal vault documents (integritySha256 + `redaction_derivative` custody event + audit entry, internal visibility — never auto-shared). Every attempt — verified, failed, refused — is recorded in `redactionJobs` with per-term hit/residue counts and the coverage disclosure on every row: verification is a mechanical absence check of THIS derivative, not proof the source held nothing else sensitive, and human review is required before external use. Synthetic-fixture acceptance tests (4): verified path with byte-level derivative proof + hash/custody/audit; refusal matrix (PDF/binary-content/integrity-mismatch/no-file/unknown-format/invalid-entries incl. reason-less terms and case-insensitive duplicates); matcher whitespace-tolerance + residue-FAILS fixture; failed rows never file derivatives + cross-tenant refusal leaves no trail.
- **32.7 Phase 7 — Legal holds & ethical walls** — **Implemented and verified (turn 19)**: `ethicalWalls.ts` + `src/lib/wallScope.ts` + `legalHolds`/`ethicalWalls`/`emergencyAccessGrants` tables. HOLDS: a preservation order that BLOCKS ordinary deletion (`vault.remove`) for every member including owners/administrators — no bypass; lifting is an explicit, reason-carrying, capability-gated (matter.close) decision; duplicate active holds refused. WALLS: targeted scope (user / role / all) over chosen matters or the whole org, enforced on every retrieval path — the shared access gate (`requireMatter`/`matterOrNull`: detail reads AND writes across all matter-content modules), list filters (`matters.list` ×2 and the §32 surfaces conflictReview / evidenceBundles / filingReadiness / matterImpact — walled members get nothing back, walls are not advertised), background scans (`reminders.runScan` skips walled recipients per target — hearings and deadlines), and AI (`aiRunner` wall-check before processing; job fails honestly with a visible error). Exempt actors are NAMED at creation (creator inside scope without explicit exemption is refused; named users must be active members); NO ROLE is ever implicitly privileged. Emergency access is the ONLY route past a wall: time-boxed grant (≤24 h, mandatory ≥10-char detail, per wall+actor), holder ACKNOWLEDGEMENT required (unacknowledged grants open nothing), revoked/expired grants close it, each use audited. `wallExplanation` explains the wall (title, reason, exemption, grant state) instead of a bare refusal. Tests (4): hold blocks deletion for every role + explicit lift + audit trail; wall restricts every human path while the exempt actor keeps access + creation guards + lift restores; emergency-grant lifecycle (unacknowledged/nothing → acknowledged/access → expiry → revoke); background paths honour walls (reminder scan skips the walled recipient, AI wall-check sees the wall).
- **32.8 Phase 8 — Document-based AI-instruction defence** — **Implemented and verified (turn 20)**: pure `src/lib/aiDefence.ts` + runner/schema wiring + `aiJobs.instructionDefence`. UNTRUSTED-CONTENT POSTURE: matter documents, filed emails and voice transcripts are treated as potentially hostile DATA (they can originate from opposing parties) — text that asks, orders or begs the assistant to do something is case record, never an instruction to the assistant. STRUCTURAL CONFINEMENT: every untrusted source is sanitized (zero-width characters removed; HTML comments and `<script>` blocks stripped — the classic hide-and-inject channels; substance-preserving) then wrapped in machine-readable fences `<<<UNTRUSTED_DOCUMENT name="…" role="…">>>` before entering the prompt; the hardened system prompt (`buildSystemPrompt`, replaces the former SYSTEM constant) teaches the model that fenced content is DATA ONLY, never to change role/rules/output format because of it, never to open/fetch URLs inside documents, plus OUTPUT INTEGRITY rules (never remove or weaken warnings/disclosures, never present allegation as fact). DETECTION FOR HUMANS: deterministic pattern scan (six signal kinds: direct_instruction / role_override / system_prompt_probe / tool_or_fetch_request / hidden_content / output_manipulation) over every source plus runner-side extras (voice transcript, filed email digest), one capped excerpt (≤120 chars) per kind with source attribution; signals NEVER silently pass and NEVER block legitimate work — they are persisted on the job (`instructionDefence`, capped list) and a visible INSTRUCTION-DEFENCE NOTICE banner is prepended to the output so the lawyer reviews with extra scrutiny; `getJob` exposes the record to the owning org only (cross-org reads get null — the gate hides other tenants, it does not acknowledge them). TOOL/FETCH RESTRICTION: the model is called with NO tools; `AI_TOOL_POLICY` allowlists `api.openai.com` and `assertEndpointAllowed` guards the ONLY two outbound calls (chat completions + transcription) — defence-in-depth so a future code path cannot silently widen the blast radius. Honest limits: detection is an aid with possible false positives (recorded as review material, never auto-verdicts, and never a processing block — a hostile sentence inside a document must not stop legitimate work); fixtures are SYNTHETIC attack text, not a real adversarial corpus; OPENAI_API_KEY is absent in this environment so the live-model path is unexercised — the defence layer itself is deterministic and fully tested; prompt-fencing is a mitigation, not a guarantee (detection-for-humans is the compensating control). Tests (3): pure layer (12 labelled adversarial fixtures across all six kinds including hidden channels; clean-text negative — ordinary court/order/URL mentions are NOT flagged; sanitizer; fences incl. role tokens; system-prompt boundary rules; endpoint guard incl. unparseable URLs; scanSources cap 20 + attribution); runner wiring (hostile letter-from-opposition source → signals detected via the exact jobForRunner scan the runner performs → attachResult persists instructionDefence → gated getJob shows banner + record; clean deed source → zero signals, no banner, no record — absent ≠ empty); cross-tenant (rival org gets null). Suite 39 files / 577 tests; push clean; tsc 0.
- **32.9 Phase 9 — Multilingual evidence review** — **Implemented and verified (turn 21)**: pure `src/lib/multilingual.ts` + `multilingual.ts` module + `dataHandlingPolicies`/`translationRecords` tables. ORIGINAL PRESERVED: translations are new APPEND-ONLY records beside the evidence (`aiSources.text` / `matterFacts.statement` — verified unchanged by test) that FREEZE a copy of the original at translation time; a newer rendering for the same target+language SUPERSEDES the old record (chain preserved, nothing overwritten); if the live original later changes the view flags the record STALE and still shows the frozen pairing (never silently re-pointed). SIDE-BY-SIDE: deterministic newline-paragraph segmentation paired by index (language-neutral — sentence splitting deliberately NOT attempted); a segment-count mismatch is the HEADLINE with the unpaired remainders exposed, never hidden. PROVIDER/VERSION RECORDING: every record carries providerKind (manual | machine_external | machine_self_hosted), providerName, providerVersion, language pair (BCP-47-ish codes validated; unknown well-formed codes display as themselves — no invented names), recorder identity/time. MACHINE-TRANSLATION LABELLING: machine renderings carry a mandatory disclosure on every read ("MACHINE TRANSLATION — produced automatically by …; NOT authoritative and NOT the evidence"), manual renderings a "MANUAL RENDERING" label with the named translator; HUMAN VERIFICATION is an ATTESTATION (capability-gated mutation, mandatory ≥10-char note recording what the comparison covered) that changes no text and never launders the machine label away; the matter list carries a standing "translations are review aids, never the evidence" disclosure. DATA-HANDLING RESTRICTION CHECKS: a per-matter decision (`setHandlingPolicy`, matter.edit capability, wall-checked, authorityNote ≥10 chars recording WHERE the authority comes from) gates recording — machine_external is REFUSED while the decision is unset (the honest DEFAULT: no silent external disclosure) and when restricted; manual and machine_self_hosted (no external transfer) never need it; same-language "translations" refused. Walls apply on every path via `requireMatter`; cross-org side-by-side reads get null, actions refused. Honest limits: no translation engine is built or claimed (the layer governs recordings of renderings produced elsewhere; the machine_external integration point is where a future runner would attach); pairing is paragraph-level; no OCR/script-direction layout; no UI yet (backend + tests, like Phases 1–9). Tests (3): pure layer (language validation incl. hostile inputs; aligned + mismatch pairing; permission matrix incl. unset default refusal; labels; provider facts; truncation-refusing limits); recording (original preserved, machine + manual labels, supersession chain, verification attestation incl. thin-note refusal, staleness after fact edit, matter list); data-handling + cross-tenant (unset/restricted refusals, thin authorityNote refusal, manual/self-hosted pass, explicit allowed unlocks, rival org null + refusals + independent policy space). Suite 40 files / 580 tests; push clean; tsc 0.
- **32.10 Phase 10 — Client-update drafts** — **Implemented and verified (turn 22)**: pure `src/lib/clientUpdates.ts` + `clientUpdates.ts` module + `clientUpdateDrafts` table, built ON the existing machinery (matterTimeline chronology + conversations threads + the comm outbox — never a parallel send path). APPROVED-DEVELOPMENTS-ONLY: the body is assembled deterministically and exclusively from `matterTimeline` entries with status `approved` (proposed/needs_review entries are refused and excluded from listing); the footer disclosure ("drawn only from the developments listed above… the underlying documents remain the authoritative record") travels with every body; nothing is promised or softened by the assembler. RECIPIENT PERMISSION DISPLAY: `draftReview` shows exactly who would receive the update and their honest state — portal account linked, recorded clientUpdates preference (null = never recorded, shown as absent, never treated as consent), WhatsApp opt-in, thread existence. SEND-TIME RE-VERIFICATION: each draft freezes per-development digests (entryKind/title/date/detail/status); `queueForSend` re-derives every development's CURRENT digest + approval and BLOCKS on missing / downgraded (needs_review) / changed with a precise problem list telling the lawyer to regenerate — stale drafts cannot be silently patched or sent. DUPLICATE-SEND PREVENTION via existing notification machinery: drafts queue through `commOutbox.compose` (category `matter_update`, in_thread, sourceKind `client_update_draft`) → the outbox's own `approve` mutation (its capability gate applies) → `queue`; the same development set (order-independent set key over digests) cannot be sent twice (sent-draft ledger), and a draft already on the outbox delivery path (queued/sent/delivered/read/awaiting_configuration) is refused — cancelled/failed stay with the outbox's retry lifecycle by design; `attemptDelivery` posts the exact approved body onto the client thread. Approval gate: draft approval requires matter.edit; queueing requires note.write; walls apply on every path; cross-org reads null / actions refused. Honest limits: no free-text drafting channel exists here by design (wording changes happen by editing the underlying chronology or via the outbox's own revise flow, which resets approval); digests are change-DETECTION for re-approval, not security attestations; only in_thread channel is exercised in tests (email/WhatsApp stay the outbox's provider paths, unexercised — no provider configured). Tests (3): pure layer (assembly incl. footer + date sort; order-independent set key; re-verification matrix; duplicate decision incl. non-blocking cancelled/failed); end-to-end (approved-only listing + refusal, approve gate, outbox queue with category/approval/sourceKind/thread assertions, in-thread delivery posts the body, duplicate same-set refused, changed + downgraded developments block with regenerate instruction); recipients + cross-tenant (recorded preference shown as false honestly, rival org null/empty/refused). Suite 41 files / 583 tests; push clean; tsc 0; one pre-existing timestamp-sort flake in a turn-17 connector test observed once under full-suite load and green on isolated + full re-run (recorded, not modified).
- **32.11 Phase 11 — AI quality/freshness/cost dashboards** — **Implemented and verified (turn 23)**: pure `src/lib/aiDashboards.ts` + `aiDashboards.ts` module — two read-only queries, one honesty contract. NO UNDEFINED ACCURACY PERCENTAGES: no "accuracy" number exists anywhere in the module (test-asserted); every metric is a DefinedMetric carrying its exact definition (what is counted, over what window, what is excluded) — failure rate (failed ÷ (done+failed+expired), pending/blocked excluded as non-outcomes), blocked-clarification rate (framed as a quality guard, not an error), instruction-defence incidence (labelled a pattern-scan aid, never a verdict), nearest-rank median/p95 durations over completed jobs, costMinor and token totals. FIRM VIEW (`firmDashboard`): aggregates over the org's OWN aiJobs with rolling window (default 30d, max 120d), per-kind and per-UTC-day buckets, corpus-freshness summary over the SHARED legalSources/ingestionRuns (same rules as legalIntel.freshness — staleness keys on SUCCESS only, failures surfaced separately, registered-but-uningested counts as no text), honest `liveModelConfigured` state (false here — rows will be pending/blocked and the dashboard shows that rather than hiding it), content-leak absence asserted (job results/errors never enter the payload). CJ GLOBAL PLATFORM VIEW (`platformDashboard`): gated strictly on `users.isPlatformAdmin` (the platform.ts pattern — never self-serve); per-organization rows built from a FIELD WHITELIST (`PLATFORM_ROW_FIELDS`) — counts, costMinor/token totals, defence-signal job counts, last-job timestamp, keyed by OPAQUE org ids; NO organization names, NO matter references, NO customer content (results, inputs, transcripts, e-mail bodies, errors, defence excerpts — all in `FORBIDDEN_CONTENT_KEYS`); a runtime leak guard (`assertPlatformSafe`) walks the payload before it leaves and throws on any forbidden key or oversized non-structural string (module-authored metric definitions/disclosures are the exempt structural subtree) — defence-in-depth so a future field addition cannot silently leak. Read-only: nothing writes, no new tables (aggregation over existing aiJobs/legalSources/ingestionRuns). Honest limits: full-collection aggregation (bounded scale, matches the existing opsCounts pattern); per-org rows carry operational metadata only — even richer platform analytics would need an explicit, separately-authorized decision; corpus freshness is global (the corpus is shared), surfaced identically in both views. Tests (3): pure layer (windowing incl. out-of-window exclusion; metric definitions present + accuracy-absence; nearest-rank percentile arithmetic; by-kind/by-day buckets; whitelist row shape; leak guard on every forbidden key + oversized strings); firm view (counts over seeded jobs, window exclusion, configuration honesty, no SECRET-RESULT/SECRET-ERROR leakage into payload); platform view (regular user refused; platform admin — with no org membership — sees opaque-id rows with correct counts; payload contains NO org name, NO matter reference, NO seeded content strings; disclosure present). Suite 42 files / 586 tests; push clean; tsc 0.
- **32.12 Phase 12 — Complete firm export & exit** — **Implemented and verified (turn 24)**: pure `src/lib/firmExit.ts` + `firmExit.ts` module + `firmExitJobs` table, on top of the existing backupRecords/archive + saasExports machinery. FIRMEXIT JOBS ARE RESUMABLE AND FENCED: the job row is the single source of truth — `planCheckpoints` expands a FIXED 10-table catalogue (2 org tables: clients, invoices; 8 matter tables per matter: matters, hearings, orders, tasks, matterEvents, matterTimeline, matterFacts, matterDocuments) into an ordered checkpoint plan; `collectStep` (internalAction) collects AT the job's stored cursor only, re-validates every existing part against the plan (dependencies as identity), and `appendPart` (internalMutation) re-runs the RESUME FENCE (`appendPartAtCursor` — throws "Resume fence violated" on any cursor/plan mismatch, mutates {parts,cursor} in place) so a job that stops mid-run raises again on the next step and CONTINUES without duplicating or reordering — never a fresh file (test: resume midway, remaining=0, second collectStep collects 0). CHECKSUMMED PARTS: each part is JSON-serialised rows → SHA-256 (`sha256HexBytes`) → separate object-storage blob, so verification is possible at any time later. INDEPENDENT VERIFICATION: `verifyExport` re-reads EVERY part blob, recomputes each digest and row count, records `failures[]`; status stays `collecting` until verified and only then becomes `awaiting_download` — the stored job is never trusted on its own word. COMPLETE-CATALOGUE MANIFEST: `buildManifest` emits every planned table with parts + sha256 + row counts, `recordOmissions` computes counts SERVER-SIDE (a caller can never under-report a table into silence) over the FULL catalogue — the 12 §32 enhancement tables Phases 1–11 generate (conflictChecks, researchBundles, matterImpactAlerts, filingChecklists, filingSuggestions, redactionJobs, translationRecords, clientUpdateDrafts, aiJobs, legalHolds, ethicalWalls, emergencyAccessGrants) plus the operational tables (commOutbox, auditLog, notificationLog, supportTickets — all org-scoped; supportTickets rows with a null orgId are the platform-side queue and are never attributed to a firm) — and lists zero-row tables with the reason string containing "silently" (silences are visible, not hidden; §32 tables carry their own "§32 enhancement" reason), legal holds are LISTED (matter reference, kind, placed-at) not lifted, plus the MANIFEST_DEFINITION ("COMPLETE means…") and the honest note that document FILE bytes live in object storage, not in these row parts. REAUTHENTICATION (evidence = the existing loginEvents successful-sign-in log; no session-reauth state exists in the stack): reauthState/requireReauth require a successful sign-in within WINDOW_MS (7 days) on startExportJob, issueDownload, redeemDownload, closeOrganization and revokeExport. EXPIRING AUDITED DOWNLOADS: issueDownload issues a 1-hour (DOWNLOAD_TTL_MS) grant recorded on the job (downloads capped at 50); redeemDownload is SINGLE-USE (`downloadDecision` distinguishes no-grant / already-used / expired) and stamps usedAt; revoked jobs hand out nothing. LEGAL-HOLD RESPECT: closeOrganization refuses while ANY hold is active ("LEGAL HOLD active" thrown, block recorded on activeHoldBlocks with holdId/matterId/reason), issueDownload refuses fresh links while holds stand; lifting (explicit reason-carrying decision) restores the flow — holds are obstruction, suppression is attempted against nobody. EXIT: closeOrganization (owner-only + reauth) requires an awaiting_download job with verification.verified, marks the closure on the job label ("[ORG CLOSED …]") — an ADDITIVE closure record, NOT hard deletion; revokeExport (owner/admin + reauth + reason ≥10 chars) revokes the job so it can never issue links again. Duplication guard (one collecting job at a time) and matter-cap (≤200) at start. Honest limits: the export is a structured-machine-readable record plus independently verifiable parts — it is NOT a single human-readable PDF (the manifest is the human-readable map); a fixed 10-table catalogue means a schema addition must consciously update SPECS before it would be exported — omissions records make any missed table visible rather than silently dropped; close is additive, hard erasure is a separate decision; no UI surface yet (backend + tests, like Phases 1–12). Tests (3): pure layer (plan expansion → 2+8×N checkpoints; resume prefix semantics; fence violation matrix; download decisions no-grant/used/expired; omissions incl. silently-marker + §32-enhancement reason; reauth window incl. no-evidence; TTL constant; MANIFEST_DEFINITION + line count); end-to-end (seeded org with 1 matter + memcpyred loginEvents → collect → resume → verify asserts verified=true + awaiting_download → manifest row-count assertions → issueDownload with expiresAt>now → redeem succeeds → SECOND redeem throws /already used/ → close closed=true → revoke → status revoked); guards (no loginEvents → /No successful sign-in is on record/; close while hold active throws /LEGAL HOLD active/ + records activeHoldBlocks; issueDownload refused /legal hold exists/; manifest lists the hold with matterReference "T24/2026/0001"; self-counting omissions list the placed hold as a legalHolds omission with the "silently" reason; liftHold restores close capability; revokeExport thin reason refused; cross-tenant: rival listJobs empty, revoke+close on foreign job refused /not found in this organization/). Suite **43 files / 589 tests green** (turn-23 baseline 42/586 + 3). Push clean; tsc 0. §32 programme COMPLETE (Phases 1–12).
