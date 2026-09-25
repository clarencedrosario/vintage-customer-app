# Implementation & delivery map (section 31)

Status legend:
- **Implemented & tested** — code complete, exercised by the automated suite and/or live typecheck/build/push.
- **Awaiting external config** — implemented, but needs credentials/approvals you must supply (keys, merchant accounts, provider review).
- **Incomplete** — not built yet.

Last verified: 25 September 2026 — `tsc -b` 0 errors, 271/271 tests, Convex push and production build succeed.

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
| Offline mode | Bundle prepare/sync, queued notes, conflicts, expiry |
| Import | 5 entities, validation/preview/duplicates/error report, apply-once |
| Backups | Archive export, restore-test register, documented procedure |
| Navigation | Section 29 grouped sidebar, simplified portal navs, deep links |
| Tests | 68 automated tests (parsing, formatting, exports, outcome chain, cards, multi-tenant denial fixture, invitation lifecycle) |

## Awaiting external configuration

| Area | What is needed from you |
| --- | --- |
| AI/OCR live calls | OpenAI API key (server-side env); usage-based cost |
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

## Milestone status (section 31 list)

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
