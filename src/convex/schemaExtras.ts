// =====================================================================
// Feature 5 — Deadline rules engine: table definitions.
// Feature 6 — Client communication approval: table definitions.
//
// Kept in a dedicated module that schema.ts spreads into the main
// schema (extend, never duplicate). All rows are org-scoped.
// =====================================================================
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { DEADLINE_CATEGORIES } from "./constants";
import { CUSTODY_ACTIONS } from "../lib/evidenceIntegrity";

export const featureFiveTables = {
  // Versioned computation rules. Editing a rule creates a NEW version;
  // the version used is frozen onto every generated draft, so rule
  // changes never retroactively alter approved deadlines.
  deadlineRules: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    jurisdiction: v.optional(v.string()), // unset = any jurisdiction
    authority: v.optional(v.string()), // court/tribunal; unset = any
    practiceArea: v.optional(v.string()), // unset = any
    triggerEvent: v.string(),
    countType: v.union(v.literal("calendar_days"), v.literal("working_days")),
    count: v.number(),
    triggerDayTreatment: v.union(v.literal("excluded"), v.literal("included")),
    weekendRule: v.union(v.literal("sat_sun"), v.literal("sun_only")),
    holidayRule: v.union(v.literal("skip"), v.literal("count")),
    direction: v.union(v.literal("after"), v.literal("before")),
    criticality: v.union(v.literal("critical"), v.literal("normal")),
    reminderDaysBefore: v.optional(v.number()),
    effectiveFrom: v.string(), // YYYY-MM-DD
    effectiveTo: v.optional(v.string()), // YYYY-MM-DD
    currentVersion: v.number(),
    active: v.boolean(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Immutable frozen specs — one row per rule version.
  deadlineRuleVersions: defineTable({
    ruleId: v.id("deadlineRules"),
    version: v.number(),
    spec: v.any(),
    changeNote: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  }).index("by_rule", ["ruleId"]),

  // Configurable court holidays (org-scoped, optionally per court).
  courtHolidays: defineTable({
    orgId: v.id("organizations"),
    date: v.string(), // YYYY-MM-DD
    name: v.string(),
    court: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_date", ["orgId", "date"]),

  // One row per rule-generated deadline draft. The dedupeKey is
  // deterministic per rule+version+trigger so a retry can never
  // double-generate. Lifecycle: draft → approved → acknowledged →
  // completed | extended | vacated | missed (rejected drafts kept).
  ruleDeadlines: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    ruleId: v.id("deadlineRules"),
    ruleVersion: v.number(),
    ruleName: v.string(),
    dedupeKey: v.string(),
    triggerEvent: v.string(),
    triggerRef: v.string(),
    triggerDate: v.string(), // YYYY-MM-DD (IST)
    title: v.string(),
    category: v.union(...DEADLINE_CATEGORIES.map((c) => v.literal(c))),
    dueDate: v.string(), // computed, YYYY-MM-DD
    calcRule: v.string(), // human-readable rule sentence
    breakdown: v.array(v.string()), // step-by-step calculation trail
    sourceSentence: v.optional(v.string()), // source record sentence/date
    criticality: v.union(v.literal("critical"), v.literal("normal")),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("acknowledged"),
      v.literal("completed"),
      v.literal("extended"),
      v.literal("vacated"),
      v.literal("missed"),
    ),
    rejectNote: v.optional(v.string()),
    deadlineId: v.optional(v.id("deadlines")), // created on approval
    proposedById: v.id("users"),
    proposedByName: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id("users")),
    approvedByName: v.optional(v.string()),
    acknowledgedAt: v.optional(v.number()),
    acknowledgedById: v.optional(v.id("users")),
    completedAt: v.optional(v.number()),
    completedById: v.optional(v.id("users")),
    // Post-approval corrections — every change keeps its reason and the
    // previous date; nothing is silently overwritten.
    adjustments: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.id("users"),
          byName: v.string(),
          reason: v.string(),
          oldDueDate: v.string(),
          newDueDate: v.string(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_dedupe", ["dedupeKey"]),
};

// =====================================================================
// FEATURE 6 — Client communication approval (the outbox)
// =====================================================================

export const COMM_CATEGORIES = [
  "hearing_update",
  "deadline_reminder",
  "document_request",
  "matter_update",
  "appointment",
  "billing_notice",
  "secure_message",
] as const;

// =====================================================================
// FEATURE 8 — HR / Payroll / Accounting foundations (2026 expansion).
//
// Conventions carried over from billing.ts:
// - ALL money is integer paise; rupee conversion happens once at the UI
//   boundary and amounts are validated on write (no floats in ledgers).
// - Effective-dated statutory configuration: PF/ESI/PT/TDS rates and
//   layers live in `statutorySettings` with explicit effective dates;
//   a payroll run freezes the spec it used. No rates are shipped as
//   defaults — payroll refuses to run until an operator enters verified
//   values (anti-invented-rates guard).
// - Double-entry core: every `journalEntries` row carries debits/credits
//   arrays that must satisfy debits === credits before post (enforced in
//   finance.ts); posted rows are immutable — corrections go through
//   audited reversal entries.
// - IST day model (YYYY-MM-DD strings) everywhere dates matter.
// =====================================================================

export const hrTables = {
  // -----------------------------------------------------------------
  // HR core
  // -----------------------------------------------------------------
  // One row per employment record (per org). userId links to the login
  // account; a row may exist pre-onboarding with no userId yet.
  employees: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // unset until account linked
    employeeCode: v.string(), // unique per org, e.g. ADV-014
    firstName: v.string(),
    lastName: v.string(),
    workEmail: v.optional(v.string()),
    workPhone: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    branch: v.optional(v.string()),
    designation: v.string(),
    employmentType: v.union(
      v.literal("partner"),
      v.literal("permanent"),
      v.literal("contract"),
      v.literal("intern"),
      v.literal("consultant"),
      v.literal("support"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("probation"),
      v.literal("notice_period"),
      v.literal("suspended"),
      v.literal("resigned"),
      v.literal("offboarded"),
      v.literal("rejected_offer"),
    ),
    dateOfJoining: v.string(), // YYYY-MM-DD
    probationEndDate: v.optional(v.string()),
    dateOfLeaving: v.optional(v.string()),
    reportingManagerId: v.optional(v.id("users")),
    // Integer paise. Salary reads are gated by canViewSalaryRecord —
    // listings strip this field unless hr.view_salary (or self).
    monthlyGrossPaise: v.optional(v.number()),
    // Statutory identifiers — read under hr.view_salary only.
    pan: v.optional(v.string()),
    uan: v.optional(v.string()),
    esiNumber: v.optional(v.string()),
    // Bank details are masked: last-4 + IFSC only. Full account numbers
    // are never stored; the payment file references these.
    bankAccountLast4: v.optional(v.string()),
    bankIfsc: v.optional(v.string()),
    leaveProfileId: v.optional(v.id("leaveProfiles")),
    // Leave openings as on join; per-type running balances.
    leaveBalances: v.optional(
      v.array(
        v.object({
          leaveType: v.string(),
          balance: v.number(), // days, one decimal (half-days supported)
          asOf: v.string(), // YYYY-MM-DD
        }),
      ),
    ),
    onboardingChecklist: v.optional(
      v.array(
        v.object({
          item: v.string(),
          done: v.boolean(),
          doneAt: v.optional(v.number()),
        }),
      ),
    ),
    offboardingChecklist: v.optional(
      v.array(
        v.object({
          step: v.string(),
          done: v.boolean(),
          doneAt: v.optional(v.number()),
        }),
      ),
    ),
    exitNote: v.optional(v.string()),
    accessRevokedAt: v.optional(v.number()),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_user", ["userId"]),

  departments: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    headUserId: v.optional(v.id("users")),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Leave policy profiles: org policy, NOT statutory rates. "per_month"
  // accrues monthly; "annual" grants on Jan 1; "fixed" grants on join.
  // carryForwardCap prevents unbounded accumulation.
  leaveProfiles: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    rules: v.array(
      v.object({
        leaveType: v.string(),
        accrual: v.union(
          v.literal("per_month"),
          v.literal("annual"),
          v.literal("fixed"),
        ),
        days: v.number(),
        carryForwardCap: v.optional(v.number()),
      }),
    ),
    active: v.boolean(),
    createdById: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Leave applications. pending → approved → taken, or rejected /
  // cancelled. Balances decrement only when status becomes "taken";
  // unpaid days flow to payroll as LOP.
  leaveRequests: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    applicantUserId: v.id("users"),
    leaveType: v.string(),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    days: v.number(),
    unpaidDays: v.optional(v.number()),
    reason: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("taken"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    decidedAt: v.optional(v.number()),
    decidedById: v.optional(v.id("users")),
    decidedByName: v.optional(v.string()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_employee", ["employeeId"])
    .index("by_org_status", ["orgId", "status"]),

  // Daily attendance, one row per employee-day. Payroll's attendance-
  // based LOP reads this as the single source of truth.
  attendance: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    date: v.string(), // YYYY-MM-DD
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half_day"),
      v.literal("leave"),
    ),
    source: v.union(v.literal("manual"), v.literal("import")),
    note: v.optional(v.string()),
    markedById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_date", ["orgId", "date"])
    .index("by_employee", ["employeeId"]),

  // Office holiday calendar. Distinct from courtHolidays: a court
  // holiday is not necessarily an office holiday.
  orgHolidays: defineTable({
    orgId: v.id("organizations"),
    date: v.string(),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_org_date", ["orgId", "date"]),

  // Recruitment: internal job postings and candidate pipeline.
  vacancies: defineTable({
    orgId: v.id("organizations"),
    title: v.string(),
    departmentId: v.optional(v.id("departments")),
    designation: v.string(),
    employmentType: v.union(
      v.literal("permanent"),
      v.literal("contract"),
      v.literal("intern"),
      v.literal("consultant"),
      v.literal("support"),
    ),
    openings: v.number(),
    status: v.union(v.literal("open"), v.literal("closed")),
    closedReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Candidate pipeline: screening → interview → offer → joined →
  // onboarded (which creates the employee row). offerPaise is the
  // annual CTC in paise — capability-gated reads.
  candidates: defineTable({
    orgId: v.id("organizations"),
    vacancyId: v.id("vacancies"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: v.optional(v.string()),
    stage: v.union(
      v.literal("applied"),
      v.literal("screening"),
      v.literal("interview"),
      v.literal("offer"),
      v.literal("joined"),
      v.literal("rejected"),
      v.literal("withdrawn"),
      v.literal("onboarded"),
    ),
    stageNote: v.optional(v.string()),
    interviewAt: v.optional(v.number()),
    interviewPanel: v.optional(v.array(v.id("users"))),
    offerPaise: v.optional(v.number()),
    employeeId: v.optional(v.id("employees")),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_vacancy", ["vacancyId"])
    .index("by_org", ["orgId"]),

  // Employment documents & policy acknowledgements. expiresOn rows
  // surface expiry reminders in Attention.
  hrDocuments: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    kind: v.union(
      v.literal("contract"),
      v.literal("id_proof"),
      v.literal("qualification"),
      v.literal("policy_ack"),
      v.literal("other"),
    ),
    title: v.string(),
    storageId: v.optional(v.id("_storage")),
    expiresOn: v.optional(v.string()),
    acknowledgedAt: v.optional(v.number()),
    acknowledgedById: v.optional(v.id("users")),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_employee", ["employeeId"]),

  // Performance reviews with inline goals. Probation confirmation is a
  // status flip on the employee row, recorded here as a review note.
  reviews: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    period: v.string(), // e.g. "H1 2026"
    goals: v.array(
      v.object({ goal: v.string(), done: v.boolean() }),
    ),
    rating: v.optional(
      v.union(
        v.literal("outstanding"),
        v.literal("exceeds"),
        v.literal("meets"),
        v.literal("needs_improvement"),
        v.literal("unsatisfactory"),
      ),
    ),
    summary: v.optional(v.string()),
    reviewAt: v.optional(v.number()),
    reviewerId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_employee", ["employeeId"]),

  // HR expense reimbursements (matter-billable expenses remain in the
  // existing `expenses` table). Approved rows can ride a payroll run.
  hrExpenses: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    applicantUserId: v.id("users"),
    title: v.string(),
    category: v.union(
      v.literal("travel"),
      v.literal("books"),
      v.literal("court"),
      v.literal("other"),
    ),
    amountPaise: v.number(),
    receiptStorageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("reimbursed"),
      v.literal("paid_in_payroll"),
    ),
    decidedAt: v.optional(v.number()),
    decidedById: v.optional(v.id("users")),
    decidedByName: v.optional(v.string()),
    payrollRunId: v.optional(v.id("payrollRuns")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  // Timesheet rows beyond matter time entries: project work, training,
  // admin. Matter-billable time stays in `timeEntries` (billing reads
  // it); this feeds workload/capacity and payroll cross-checks.
  workLogs: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    date: v.string(),
    minutes: v.number(),
    kind: v.union(
      v.literal("project"),
      v.literal("training"),
      v.literal("admin"),
      v.literal("business_dev"),
      v.literal("other"),
    ),
    // matterId links non-billable matter work; project linkage arrives
    // with the project-management phase (projectId added then).
    matterId: v.optional(v.id("matters")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org_user_date", ["orgId", "userId", "date"]),

  // -----------------------------------------------------------------
  // Payroll
  // -----------------------------------------------------------------
  // Versioned, effective-dated statutory configuration. `spec` shape is
  // validated per kind in hr.ts. Operators enter verified values; the
  // run freezes the exact spec rows it used (statutoryVersionIds).
  statutorySettings: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("pf"),
      v.literal("esi"),
      v.literal("pt"),
      v.literal("tds"),
      v.literal("lwf"),
      v.literal("gratuity"),
    ),
    spec: v.any(),
    version: v.number(),
    effectiveFrom: v.string(), // YYYY-MM-DD
    effectiveTo: v.optional(v.string()),
    note: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org_kind", ["orgId", "kind"])
    .index("by_org", ["orgId"]),

  // Component-wise salary structures, effective-dated. A new structure
  // is a new row — history is never overwritten.
  salaryStructures: defineTable({
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    effectiveFrom: v.string(),
    monthlyPaise: v.array(
      v.object({
        component: v.string(),
        amountPaise: v.number(),
        type: v.union(v.literal("earning"), v.literal("deduction")),
      }),
    ),
    note: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_employee", ["employeeId"])
    .index("by_org", ["orgId"]),

  // Per-employee payslip rows. Components are frozen at finalization;
  // LOP and unpaid-leave days are recorded on the row for audit.
  payslips: defineTable({
    orgId: v.id("organizations"),
    runId: v.id("payrollRuns"),
    employeeId: v.id("employees"),
    userId: v.optional(v.id("users")),
    period: v.string(), // "YYYY-MM"
    status: v.union(v.literal("preview"), v.literal("final")),
    earningsPaise: v.array(
      v.object({ component: v.string(), amountPaise: v.number() }),
    ),
    deductionsPaise: v.array(
      v.object({ component: v.string(), amountPaise: v.number() }),
    ),
    grossPaise: v.number(),
    netPaise: v.number(),
    lopDays: v.optional(v.number()),
    unpaidLeaveDays: v.optional(v.number()),
    remarks: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_employee_period", ["employeeId", "period"]),

  // Payroll run header: draft → in_review → approved → finalized
  // (+ reversed). Unique (org, period) enforced in hr.ts; the bank file
  // generation is deliberately separate from payment-status marking so
  // "produced a transfer file" is never confused with "money moved".
  payrollRuns: defineTable({
    orgId: v.id("organizations"),
    period: v.string(), // "YYYY-MM" (IST month)
    status: v.union(
      v.literal("draft"),
      v.literal("in_review"),
      v.literal("approved"),
      v.literal("finalized"),
      v.literal("reversed"),
    ),
    grossPaise: v.number(),
    deductionsPaise: v.number(),
    netPaise: v.number(),
    statutoryVersionIds: v.optional(v.array(v.id("statutorySettings"))),
    journalEntryId: v.optional(v.id("journalEntries")),
    reversalEntryId: v.optional(v.id("journalEntries")),
    bankFileContent: v.optional(v.string()),
    bankFileGeneratedAt: v.optional(v.number()),
    bankFileGeneratedById: v.optional(v.id("users")),
    paymentsMarkedAt: v.optional(v.number()),
    paymentsMarkedById: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
  })
    .index("by_org_period", ["orgId", "period"])
    .index("by_org", ["orgId"]),

  // -----------------------------------------------------------------
  // Accounting (double-entry core)
  // -----------------------------------------------------------------
  // Chart of accounts. `code` unique per org (enforced in finance.ts).
  // clientFund marks client-money ledgers, which are tracked separately
  // from operating money and need a role gate in addition to capability.
  accounts: defineTable({
    orgId: v.id("organizations"),
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("income"),
      v.literal("expense"),
      v.literal("equity"),
    ),
    subtype: v.optional(v.string()), // bank/cash/receivable/payable/retainer/…
    clientFund: v.optional(v.boolean()),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Fiscal years. A closed year forbids journal posting into its date
  // range (enforced in finance.ts).
  fiscalYears: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    start: v.string(), // YYYY-MM-DD
    end: v.string(),
    closed: v.boolean(),
    closedAt: v.optional(v.number()),
    closedById: v.optional(v.id("users")),
  }).index("by_org", ["orgId"]),

  // Journal entries — the double-entry core. debits/credits are arrays
  // of {accountId, amountPaise}; sum(debits) === sum(credits) is checked
  // before post. Posted rows are immutable; corrections create a new
  // balanced reversal entry. dedupeKey gives retry safety for source-
  // generated entries (billing/payroll). originalLineIds freezes which
  // source rows (e.g. the invoice) a billing journal unwinds — the
  // cancellation/refund path references exactly what was posted.
  journalEntries: defineTable({
    orgId: v.id("organizations"),
    entryDate: v.string(), // YYYY-MM-DD
    memo: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("posted"),
      v.literal("reversed"),
    ),
    source: v.union(
      v.literal("manual"),
      v.literal("billing"),
      v.literal("payroll"),
    ),
    sourceId: v.optional(v.string()),
    originalLineIds: v.optional(v.array(v.id("invoices"))),
    debits: v.array(
      v.object({ accountId: v.id("accounts"), amountPaise: v.number() }),
    ),
    credits: v.array(
      v.object({ accountId: v.id("accounts"), amountPaise: v.number() }),
    ),
    reversalOfId: v.optional(v.id("journalEntries")),
    dedupeKey: v.optional(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_dedupe", ["dedupeKey"]),

  // -----------------------------------------------------------------
  // Evidence history — the append-only custody store. The per-document
  // `custody` array on matterDocuments is a bounded recent-events trail
  // (oldest fall off past 200 so a hot document cannot grow its row
  // without bound). EVERY event is ALSO mirrored here, unbounded, and
  // never updated or deleted: this table is the complete history. Reads
  // are paginated; per-version integrity history rides the vaultVersions
  // linkage (each version's hash claims/verifications keep their rows).
  // -----------------------------------------------------------------
  documentCustodyEvents: defineTable({
    orgId: v.id("organizations"),
    documentId: v.id("matterDocuments"),
    matterId: v.id("matters"),
    at: v.number(),
    byId: v.optional(v.id("users")),
    byName: v.optional(v.string()),
    action: v.union(...CUSTODY_ACTIONS.map((a) => v.literal(a))),
    note: v.optional(v.string()),
    // Which document version the event belongs to (null = the live row).
    version: v.optional(v.number()),
  })
    .index("by_document", ["documentId"])
    .index("by_org", ["orgId"]),
};

// =====================================================================
// FEATURE 9 — Undertakings Register. Rows are org-scoped; matter rows
// are additionally gated by the shared canViewMatter rule.
// =====================================================================

export const featureNineTables = {
  // One row per undertaking. Lifecycle: draft → pending_approval →
  // active → completed_pending_verification → discharged; active rows
  // may be breached; unfinished rows may be withdrawn. Nothing is ever
  // silently deleted: active rows cannot be deleted at all, and every
  // correction appends to `corrections` with the previous text kept.
  undertakings: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    text: v.string(), // the undertaking itself
    direction: v.union(v.literal("given"), v.literal("received")),
    party: v.optional(v.string()), // involved party
    givenOn: v.optional(v.string()), // YYYY-MM-DD — when accepted
    dueAt: v.optional(v.number()), // completion deadline (epoch ms)
    responsibleId: v.id("users"),
    supervisingId: v.id("users"),
    conditions: v.optional(v.string()),
    completionEvidence: v.optional(
      v.object({
        note: v.optional(v.string()),
        documentId: v.optional(v.id("matterDocuments")),
        recordedAt: v.number(),
        recordedById: v.id("users"),
        recordedByName: v.string(),
      }),
    ),
    verificationNote: v.optional(v.string()), // supervisory verification
    notes: v.optional(v.string()),
    confidential: v.optional(v.boolean()), // excluded from firm reports
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("active"),
      v.literal("completed_pending_verification"),
      v.literal("discharged"),
      v.literal("withdrawn"),
      v.literal("breached"),
    ),
    // Approval trail (activation requires the supervising lawyer).
    submittedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id("users")),
    approvedByName: v.optional(v.string()),
    rejectedReason: v.optional(v.string()), // return-to-draft reason
    withdrawnAt: v.optional(v.number()),
    withdrawnById: v.optional(v.id("users")),
    withdrawnReason: v.optional(v.string()),
    dischargedAt: v.optional(v.number()),
    dischargedById: v.optional(v.id("users")),
    dischargedByName: v.optional(v.string()),
    breachedAt: v.optional(v.number()),
    breachedById: v.optional(v.id("users")),
    breachExplanation: v.optional(v.string()),
    // Every in-place edit appends here — previous values preserved.
    corrections: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.id("users"),
          byName: v.string(),
          reason: v.string(),
          field: v.string(),
          previous: v.string(),
          next: v.string(),
        }),
      ),
    ),
    createdById: v.id("users"),
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_status", ["status"]), // org-agnostic scan for the escalation cron
};

// =====================================================================
// DOCUMENT VAULT — extensions. Existing tables stay untouched; vault
// metadata lives in two new org-scoped tables that reference documents.
// =====================================================================

export const VAULT_FOLDERS = [
  "01 Pleadings",
  "02 Applications",
  "03 Orders",
  "04 Evidence",
  "05 Contracts",
  "06 Correspondence",
  "07 Client Documents",
  "08 Court Documents",
  "09 Financial",
  "10 Miscellaneous",
] as const;

export const vaultTables = {
  // One metadata row per filed document that has been vaulted. Absent
  // row = unclassified (still visible in the vault under "Unclassified").
  vaultMeta: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    documentId: v.id("matterDocuments"),
    folder: v.union(...VAULT_FOLDERS.map((f) => v.literal(f))),
    tags: v.optional(v.array(v.string())),
    classification: v.optional(v.string()), // free-text classification note
    archivedAt: v.optional(v.number()),
    archivedById: v.optional(v.id("users")),
    updatedById: v.id("users"),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_org_folder", ["orgId", "folder"])
    .index("by_document", ["documentId"])
    .index("by_matter", ["matterId"]),

  // Version register for vaulted documents. Uploads keep every prior
  // storageId — restore switches the document's live pointer without
  // destroying anything.
  vaultVersions: defineTable({
    orgId: v.id("organizations"),
    documentId: v.id("matterDocuments"),
    matterId: v.id("matters"),
    version: v.number(),
    storageId: v.optional(v.id("_storage")),
    name: v.string(),
    note: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    uploadedById: v.id("users"),
    uploadedByName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_document", ["documentId"]),
};

export const featureSixTables = {
  // Per-org approval policy per category. Rows are created lazily when
  // a firm overrides the default; absent rows use the pure defaults in
  // src/lib/commOutboxFlow.ts.
  commCategoryConfig: defineTable({
    orgId: v.id("organizations"),
    category: v.union(...COMM_CATEGORIES.map((c) => v.literal(c))),
    requiresApproval: v.boolean(),
    updatedById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_org_category", ["orgId", "category"])
    .index("by_org", ["orgId"]),

  // One row per outbound client communication. Approval attaches to an
  // EXACT version; later edits create a new version and reset approval.
  // Delivery states mirror the provider log; retries never duplicate a
  // live send (guarded on status).
  commOutbox: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    clientId: v.optional(v.id("clients")),
    category: v.union(...COMM_CATEGORIES.map((c) => v.literal(c))),
    channel: v.union(
      v.literal("email"),
      v.literal("whatsapp"),
      v.literal("in_thread"),
    ),
    recipientUserId: v.optional(v.id("users")),
    recipient: v.optional(v.string()), // email address / phone
    subject: v.string(),
    // Roll-up status of the CURRENT version + delivery pipeline.
    status: v.union(
      v.literal("draft"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("returned"),
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("awaiting_configuration"),
    ),
    requiresApproval: v.boolean(), // frozen from policy at creation
    currentVersion: v.number(),
    approvedVersion: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id("users")),
    approvedByName: v.optional(v.string()),
    reviewNote: v.optional(v.string()), // rejection/return comments
    // Source record provenance.
    sourceKind: v.optional(v.string()), // "hearing" | "order" | "deadline" | …
    sourceId: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    // Delivery bookkeeping.
    providerMessageId: v.optional(v.string()),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    conversationId: v.optional(v.id("conversations")),
    createdById: v.id("users"),
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_provider_msg", ["providerMessageId"]),

  // Immutable version rows — the exact approved text is preserved even
  // when later edits create new versions.
  commOutboxVersions: defineTable({
    outboxId: v.id("commOutbox"),
    version: v.number(),
    subject: v.string(),
    body: v.string(),
    status: v.union(
      v.literal("drafted"),
      v.literal("pending_approval"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("returned"),
    ),
    authorId: v.id("users"),
    authorName: v.optional(v.string()),
    reviewerId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id("users")),
    revisesVersion: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_outbox", ["outboxId"]),
};
