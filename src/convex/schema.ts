import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { DEADLINE_CATEGORIES } from "./constants";
import { CUSTODY_ACTIONS } from "../lib/evidenceIntegrity";
import {
  featureFiveTables,
  featureSixTables,
  featureNineTables,
  vaultTables,
  hrTables,
  platformOpsTables,
  legalIntelTables,
  LEGAL_DATE_KINDS,
} from "./schemaExtras";

// ---------------------------------------------------------------------
// Shared constants (imported across the backend)
// ---------------------------------------------------------------------

export const ORG_ROLES = [
  "owner",
  "partner",
  "senior_associate",
  "associate",
  "junior",
  "paralegal",
  "accountant",
  "administrator",
  "support_staff",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  partner: "Partner",
  senior_associate: "Senior Associate",
  associate: "Associate",
  junior: "Junior",
  paralegal: "Paralegal",
  accountant: "Accountant",
  administrator: "Administrator",
  support_staff: "Support Staff",
};

/** Legacy console roles kept for portal resolution of older accounts. */
export const CONSOLE_ORG_ROLES = [
  "firm_owner",
  "admin",
  "lawyer",
  "client",
  "member",
] as const;

export const MEMBERSHIP_STATUSES = {
  ACTIVE: "active",
  INVITED: "invited",
  SUSPENDED: "suspended",
} as const;

export const MATTER_STATUSES = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  ON_HOLD: "on_hold",
  CLOSED: "closed",
} as const;

// Task board statuses: To Do (pending) → In Progress → Review → Completed.
// "review" holds finished work awaiting a supervisor's approval before it
// counts as done; the pure helpers in lib/commandCentre treat review as
// still open.
export const TASK_STATUSES = ["pending", "in_progress", "review", "done"] as const;

/** Firm-wide tasks are filing / service / delivery / collection errands. */
export const TASK_KINDS = [
  "general",
  "filing",
  "service",
  "delivery",
  "collection",
] as const;

export const TASK_PRIORITIES = ["normal", "high", "urgent"] as const;

export { DEADLINE_CATEGORIES } from "./constants";

export type MatterStatus = (typeof MATTER_STATUSES)[keyof typeof MATTER_STATUSES];

export const INVOICE_STATUSES = {
  DRAFT: "draft",
  SENT: "sent",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;

export const matterStatusValidator = v.union(
  ...Object.values(MATTER_STATUSES).map((s) => v.literal(s)),
);

export const taskStatusValidator = v.union(
  ...TASK_STATUSES.map((s) => v.literal(s)),
);

export function portalForRole(
  role: string | null | undefined,
): "client" | "staff" | "firm" | null {
  if (!role) return null;
  if (role === "client") return "client";
  if (role === "support_staff" || role === "peon") return "staff";
  if (
    role === "firm_owner" ||
    role === "admin" ||
    role === "lawyer" ||
    role === "member"
  ) {
    return "firm";
  }
  return null;
}

export default defineSchema({
  ...authTables,
  ...featureFiveTables,
  ...featureSixTables,
  ...featureNineTables,
  ...vaultTables,
  ...hrTables,
  ...platformOpsTables,
  ...legalIntelTables,

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // Legacy console/portal role (memberships govern real permissions).
    role: v.optional(v.string()),
    // Organization the user is currently working in.
    activeOrgId: v.optional(v.id("organizations")),
    designation: v.optional(v.string()),
    phone: v.optional(v.string()),
    barCouncilId: v.optional(v.string()),
    // Platform operator flag (section 24) — never self-serve; granted
    // only via platform.bootstrapAdmin from PLATFORM_OWNER_EMAIL.
    isPlatformAdmin: v.optional(v.boolean()),
  }).index("email", ["email"]),

  // Convex Auth manages authSessions/authAccounts/authVerificationCodes
  // authRateLimits/authRefreshTokens via the authTables spread above.

  // Login history (security feature): one append-only row per successful
  // sign-in. Only self-viewable (myLoginHistory); no cross-account reads.
  loginEvents: defineTable({
    userId: v.id("users"),
    email: v.optional(v.string()),
    at: v.number(),
    // Coarse client hint — recorded from the browser, so indicative only.
    userAgent: v.optional(v.string()),
  }).index("by_user_time", ["userId", "at"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    kind: v.union(v.literal("chamber"), v.literal("firm")),
    // Profile & billing identity.
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    // Firm PAN — printed on invoices beneath the GSTIN.
    pan: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    // Payment instructions printed on invoices (bank / UPI).
    bankDetails: v.optional(v.string()),
    upiId: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
    // Financial settings.
    currency: v.string(),
    timezone: v.string(),
    financialYearStart: v.string(),
    taxLabel: v.string(),
    taxPercent: v.number(),
    invoicePrefix: v.string(),
    // Editable permission matrix: orgRole -> capability keys.
    permissions: v.optional(v.any()),
    // Section 26: firm-level legal defaults for AI context. DEFAULTS only —
    // lawyers confirm per-matter jurisdiction (matters.legalProfile).
    legalDefaults: v.optional(
      v.object({
        country: v.optional(v.string()),
        stateOrProvince: v.optional(v.string()),
      }),
    ),
    // Paid placements & promotions (section 23). Everything is disabled
    // until an owner records a compliance review and enables the feature.
    promotionsEnabled: v.optional(v.boolean()),
    promotionsComplianceNote: v.optional(v.string()),
    promotionsComplianceAt: v.optional(v.number()),
    promotionsComplianceBy: v.optional(v.id("users")),
    // Dismissible promotional pop-up on the public directory, frequency-
    // capped per visitor (localStorage), shown only when enabled.
    promoPopupEnabled: v.optional(v.boolean()),
    promoPopupHeadline: v.optional(v.string()),
    promoPopupBody: v.optional(v.string()),
    promoPopupCta: v.optional(v.string()),
    // Commercial SaaS subscription (section 24). Plan-independent state
    // lives here so access gating reads one row: trial window, paid
    // window, grace period after expiry, read-only once past grace.
    subscription: v.optional(
      v.object({
        planId: v.optional(v.id("saasPlans")),
        status: v.union(
          v.literal("trialing"),
          v.literal("active"),
          v.literal("past_due"),
          v.literal("grace"),
          v.literal("read_only"),
          v.literal("cancelled"),
          v.literal("closed"),
        ),
        trialEndsAt: v.optional(v.number()),
        currentPeriodEnd: v.optional(v.number()),
        // Commitment end when cancelling at period end.
        cancelAt: v.optional(v.number()),
        cancelledAt: v.optional(v.number()),
        endedAt: v.optional(v.number()),
        graceUntil: v.optional(v.number()),
      }),
    ),
    // Exceptional platform-owner access to THIS org's legal records.
    // Null/granted:null = no access. Explicitly authorized, expiring,
    // fully audited — never a default owner privilege.
    exceptionalAccess: v.optional(
      v.object({
        granted: v.boolean(),
        grantedBy: v.id("users"),
        grantedAt: v.number(),
        reason: v.string(),
        expiresAt: v.number(),
        revokedAt: v.optional(v.number()),
      }),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  memberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    orgRole: v.union(...ORG_ROLES.map((r) => v.literal(r))),
    status: v.union(
      v.literal("active"),
      v.literal("invited"),
      v.literal("suspended"),
    ),
    invitedBy: v.optional(v.id("users")),
    invitedEmail: v.optional(v.string()),
    invitedAt: v.optional(v.number()),
    // Owner/admin invites may be marked exempt from the subscription's
    // seat count (never for billable legal roles).
    seatExempt: v.optional(v.boolean()),
    joinedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["orgId", "userId"]),

  clients: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("individual"),
      v.literal("company"),
      v.literal("partnership"),
      v.literal("llp"),
      v.literal("trust"),
      v.literal("society"),
      v.literal("government"),
      v.literal("other"),
    ),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    pan: v.optional(v.string()),
    cin: v.optional(v.string()),
    notes: v.optional(v.string()),
    responsibleLawyerId: v.optional(v.id("users")),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    // The verified user account bound to this client for portal access.
    userId: v.optional(v.id("users")),
    // Billing identity.
    billingName: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"]),

  clientContacts: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    name: v.string(),
    relation: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_org", ["orgId"]),

  conflictChecks: defineTable({
    orgId: v.id("organizations"),
    clientId: v.optional(v.id("clients")),
    subject: v.string(),
    // ---- Legacy columns (original desk) kept for compatibility ----
    matches: v.optional(v.array(v.any())),
    status: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedNote: v.optional(v.string()),
    matchCount: v.optional(v.number()),
    note: v.optional(v.string()),
    reviewerId: v.optional(v.id("users")),
    // ---- Feature 3: full conflict intake ----
    proposedClientName: v.optional(v.string()),
    adverseParties: v.optional(v.array(v.string())),
    relatedCompanies: v.optional(v.array(v.string())),
    directorsBeneficialOwners: v.optional(v.array(v.string())),
    witnesses: v.optional(v.array(v.string())),
    aliases: v.optional(v.array(v.string())),
    relatedMatterRefs: v.optional(v.array(v.string())),
    referringParty: v.optional(v.string()),
    engagementDescription: v.optional(v.string()),
    // Search evidence (results the reviewer actually saw, incl.
    // restricted placeholders — stored so the report is reproducible).
    searchResults: v.optional(v.array(v.any())),
    matchSummary: v.optional(
      v.object({
        exact: v.number(),
        normalized: v.number(),
        possible: v.number(),
        restricted: v.number(),
      }),
    ),
    // Review lifecycle: pending -> classified -> (override) -> cleared /
    // rejected. "cleared" means the matter may be opened.
    reviewStatus: v.union(
      v.literal("pending"),
      v.literal("cleared"),
      v.literal("rejected"),
    ),
    classification: v.optional(
      v.union(
        v.literal("no_conflict"),
        v.literal("possible_conflict"),
        v.literal("confirmed_conflict"),
        v.literal("investigation_required"),
      ),
    ),
    classificationReason: v.optional(v.string()),
    decidedById: v.optional(v.id("users")),
    decidedByName: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    // Elevated override (confirmed conflict cleared by owner/partner).
    override: v.optional(
      v.object({
        byId: v.id("users"),
        byName: v.string(),
        reason: v.string(),
        at: v.number(),
      }),
    ),
    // Set when the engagement was ultimately opened as a matter.
    matterId: v.optional(v.id("matters")),
    createdBy: v.optional(v.id("users")),
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "reviewStatus"])
    .index("by_matter", ["matterId"]),

  // ---------------- Client intake & matter opening (Feature 4) ----------------
  // One row per staged client intake. Draft saving is a plain patch;
  // the lifecycle state machine lives in lib/intakeFlow.ts and is
  // enforced server-side in convex/intake.ts. Client and matter records
  // are created EXACTLY ONCE at approval, guarded by createdClientId /
  // createdMatterId.
  intakes: defineTable({
    orgId: v.id("organizations"),
    // draft -> submitted -> returned_for_correction / rejected /
    // approved / cancelled (enforced by canTransitionIntake).
    state: v.union(
      v.literal("draft"),
      v.literal("submitted"),
      v.literal("returned_for_correction"),
      v.literal("rejected"),
      v.literal("approved"),
      v.literal("cancelled"),
    ),
    // The staged form: identity/contact, party details, matter, parties
    // involved, conflict confirmation, KYC, referral, fees, engagement,
    // risk and team — shape defined by IntakeFormData.
    form: v.any(),
    // Prospective-client identity used for duplicate prevention.
    prospectiveName: v.string(),
    prospectiveEmail: v.optional(v.string()),
    prospectivePhone: v.optional(v.string()),
    prospectiveIdentityNo: v.optional(v.string()),
    duplicateHits: v.optional(v.array(v.any())),
    duplicatesAcknowledged: v.optional(v.boolean()),
    duplicatesAcknowledgeById: v.optional(v.id("users")),
    duplicatesAcknowledgeByName: v.optional(v.string()),
    duplicatesAcknowledgeAt: v.optional(v.number()),
    // Existing client portal: invitation-binding + authentication.
    clientMode: v.union(
      v.literal("new_client"),
      v.literal("existing_client"),
    ),
    invite: v.optional(
      v.object({
        email: v.string(),
        salt: v.string(),
        tokenHash: v.string(),
        expiresAt: v.number(),
        createdAt: v.number(),
        usedAt: v.optional(v.number()),
        revokedAt: v.optional(v.number()),
      }),
    ),
    clientUserId: v.optional(v.id("users")),
    clientCompletedAt: v.optional(v.number()),
    // Review trail.
    reviewNote: v.optional(v.string()),
    reviewedById: v.optional(v.id("users")),
    reviewedByName: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    // Feature-3 tie-in: approval requires a cleared check.
    conflictCheckId: v.optional(v.id("conflictChecks")),
    // Exactly-once creation of the client and matter records.
    createdClientId: v.optional(v.id("clients")),
    createdMatterId: v.optional(v.id("matters")),
    approvedById: v.optional(v.id("users")),
    approvedByName: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    // Who started this intake (firm staff) — null for client-created.
    createdById: v.optional(v.id("users")),
    createdByName: v.optional(v.string()),
    lastEditedById: v.optional(v.id("users")),
    lastEditedByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_state", ["orgId", "state"]),

  matters: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    reference: v.string(), // e.g. ADV/2026/0001
    title: v.string(),
    practiceArea: v.string(),
    description: v.optional(v.string()),
    // Section 26 jurisdiction-aware legal profile. Firm settings provide
    // DEFAULTS only; lawyers (matter.edit) confirm or correct per matter.
    // The AI never silently applies the firm's default law to a matter
    // recorded for another jurisdiction.
    legalProfile: v.optional(
      v.object({
        country: v.string(), // lowercase ISO-ish, e.g. "in"
        stateOrProvince: v.optional(v.string()),
        // Relevant legal dates (any subset):
        legalDates: v.optional(
          v.array(
            v.object({
              kind: v.union(...LEGAL_DATE_KINDS.map((k) => v.literal(k))),
              date: v.string(), // YYYY-MM-DD
            }),
          ),
        ),
        proceduralStage: v.optional(v.string()),
        governingLawClause: v.optional(v.string()),
        crossBorderFactors: v.optional(v.string()),
        confirmedById: v.optional(v.id("users")),
        confirmedAt: v.optional(v.number()),
      }),
    ),
    status: matterStatusValidator,
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    ),
    court: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    bench: v.optional(v.string()),
    // Court-registry identifiers (guided New Matter form, Court step).
    caseType: v.optional(v.string()),
    caseYear: v.optional(v.string()),
    courtroom: v.optional(v.string()),
    cnrNumber: v.optional(v.string()),
    filingNumber: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    // Parties detail captured at opening (parties are also seeded into
    // matterParties when provided).
    clientRole: v.optional(v.string()),
    otherParties: v.optional(v.string()),
    // Structured billing (Billing step); billingArrangement keeps the
    // free-text summary for display.
    billingType: v.optional(
      v.union(
        v.literal("hourly"),
        v.literal("fixed"),
        v.literal("retainer"),
        v.literal("non_billable"),
      ),
    ),
    billingRate: v.optional(v.string()),
    opposingParty: v.optional(v.string()),
    opposingCounsel: v.optional(v.string()),
    billingArrangement: v.optional(v.string()),
    // Key dates shown on the overview (label + date string YYYY-MM-DD).
    keyDates: v.optional(
      v.array(v.object({ label: v.string(), date: v.string() })),
    ),
    teamIds: v.optional(v.array(v.id("users"))),
    leadLawyerId: v.optional(v.id("users")),
    restrictedToTeam: v.optional(v.boolean()),
    nextHearingAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("users")),
    clientSubmission: v.optional(v.boolean()),
    // Conflict-of-interest provenance: the check that cleared (or was
    // overridden to clear) this engagement before opening.
    conflictCheckId: v.optional(v.id("conflictChecks")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_client", ["clientId"])
    .index("by_status", ["status"]),

  matterParties: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    name: v.string(),
    side: v.union(v.literal("ours"), v.literal("opposing"), v.literal("neutral")),
    role: v.optional(v.string()),
    counsel: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]),

  matterIssues: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    title: v.string(),
    detail: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("argued"), v.literal("resolved")),
    // AI-suggested evidence rows are labeled and removable by a human.
    evidence: v.optional(
      v.array(
        v.object({
          label: v.string(),
          documentId: v.optional(v.id("matterDocuments")),
          supports: v.boolean(),
          aiSuggested: v.optional(v.boolean()),
        }),
      ),
    ),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_matter", ["matterId"]),

  matterEvents: defineTable({
    matterId: v.id("matters"),
    kind: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
    // Chronology enrichment (all optional for legacy rows).
    authorId: v.optional(v.id("users")),
    // When the event actually occurred; falls back to createdAt.
    occurredAt: v.optional(v.number()),
    // "day" = known day, no time; "approx" = uncertain date.
    datePrecision: v.optional(
      v.union(v.literal("exact"), v.literal("day"), v.literal("approx")),
    ),
    sourceRef: v.optional(v.string()),
    linkKind: v.optional(
      v.union(
        v.literal("document"),
        v.literal("hearing"),
        v.literal("order"),
        v.literal("message"),
      ),
    ),
    linkId: v.optional(v.string()),
    visibility: v.optional(
      v.union(v.literal("internal"), v.literal("shared_with_client")),
    ),
    // AI-extracted events stay suggestions until reviewed.
    aiSuggested: v.optional(v.boolean()),
    reviewed: v.optional(v.boolean()),
    // Correction history.
    correctedAt: v.optional(v.number()),
    correctedBy: v.optional(v.id("users")),
    supersedes: v.optional(v.id("matterEvents")),
  }).index("by_matter", ["matterId"]),

  hearings: defineTable({
    matterId: v.id("matters"),
    title: v.string(),
    court: v.optional(v.string()),
    at: v.number(),
    appearance: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("held"),
      v.literal("adjourned"),
      v.literal("cancelled"),
    ),
    // Court-day detail.
    courtroom: v.optional(v.string()),
    judge: v.optional(v.string()),
    purpose: v.optional(v.string()),
    appearingAdvocateId: v.optional(v.id("users")),
    prepNotes: v.optional(v.string()),
    requiredDocuments: v.optional(v.array(v.string())),
    // Outcome recorded after the hearing.
    outcome: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    outcomeRecordedBy: v.optional(v.id("users")),
    outcomeRecordedAt: v.optional(v.number()),
    // Manually maintained authorities / source links for the court brief.
    authorities: v.optional(
      v.array(v.object({ label: v.string(), url: v.optional(v.string()) })),
    ),
    // Reminder lead times in days before the hearing (30/14/7/3/1),
    // per hearing; 0 = the morning of the hearing. Falls back to the
    // firm default when unset.
    reminderDays: v.optional(v.array(v.number())),
    // Reschedule audit trail — every move appends {who, when, reason,
    // oldAt, newAt}. Prior entries are never overwritten.
    reschedules: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.id("users"),
          byName: v.string(),
          reason: v.string(),
          oldAt: v.number(),
          newAt: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_status", ["status"])
    .index("by_at", ["at"]),

  orders: defineTable({
    matterId: v.id("matters"),
    title: v.string(),
    passedOn: v.number(),
    summary: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    // The hearing this order was passed in (optional link).
    hearingId: v.optional(v.id("hearings")),
    // Directions extracted from the order and their follow-up state.
    directions: v.optional(
      v.array(v.object({ text: v.string(), done: v.boolean() })),
    ),
    followUp: v.optional(v.string()),
    // Review trail for the attention docket.
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]),

  matterDocuments: defineTable({
    matterId: v.id("matters"),
    uploaderId: v.id("users"),
    name: v.string(),
    kind: v.union(v.literal("document"), v.literal("communication")),
    visibility: v.union(
      v.literal("internal"),
      v.literal("shared_with_client"),
    ),
    storageId: v.optional(v.id("_storage")),
    // Evidence integrity (2026 expansion): SHA-256 (lowercase hex) of the
    // exact stored bytes, computed by the uploader's browser at upload
    // time. Independently re-verifiable server-side via the
    // evidence.verifyDocumentIntegrity action.
    integritySha256: v.optional(v.string()),
    // Chain of custody: capped append-only trail (see
    // src/lib/evidenceIntegrity.ts). The org audit log remains the
    // complete record for consequential actions.
    custody: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.optional(v.id("users")),
          byName: v.optional(v.string()),
          action: v.union(...CUSTODY_ACTIONS.map((a) => v.literal(a))),
          note: v.optional(v.string()),
        }),
      ),
    ),
    // Client portal submissions land here.
    submittedByClient: v.optional(v.boolean()),
    requestedFromClient: v.optional(v.boolean()),
    requestedNote: v.optional(v.string()),
    seenByClient: v.optional(v.array(v.id("users"))),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]),

  // Draft review & approval desk — one row per drafted document, one
  // immutable row per version. Approval attaches to a specific version;
  // new text always means a new version requiring fresh review.
  drafts: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    title: v.string(),
    kind: v.union(
      v.literal("client_update"),
      v.literal("legal_notice"),
      v.literal("petition_draft"),
      v.literal("internal_memo"),
      v.literal("other"),
    ),
    currentVersion: v.number(),
    // Roll-up status of the current version.
    status: v.union(
      v.literal("drafted"),
      v.literal("in_review"),
      v.literal("change_requested"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("shared"),
      v.literal("filed"),
    ),
    createdById: v.id("users"),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_status", ["status"]),

  draftVersions: defineTable({
    draftId: v.id("drafts"),
    version: v.number(),
    body: v.string(),
    // drafted -> in_review -> approved / rejected; shared/filed after approval.
    status: v.union(
      v.literal("drafted"),
      v.literal("in_review"),
      v.literal("change_requested"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("shared"),
      v.literal("filed"),
    ),
    authorId: v.id("users"),
    reviewerId: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedById: v.optional(v.id("users")),
    // Version lineage: the version this revision replaces.
    revisesVersion: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // Comments/annotations and change requests against a specific version.
  draftComments: defineTable({
    draftId: v.id("drafts"),
    version: v.number(),
    authorId: v.id("users"),
    body: v.string(),
    // A change request blocks approval until a new version addresses it.
    isChangeRequest: v.optional(v.boolean()),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // Client document-request checklists — one row per requested item.
  // Client uploads land as `pending` submissions and stay separate from
  // firm-approved material until a reviewer accepts them.
  documentRequests: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    requestedById: v.id("users"),
    title: v.string(),
    instructions: v.optional(v.string()),
    // End of the local due date (Asia/Kolkata).
    dueAt: v.optional(v.number()),
    status: v.union(
      v.literal("requested"),
      v.literal("uploaded"),
      v.literal("under_review"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),
    // Latest client submission (pending review). Storage ids of prior
    // submissions are kept in `submissions` — accepted versions are
    // never silently overwritten.
    currentStorageId: v.optional(v.id("_storage")),
    currentUploadedAt: v.optional(v.number()),
    submissions: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          name: v.string(),
          uploadedAt: v.number(),
          // Feature 7 — provenance + integrity metadata per version.
          sizeBytes: v.optional(v.number()),
          // Declared-by-uploader checksum (SHA-256 hex, hashed in the
          // browser before upload). Honest provenance: recorded as
          // declared, never presented as server-verified.
          checksum: v.optional(v.string()),
          uploadedByUserId: v.optional(v.id("users")),
          uploadedByName: v.optional(v.string()),
          scanStatus: v.optional(
            v.union(
              v.literal("awaiting_configuration"),
              v.literal("pending"),
              v.literal("clean"),
              v.literal("infected"),
            ),
          ),
        }),
      ),
    ),
    // Feature 7 — accepted file formats (lowercase extensions without
    // the dot, e.g. ["pdf","jpg"]; empty = any format accepted).
    acceptedFormats: v.optional(v.array(v.string())),
    // Feature 7 — checklist items the client must tick at upload
    // ("signed original", "notarised copy", …).
    checklistItems: v.optional(v.array(v.string())),
    // Feature 7 — per-request upload size cap in MB (absent = default).
    maxFileMb: v.optional(v.number()),
    // Feature 7 — malware scan status of the CURRENT submission.
    // `pending` = file held in quarantine until a scan clears it;
    // `awaiting_configuration` = no scanner configured — the chamber
    // says so honestly and never claims a scan occurred.
    scanStatus: v.optional(
      v.union(
        v.literal("awaiting_configuration"),
        v.literal("pending"),
        v.literal("clean"),
        v.literal("infected"),
      ),
    ),
    scanNote: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedById: v.optional(v.id("users")),
    // The accepted document copied into the firm's record.
    acceptedDocumentId: v.optional(v.id("matterDocuments")),
    comments: v.optional(
      v.array(
        v.object({
          // Null author = the client wrote it.
          authorId: v.optional(v.id("users")),
          fromClient: v.boolean(),
          body: v.string(),
          at: v.number(),
        }),
      ),
    ),
    lastReminderAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_status", ["status"]),

  // Feature 7 — audited download register. One immutable row per
  // authorised file access (who, which file, which submission version).
  // Never stores file content and is never deleted — it is the record
  // that a download happened.
  fileAccessLog: defineTable({
    orgId: v.id("organizations"),
    requestId: v.id("documentRequests"),
    matterId: v.id("matters"),
    storageId: v.id("_storage"),
    viewerId: v.optional(v.id("users")),
    viewerEmail: v.optional(v.string()),
    asClient: v.boolean(),
    // -1 = the current submission; otherwise the index in `submissions`.
    submissionIndex: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_request", ["requestId"]),

  matterNotes: defineTable({
    matterId: v.id("matters"),
    authorId: v.optional(v.id("users")),
    body: v.string(),
    fromClient: v.optional(v.boolean()),
    toClient: v.optional(v.boolean()),
    // Note confidentiality: internal working notes vs notes shared with
    // the client (client-portal reads continue to key off fromClient /
    // toClient; this stamps intent on every note).
    confidentiality: v.optional(
      v.union(v.literal("internal"), v.literal("shared_with_client")),
    ),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]),

  tasks: defineTable({
    // Null matterId = firm-wide (office errand) task.
    matterId: v.optional(v.id("matters")),
    orgId: v.id("organizations"),
    title: v.string(),
    kind: v.union(...TASK_KINDS.map((k) => v.literal(k))),
    priority: v.union(...TASK_PRIORITIES.map((p) => v.literal(p))),
    dueAt: v.optional(v.number()),
    status: v.union(...TASK_STATUSES.map((s) => v.literal(s))),
    assigneeId: v.optional(v.id("users")),
    createdById: v.id("users"),
    // Provenance: set when the task was created by an automation rule;
    // such tasks surface a review chip until confirmed or rejected.
    automationRunId: v.optional(v.id("automationRuns")),
    // Completion evidence — a note plus optional uploaded proof files.
    completionNote: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    completedById: v.optional(v.id("users")),
    comments: v.optional(
      v.array(
        v.object({
          authorId: v.id("users"),
          body: v.string(),
          at: v.number(),
        }),
      ),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          name: v.string(),
          storageId: v.id("_storage"),
          at: v.number(),
        }),
      ),
    ),
    staffUpdates: v.optional(
      v.array(v.object({ body: v.string(), at: v.number() })),
    ),
    acknowledgements: v.optional(
      v.array(
        v.object({
          name: v.string(),
          storageId: v.id("_storage"),
          at: v.number(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_status", ["status"])
    .index("by_due", ["dueAt"])
    .index("by_assignee", ["assigneeId"])
    .index("by_assignee_status", ["assigneeId", "status"]),

  // Legally significant deadlines with reminder + audit history.
  deadlines: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    title: v.string(),
    category: v.union(...DEADLINE_CATEGORIES.map((c) => v.literal(c))),
    // End of the local due date (Asia/Kolkata) — never overdue early.
    dueAt: v.number(),
    status: v.union(v.literal("open"), v.literal("completed")),
    responsibleId: v.optional(v.id("users")),
    createdById: v.id("users"),
    reminderAt: v.optional(v.number()),
    completionNote: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    completedById: v.optional(v.id("users")),
    history: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.id("users"),
          text: v.string(),
        }),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_status", ["status"])
    .index("by_due", ["dueAt"]),

  // Playbook templates — editable, versioned, applied as copies.
  playbooks: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    matterType: v.string(),
    description: v.optional(v.string()),
    currentVersion: v.number(),
    createdById: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"]),

  playbookVersions: defineTable({
    playbookId: v.id("playbooks"),
    version: v.number(),
    stages: v.array(
      v.object({
        name: v.string(),
        tasks: v.array(
          v.object({
            title: v.string(),
            kind: v.union(...TASK_KINDS.map((k) => v.literal(k))),
            daysFromStart: v.optional(v.number()),
          }),
        ),
        requiredDocuments: v.array(v.string()),
      }),
    ),
    createdById: v.id("users"),
    createdAt: v.number(),
  }).index("by_playbook", ["playbookId"]),

  // One record per application of a playbook to a matter.
  playbookRuns: defineTable({
    playbookId: v.id("playbooks"),
    playbookVersion: v.number(),
    matterId: v.id("matters"),
    appliedById: v.id("users"),
    appliedAt: v.number(),
    createdTaskIds: v.array(v.id("tasks")),
    createdDeadlineIds: v.array(v.id("deadlines")),
  }).index("by_matter", ["matterId"]),

  timeEntries: defineTable({
    matterId: v.id("matters"),
    userId: v.id("users"),
    description: v.string(),
    minutes: v.number(),
    ratePerHour: v.number(),
    date: v.string(),
    invoiceId: v.optional(v.id("invoices")),
    // Vault-era additions (all optional — legacy rows read fine).
    billable: v.optional(v.boolean()),
    startedAt: v.optional(v.number()), // timer-originated entries
    endedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_uninvoiced", ["matterId", "invoiceId"]),

  expenses: defineTable({
    matterId: v.id("matters"),
    description: v.string(),
    amount: v.number(),
    date: v.string(),
    invoiceId: v.optional(v.id("invoices")),
    // Vault-era additions (all optional — legacy rows read fine).
    category: v.optional(
      v.union(
        v.literal("court_fee"),
        v.literal("filing"),
        v.literal("travel"),
        v.literal("printing"),
        v.literal("courier"),
        v.literal("misc"),
      ),
    ),
    receiptStorageId: v.optional(v.id("_storage")),
    billable: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_uninvoiced", ["matterId", "invoiceId"]),

  // Invoices. All money is stored in integer paise (minor units);
  // totals are recalculated transactionally from lines on every change.
  invoices: defineTable({
    orgId: v.id("organizations"),
    number: v.string(),
    matterId: v.id("matters"),
    clientId: v.id("clients"),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partially_paid"),
      v.literal("paid"),
      v.literal("cancelled"),
      v.literal("credited"),
    ),
    // Billing arrangement this invoice was raised under.
    arrangement: v.optional(
      v.union(
        v.literal("hourly"),
        v.literal("fixed_fee"),
        v.literal("retainer"),
      ),
    ),
    // Itemised lines — editable until sent; recalcs derive totals.
    lines: v.optional(
      v.array(
        v.object({
          description: v.string(),
          // Integer paise, before tax.
          amountMinor: v.number(),
          // "time" | "expense" | "fee" | "expense_reimbursement"
          kind: v.string(),
          // For time lines: the billed minutes and rate (paise/hour).
          minutes: v.optional(v.number()),
          ratePerHourMinor: v.optional(v.number()),
          linkedTimeEntryId: v.optional(v.id("timeEntries")),
          linkedExpenseId: v.optional(v.id("expenses")),
        }),
      ),
    ),
    subtotalMinor: v.number(),
    discountPercentMinor: v.optional(v.number()), // basis points (e.g. 1050 = 10.50%)
    discountAmountMinor: v.optional(v.number()),
    // Tax model: "intra_state" -> CGST+SGST split; "inter_state" -> IGST;
    // "none" -> no tax (configurable per invoice — legal services vary).
    taxModel: v.union(
      v.literal("none"),
      v.literal("intra_state"),
      v.literal("inter_state"),
    ),
    taxRateBps: v.optional(v.number()), // basis points over taxable value
    cgstMinor: v.optional(v.number()),
    sgstMinor: v.optional(v.number()),
    igstMinor: v.optional(v.number()),
    totalMinor: v.number(),
    amountPaidMinor: v.number(),
    amountCreditedMinor: v.optional(v.number()),
    notes: v.optional(v.string()),
    issuedOn: v.string(),
    dueOn: v.optional(v.string()),
    // Payment link (Razorpay) for the outstanding balance.
    paymentLinkId: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    paymentOrderId: v.optional(v.string()),
    // Financial audit trail (append-only summaries).
    audit: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.optional(v.id("users")),
          byName: v.string(),
          text: v.string(),
        }),
      ),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_client", ["clientId"]),

  payments: defineTable({
    invoiceId: v.id("invoices"),
    orgId: v.id("organizations"),
    // Integer paise.
    amountMinor: v.number(),
    // "manual_*" = recorded by the chamber; otherwise the provider.
    mode: v.optional(
      v.union(
        v.literal("upi"),
        v.literal("neft"),
        v.literal("cash"),
        v.literal("cheque"),
        v.literal("other"),
      ),
    ),
    source: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("razorpay"),
      ),
    ),
    reference: v.optional(v.string()),
    receivedOn: v.string(),
    // Provider reconciliation fields.
    providerPaymentId: v.optional(v.string()),
    providerOrderId: v.optional(v.string()),
    // The merchant account that CAPTURED this money (firm flows):
    // refunds always go back through THIS account, even after the firm
    // rotates credentials or connects a different account.
    merchantId: v.optional(v.id("orgMerchants")),
    capturedMerchantRef: v.optional(v.string()),
    refundedMinor: v.optional(v.number()),
    refundIds: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(
        v.literal("captured"),
        // A refund has been authorized and is awaiting provider
        // confirmation; see refundRequests.
        v.literal("refund_pending"),
        v.literal("refunded"),
        v.literal("partially_refunded"),
      ),
    ),
    // ISO currency the provider reported (e.g. "INR"); validated against
    // the org's currency at reconciliation time.
    currency: v.optional(v.string()),
    recordedById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    // Cross-event-type payment dedupe: payment.captured, payment_link.paid
    // and order.paid all name the same provider payment — exactly one
    // payments row may ever exist per provider payment id.
    .index("by_provider_payment", ["providerPaymentId"]),

  // Verified Razorpay webhook events — one row per event id, so replays
  // are idempotent at the storage layer.
  paymentEvents: defineTable({
    orgId: v.id("organizations"),
    eventId: v.string(),
    eventType: v.string(),
    payload: v.optional(v.string()),
    handled: v.boolean(),
    handledAt: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_org", ["orgId"]),

  // Money received beyond what an invoice could absorb. The invoice
  // allocation is capped; the captured amount is never discarded — the
  // remainder is tracked here as an explicit customer credit / unapplied
  // receipt, visible to the chamber and refundable on request.
  unappliedCredits: defineTable({
    orgId: v.id("organizations"),
    invoiceId: v.id("invoices"),
    // The provider payment that carried the excess.
    paymentId: v.optional(v.id("payments")),
    providerPaymentId: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    amountMinor: v.number(),
    // "excess_received" until the chamber applies or refunds it.
    status: v.union(
      v.literal("excess_received"),
      v.literal("refunded"),
      v.literal("applied"),
    ),
    note: v.optional(v.string()),
    refundedMinor: v.optional(v.number()),
    resolvedById: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_org", ["orgId"]),

  // Refund lifecycle for provider payments: requested -> processed |
  // failed. State changes ONLY in Convex transactions; the provider call
  // confirms or rejects afterwards, so the books move exactly when the
  // refund actually happens and failed attempts never touch money.
  refundRequests: defineTable({
    orgId: v.id("organizations"),
    paymentId: v.id("payments"),
    invoiceId: v.optional(v.id("invoices")),
    providerPaymentId: v.optional(v.string()),
    // The merchant account that must issue this refund — frozen at
    // request time from the payment row; never "whatever is connected
    // now".
    merchantId: v.optional(v.id("orgMerchants")),
    amountMinor: v.number(),
    reason: v.optional(v.string()),
    // "requested": authorized locally, provider call in flight.
    // "processed": provider confirmed; money + journal applied.
    // "failed": provider rejected the attempt; nothing moved.
    status: v.union(
      v.literal("requested"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    requestedById: v.optional(v.id("users")),
    providerRefundId: v.optional(v.string()),
    processedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_payment", ["paymentId"])
    .index("by_org_status", ["orgId", "status"]),

  // Per-firm Razorpay merchant connections (owner decision, 30 Sep 2026):
  // firm-money flows (client invoices, consultation fees) collect through
  // the FIRM's own Razorpay account — never through the platform's
  // deployment-wide keys. Platform-money flows (CJ GLOBAL software
  // subscriptions, promotion purchases) keep using the deployment keys.
  // The secret is stored encrypted-at-rest (AES-256-GCM under
  // RAZORPAY_KEY_SECRET as the key-encryption key) and is never returned
  // to any client after being set.
  orgMerchants: defineTable({
    orgId: v.id("organizations"),
    provider: v.literal("razorpay"),
    // Stable public handle for THIS merchant account (rotation keeps
    // it; a different account gets a new one).
    merchantRef: v.string(),
    keyId: v.string(), // rzp_test_... / rzp_live_...
    encryptedSecret: v.string(), // base64(iv || ciphertext || tag)
    // The webhook secret for the FIRM's own Razorpay dashboard webhook.
    encryptedWebhookSecret: v.optional(v.string()),
    keyIdLast4: v.string(),
    // "test" connections never collect real money.
    mode: v.union(v.literal("test"), v.literal("live")),
    active: v.boolean(),
    // Audit trail: who connected/rotated/disabled.
    audit: v.optional(
      v.array(
        v.object({
          at: v.number(),
          byId: v.optional(v.id("users")),
          byName: v.string(),
          text: v.string(),
        }),
      ),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"]),

  // Consultation payment sessions (pay-before-booking, no invoice).
  consultations: defineTable({
    orgId: v.id("organizations"),
    clientName: v.string(),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    matterSummary: v.optional(v.string()),
    amountMinor: v.number(),
    // Booking lifecycle: "requested" (public) / "pending" (legacy chamber
    // link) → "accepted" (slot confirmed, awaiting payment when the fee is
    // non-zero) → "scheduled" (payment captured or free consultation).
    // "reschedule_proposed" waits for the requester to confirm; "completed",
    // "declined", "cancelled", "refunded" are terminal.
    status: v.union(
      v.literal("requested"),
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("scheduled"),
      v.literal("reschedule_proposed"),
      v.literal("paid"),
      v.literal("completed"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("refunded"),
    ),
    // "chamber" = created from the billing desk (legacy); "public" = booked
    // through the public directory.
    source: v.optional(v.union(v.literal("chamber"), v.literal("public"))),
    // Public bookings carry a reference code so the requester can look up,
    // confirm a reschedule or cancel without an account.
    reference: v.optional(v.string()),
    // The advocate the booking is for (public directory bookings).
    advocateUserId: v.optional(v.id("users")),
    profileId: v.optional(v.id("publicProfiles")),
    // Confirmed consultation time; proposedSlotAt is the counter-offer
    // while status is reschedule_proposed.
    slotAt: v.optional(v.number()),
    proposedSlotAt: v.optional(v.number()),
    // Signed-in requester (future use — public requesters are anonymous).
    requesterUserId: v.optional(v.id("users")),
    // Set when the chamber authorizes conversion to a connected client.
    connectedClientId: v.optional(v.id("clients")),
    cancelReason: v.optional(v.string()),
    // Status-change trail shown to both sides.
    history: v.optional(
      v.array(v.object({ at: v.number(), text: v.string() })),
    ),
    paymentOrderId: v.optional(v.string()),
    paymentLinkId: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    providerPaymentId: v.optional(v.string()),
    // Null for public bookings (no chamber member creates them).
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_reference", ["reference"]),

  // Public directory profiles (section 22). Publication is an explicit
  // toggle by the member; "verified" is only ever set by an actual
  // verification decision by an owner/administrator.
  publicProfiles: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    // Explicit publication — nothing appears publicly without this.
    published: v.boolean(),
    headline: v.optional(v.string()),
    qualifications: v.optional(v.string()),
    enrollmentNumber: v.optional(v.string()),
    enrollmentState: v.optional(v.string()),
    experienceYears: v.optional(v.number()),
    practiceAreas: v.array(v.string()),
    courts: v.array(v.string()),
    languages: v.array(v.string()),
    city: v.optional(v.string()),
    // Contact details the member chooses to expose publicly.
    publicEmail: v.optional(v.string()),
    publicPhone: v.optional(v.string()),
    // Consultation fee in paise (0 = free / decided case-by-case).
    feeMinor: v.number(),
    // Offered availability slots (label + exact start time).
    slots: v.optional(
      v.array(v.object({ label: v.string(), startsAt: v.number() })),
    ),
    availabilityNote: v.optional(v.string()),
    about: v.optional(v.string()),
    // Verification: only a decision by an owner/administrator moves this
    // out of "unverified"; the badge shows ONLY for "verified".
    verificationStatus: v.union(
      v.literal("unverified"),
      v.literal("pending"),
      v.literal("verified"),
      v.literal("rejected"),
    ),
    verifiedAt: v.optional(v.number()),
    verifiedById: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_published", ["published"]),

  invitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    // "staff" invites into the chamber; "client" links a client to the portal.
    kind: v.union(v.literal("staff"), v.literal("client")),
    orgRole: v.optional(v.union(...ORG_ROLES.map((r) => v.literal(r)))),
    clientId: v.optional(v.id("clients")),
    salt: v.string(),
    tokenHash: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    // Firm-administrator invites may be exempt from seat counting (see
    // section 24); billable legal roles are never marked exempt.
    seatExempt: v.optional(v.boolean()),
    createdAt: v.number(),
    usedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenHash"])
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),

  auditLog: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"]),

  // Editable per-role permission overrides.
  rolePermissions: defineTable({
    orgId: v.id("organizations"),
    orgRole: v.union(...ORG_ROLES.map((r) => v.literal(r))),
    permissions: v.array(v.string()),
    updatedBy: v.optional(v.id("users")),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org_role", ["orgId", "orgRole"])
    .index("by_org", ["orgId"]),

  // Two-factor authentication (per-user enrollment + session marks).
  twoFactor: defineTable({
    userId: v.id("users"),
    secret: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  recoveryCodes: defineTable({
    userId: v.id("users"),
    codeHash: v.string(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  twoFactorSessions: defineTable({
    userId: v.id("users"),
    sessionId: v.string(),
    at: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_session", ["sessionId"]),

  // Morning docket dismissals/snoozes (per user, per item).
  attentionStates: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    itemId: v.string(), // "<kind>:<id>"
    dismissedAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user_item", ["userId", "itemId"])
    .index("by_user_org", ["userId", "orgId"]),

  // Versioned one-click hearing packs: the selection that produced each
  // bundle, who generated it and when. The PDF is rebuilt from live,
  // access-enforced data at every generation and download.
  hearingPacks: defineTable({
    matterId: v.id("matters"),
    hearingId: v.optional(v.id("hearings")),
    version: v.number(),
    label: v.string(), // "v3 — 20 Sep 2026, 10:42"
    createdById: v.id("users"),
    createdAt: v.number(),
    selection: v.object({
      sectionIds: v.array(v.string()),
      orderIds: v.array(v.id("orders")),
      documentIds: v.array(v.id("matterDocuments")),
    }),
    // false = client-shared copy: internal material is excluded by default
    // and any internal item referenced by a stale selection is dropped.
    includeInternal: v.boolean(),
    storageId: v.optional(v.id("_storage")),
    downloads: v.number(),
  }).index("by_matter", ["matterId"]),

  // -------------------------------------------------------------------
  // Communications (section 19)
  // -------------------------------------------------------------------

  // Threads: matter-scoped (with the client) or internal (colleagues).
  conversations: defineTable({
    orgId: v.id("organizations"),
    matterId: v.optional(v.id("matters")),
    clientId: v.optional(v.id("clients")),
    scope: v.union(v.literal("matter"), v.literal("internal")),
    subject: v.string(),
    // Explicit per-thread authorization: send approved client updates
    // without linking a specific approved draft version each time.
    autoSendUpdates: v.optional(v.boolean()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    lastMessageAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"]),

  conversationParticipants: defineTable({
    conversationId: v.id("conversations"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("member"), v.literal("client")),
    // Unread message count is maintained per participant on send.
    unreadCount: v.number(),
    lastReadAt: v.optional(v.number()),
    addedBy: v.optional(v.id("users")),
    removedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conv_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    orgId: v.id("organizations"),
    senderId: v.optional(v.id("users")),
    // "member" (a colleague) | "client" (portal identity) | "system" (audit)
    senderKind: v.union(v.literal("member"), v.literal("client"), v.literal("system")),
    body: v.string(),
    // Attached matter documents (existing rows, access re-checked on read).
    attachmentDocumentIds: v.optional(v.array(v.id("matterDocuments"))),
    // Uploaded files/images (Convex storage). Chat-style sharing: images
    // render inline, other files download. Metadata + type are stored
    // alongside the storage id; access re-checked against the thread on read.
    attachmentFiles: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          name: v.string(),
          mimeType: v.string(),
          size: v.number(),
          // "image" renders inline; anything else offers a download.
          type: v.union(v.literal("image"), v.literal("file")),
        }),
      ),
    ),
    linkedInvoiceId: v.optional(v.id("invoices")),
    kind: v.optional(
      v.union(
        v.literal("message"),
        v.literal("client_update"),
        v.literal("reminder"),
        v.literal("note"),
      ),
    ),
    // Email integration: metadata for emails filed into a thread via
    // conversations.recordEmail. null for ordinary chat messages. Kept
    // structured (not only embedded in body text) so the email desk can
    // render From/To/Subject properly and the AI email jobs can quote it.
    emailMeta: v.optional(
      v.object({
        direction: v.union(v.literal("inbound"), v.literal("outbound")),
        fromAddress: v.string(),
        toAddress: v.string(),
        subject: v.string(),
        receivedAt: v.number(),
        filedById: v.optional(v.id("users")),
        filedByName: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_org", ["orgId"]),

  // Per-user notification channels. Email defaults on for portal users;
  // WhatsApp requires explicit opt-in (checked before every send).
  commPreferences: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    emailEnabled: v.boolean(),
    whatsappEnabled: v.boolean(),
    whatsappNumber: v.optional(v.string()),
    // Reminder categories the user accepts.
    hearingReminders: v.boolean(),
    invoiceReminders: v.boolean(),
    clientUpdates: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_org_user", ["orgId", "userId"]),

  // Every outbound email/WhatsApp: address, template, provider ids,
  // delivery/failure status from verified callbacks.
  notificationLog: defineTable({
    orgId: v.id("organizations"),
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    recipientUserId: v.optional(v.id("users")),
    recipient: v.string(),
    category: v.string(), // "verify" | "invite" | "client_update" | "hearing_reminder" | "invoice_reminder"
    subject: v.optional(v.string()),
    templateName: v.optional(v.string()),
    // Provider bookkeeping.
    providerMessageId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("failed"),
    ),
    failureReason: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_provider_msg", ["providerMessageId"])
    .index("by_org", ["orgId"]),

  // WhatsApp delivery callbacks — one row per message id, replays idempotent.
  whatsappEvents: defineTable({
    orgId: v.optional(v.id("organizations")),
    providerMessageId: v.string(),
    eventType: v.string(), // "sent" | "delivered" | "read" | "failed"
    payload: v.optional(v.string()),
    handled: v.boolean(),
    handledAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_msg_event", ["providerMessageId"]),

  // -------------------------------------------------------------------
  // Notifications & automation (section 20)
  // -------------------------------------------------------------------

  // In-app notification centre rows.
  appNotifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    kind: v.string(), // "hearing_reminder" | "deadline_reminder" | "task_assigned" | "doc_request" | "message" | "draft_approval" | "invoice_followup" | "automation"
    title: v.string(),
    body: v.optional(v.string()),
    // Deep-link destination inside the console.
    linkTo: v.optional(v.string()),
    // Idempotency: kind + stable reference of the source row.
    dedupeKey: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId"])
    .index("by_user_dedupe", ["userId", "dedupeKey"]),

  // Configurable automation rules: trigger -> conditions -> action.
  automationRules: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    enabled: v.boolean(),
    trigger: v.union(
      v.literal("deadline_reminder"),
      v.literal("hearing_tomorrow"),
      v.literal("invoice_overdue"),
    ),
    // Optional condition: only matters with this practice area.
    practiceArea: v.optional(v.string()),
    // Optional condition: minimum days overdue for invoices.
    minDaysOverdue: v.optional(v.number()),
    action: v.union(
      v.literal("notify_user"),
      v.literal("create_task"),
      v.literal("whatsapp_template"),
    ),
    // For notify_user / create_task: the responsible owner. For
    // whatsapp_template: "client" (the matter's opted-in client identity).
    ownerUserId: v.optional(v.id("users")),
    // create_task action: title prefix & due-in days.
    taskTitle: v.optional(v.string()),
    taskDueInDays: v.optional(v.number()),
    // whatsapp_template action.
    templateName: v.optional(v.string()),
    // Explicit authorization for external sends recorded per rule.
    whatsappAuthorized: v.optional(v.boolean()),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  // Per-user notification centre preferences (section 20).
  userNotificationPrefs: defineTable({
    userId: v.id("users"),
    // In-app centre is always on; this row controls extras/mutes.
    inApp: v.boolean(),
    // Also email me non-urgent updates (messages, approvals).
    emailUpdates: v.boolean(),
    // Notification kinds the user has muted in the centre.
    mutedKinds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Execution history: one row per (rule, trigger occurrence). The
  // unique occurrenceKey enforces duplicate prevention at the storage
  // layer, and every automated task/notification points back here for
  // human review.
  automationRuns: defineTable({
    ruleId: v.id("automationRules"),
    orgId: v.id("organizations"),
    // Stable key: "<trigger>:<rowId>:<occurrence>" — replays no-op.
    occurrenceKey: v.string(),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    detail: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    // Produced artefacts for review.
    createdTaskId: v.optional(v.id("tasks")),
    notifiedUserId: v.optional(v.id("users")),
    // Task classification review state for create_task actions.
    reviewState: v.optional(
      v.union(v.literal("pending"), v.literal("confirmed"), v.literal("rejected")),
    ),
    ranAt: v.number(),
  })
    .index("by_occurrence", ["occurrenceKey"])
    .index("by_rule", ["ruleId"]),

  // ===============================================================
  // Paid listings & promotions (section 23).
  //
  // Hard compliance gate: no promotion can be sold, displayed or paid
  // for until an owner records a professional-advertising review for
  // the operating jurisdiction and enables the feature. Paid placements
  // always render with an explicit sponsored label and are stored,
  // queried and rendered separately from organic results and from
  // verification badges.
  // ===============================================================

  // Purchasable promotion products, defined per organization by the
  // owner (e.g. "Sponsored listing, 30 days, ₹2,000").
  promotionPackages: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    placement: v.union(v.literal("sponsored_listing"), v.literal("banner"), v.literal("popup")),
    priceMinor: v.number(),
    durationDays: v.number(),
    description: v.optional(v.string()),
    active: v.boolean(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  // One row per purchase/submission. Lifecycle: submitted (payment
  // pending) -> paid -> scheduled (auto window) -> expired (computed by
  // endsAt) | rejected | cancelled. Owner approval gates activation.
  // ---------------- SaaS commercial subscriptions (section 24) ----------------

  // Plans are platform-level (not org-scoped): the operator defines
  // what is sold. kind separates individual-lawyer seats from firms.
  saasPlans: defineTable({
    code: v.string(),
    name: v.string(),
    kind: v.union(v.literal("individual"), v.literal("firm")),
    priceMinor: v.number(),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    seatLimit: v.optional(v.number()),
    storageLimitMb: v.optional(v.number()),
    features: v.optional(v.array(v.string())),
    trialDays: v.optional(v.number()),
    active: v.boolean(),
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_code", ["code"]),

  // One row per organization. Payment runs through the same verified
  // Razorpay webhook path as client invoices (kind: "saas"), but the
  // money never touches invoices/payments — subscriptions keeps its
  // own invoice rows so lawyer client billing stays separate.
  subscriptions: defineTable({
    orgId: v.id("organizations"),
    planId: v.id("saasPlans"),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("grace"),
      v.literal("read_only"),
      v.literal("cancelled"),
      v.literal("closed"),
    ),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    seatLimit: v.optional(v.number()),
    storageLimitMb: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),
    currentPeriodEnd: v.number(),
    cancelAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    // Read-only window after grace ends; export stays possible here.
    graceUntil: v.optional(v.number()),
    // Payment link (idempotent per attempt) + provider ids.
    paymentLinkId: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    paymentLinkIdConsumed: v.optional(v.boolean()),
    providerPaymentId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    lastInvoiceNumber: v.optional(v.string()),
    history: v.optional(
      v.array(
        v.object({
          at: v.number(),
          text: v.string(),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_link", ["paymentLinkId"]),

  // Platform-level subscription invoices (never org-scoped, never in
  // the lawyers' client-invoice numbering space).
  subscriptionInvoices: defineTable({
    number: v.string(),
    subscriptionId: v.id("subscriptions"),
    orgId: v.id("organizations"),
    orgName: v.string(),
    planCode: v.string(),
    planName: v.string(),
    interval: v.union(v.literal("monthly"), v.literal("yearly")),
    amountMinor: v.number(),
    status: v.union(
      v.literal("due"),
      v.literal("paid"),
      v.literal("void"),
    ),
    periodStart: v.number(),
    periodEnd: v.number(),
    dueOn: v.string(),
    providerPaymentId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_subscription", ["subscriptionId"])
    .index("by_number", ["number"]),

  // Verified SaaS payment events — separate idempotency ledger from
  // the client-invoice paymentEvents table.
  saasPaymentEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    payload: v.optional(v.string()),
    note: v.optional(v.string()),
    handledAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_event", ["eventId"]),

  // Time-limited one-time export tokens (closure/portability).
  saasExports: defineTable({
    orgId: v.id("organizations"),
    tokenHash: v.string(),
    createdBy: v.id("users"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Audited platform-owner administrative actions (staff/owner
  // management, plan changes, exceptional access). One row per action.
  platformAdminAudit: defineTable({
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_time", ["createdAt"]),

  promotions: defineTable({
    orgId: v.id("organizations"),
    packageId: v.id("promotionPackages"),
    submittedByUserId: v.id("users"),
    // Snapshot at submission time.
    profileId: v.optional(v.id("publicProfiles")),
    advocateName: v.string(),
    message: v.optional(v.string()),
    targetUrl: v.optional(v.string()),
    // Owner decision.
    approvalStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    approvedById: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    // Payment.
    amountMinor: v.number(),
    paymentStatus: v.union(
      v.literal("unpaid"),
      v.literal("paid"),
      v.literal("refunded"),
    ),
    paymentLinkId: v.optional(v.string()),
    paymentLinkUrl: v.optional(v.string()),
    providerPaymentId: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    // Run window (set when both approved AND paid).
    startsAt: v.optional(v.number()),
    endsAt: v.optional(v.number()),
    // Metrics (basic counters, incremented on the public path).
    impressions: v.optional(v.number()),
    clicks: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_submitted_by", ["submittedByUserId"]),

  // ---------------- Firm knowledge (section 25) ----------------
  // Precedents, research notes and saved authorities. Nothing is ever
  // published automatically from a matter: every entry is authored
  // deliberately, and reuse requires an explicit copy action by someone
  // who can already see both the entry and the target matter.
  knowledgeEntries: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("precedent"),
      v.literal("template"),
      v.literal("research_note"),
      v.literal("authority"),
    ),
    title: v.string(),
    authorId: v.id("users"),
    categoryId: v.optional(v.id("knowledgeCategories")),
    tags: v.optional(v.array(v.string())),
    state: v.union(v.literal("draft"), v.literal("approved"), v.literal("retired")),
    // Who approved the current version (approved entries only).
    approvedById: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    approvedVersion: v.optional(v.number()),
    // Restrict approval-time visibility beyond org members when set.
    restrictedRoles: v.optional(v.array(v.string())),
    currentVersion: v.number(),
    reuseCount: v.optional(v.number()),
    lastReusedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_state", ["orgId", "state"]),

  knowledgeCategories: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // Immutable version rows — edits always create a new version and the
  // entry returns to draft; an old approval never covers new text.
  knowledgeVersions: defineTable({
    entryId: v.id("knowledgeEntries"),
    version: v.number(),
    body: v.string(),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    changeNote: v.optional(v.string()),
    authorId: v.id("users"),
    createdAt: v.number(),
  }).index("by_entry", ["entryId"]),

  // ---------------- Court information (section 25) ----------------
  // Cause lists and court updates are manually imported/entered and are
  // always labelled as such — never presented as live synchronized data.
  causeListEntries: defineTable({
    orgId: v.id("organizations"),
    listDate: v.string(), // YYYY-MM-DD, organisation-local
    court: v.string(),
    itemNumber: v.optional(v.string()),
    caseTitle: v.string(),
    caseNumber: v.optional(v.string()),
    matterId: v.optional(v.id("matters")),
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
    checkedAt: v.number(),
    checkedById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org_date", ["orgId", "listDate"])
    .index("by_matter", ["matterId"]),

  // ---------------- Outcome proposal workflow (Feature 2) ----------------
  // One row per proposed follow-up action from a recorded hearing
  // outcome. Nothing is applied automatically: each row is approved,
  // edited or rejected by an authorized lawyer. Rejected rows are kept
  // for audit; keys are deterministic per hearing so a retry cannot
  // double-generate.
  outcomeProposals: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    hearingId: v.id("hearings"),
    key: v.string(),
    kind: v.union(
      v.literal("chronology"),
      v.literal("task"),
      v.literal("deadline"),
      v.literal("client_update"),
      v.literal("next_hearing"),
      v.literal("hearing_pack"),
    ),
    title: v.string(),
    payload: v.any(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    // Deadline provenance: the source sentence and calculation rule
    // are stored with the proposal and echoed onto the deadline row.
    deadlineSource: v.optional(v.string()),
    deadlineRule: v.optional(v.string()),
    proposedById: v.id("users"),
    createdAt: v.number(),
    // Decision trail (approved OR rejected — both are kept).
    decidedAt: v.optional(v.number()),
    decidedById: v.optional(v.id("users")),
    decisionNote: v.optional(v.string()),
    // The record created on approval (audit link).
    resultId: v.optional(v.string()),
    // Edited before approval: the materialized payload differs.
    editedPayload: v.optional(v.any()),
  })
    .index("by_matter", ["matterId"])
    .index("by_hearing", ["hearingId"])
    .index("by_key", ["key"])
    .index("by_org_status", ["orgId", "status"]),

  courtUpdates: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(
      v.literal("circular"),
      v.literal("notification"),
      v.literal("roster"),
      v.literal("holiday"),
      v.literal("other"),
    ),
    title: v.string(),
    detail: v.optional(v.string()),
    court: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()), // YYYY-MM-DD
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
    checkedAt: v.number(),
    checkedById: v.id("users"),
    matterId: v.optional(v.id("matters")),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // ---------------- AI & OCR (section 26) ----------------
  // One row per explicitly authorized document selection for AI use.
  // Text is extracted client-side from ordinary PDFs/text (with page
  // numbers kept); scanned pages can be OCRed via a vision model.
  aiSources: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    documentId: v.optional(v.id("matterDocuments")),
    name: v.string(),
    // Our Client / Opposing Party / Court / Evidence — drives the
    // evidence map and the provider prompt framing.
    role: v.union(
      v.literal("our_client"),
      v.literal("opposing_party"),
      v.literal("court"),
      v.literal("evidence"),
      v.literal("other"),
    ),
    // Version-aware context: the document version this text came from.
    documentUpdatedAt: v.optional(v.number()),
    text: v.string(),
    charCount: v.number(),
    pageCount: v.optional(v.number()),
    extraction: v.union(
      v.literal("text_layer"),
      v.literal("ocr"),
      v.literal("manual"),
    ),
    // One row per extracted page with its real page number — powers
    // "page 12" source references in AI outputs.
    pages: v.optional(
      v.array(
        v.object({
          page: v.number(),
          text: v.string(),
        }),
      ),
    ),
    addedById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"]),

  // Saved AI requests: kind, inputs, status, result, cost, timing.
  aiJobs: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    kind: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("expired"),
      // Turn 9: facts that change applicability are missing (governing
      // date, jurisdiction confirmation, procedural stage) — the model
      // is NOT run; the question is preserved and the focused questions
      // are shown. Retry after supplying the facts.
      v.literal("blocked_clarification"),
    ),
    sourceIds: v.optional(v.array(v.id("aiSources"))),
    inputNote: v.optional(v.string()),
    result: v.optional(v.string()),
    structured: v.optional(v.any()),
    error: v.optional(v.string()),
    model: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    costMinor: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    // Used tokens for the monthly usage-cap meter.
    monthKey: v.optional(v.string()), // YYYY-MM (IST)
    // For voice jobs: the preserved recording + transcript.
    transcript: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    // For email jobs (email_summary / email_reply): the filed email the
    // job works from, with its full text snapshot so the runner never
    // reads a message the caller could not see at request time.
    emailMessageId: v.optional(v.id("messages")),
    emailBody: v.optional(v.string()),
    // For morning briefings: the access-checked digest of yesterday's
    // filed inbound emails, built at request time over the IST day.
    emailDigest: v.optional(v.string()),
    // Legal research (26.6): the exact source-version snapshot the answer
    // was grounded in. Save/reopen therefore preserves source-version
    // references even when newer versions are ingested later (historical
    // reproducibility — the reopened answer shows WHICH text it used).
    legalSourceVersions: v.optional(
      v.array(
        v.object({ stableKey: v.string(), version: v.number() }),
      ),
    ),
    // Focused clarification questions recorded at request time when
    // missing facts affect applicability (no governing date recorded,
    // jurisdiction unconfirmed). The user question is NEVER lost.
    clarifications: v.optional(v.array(v.string())),
    requestedById: v.id("users"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_matter", ["matterId"])
    .index("by_org_month", ["orgId", "monthKey"])
    .index("by_status", ["status"])
    .index("by_user", ["requestedById"]),

  // Idempotent runner claims: one row per attempt key, so a retried
  // scheduler or two racing schedulers can never run the model twice
  // for one job (duplicate prevention).
  aiJobClaims: defineTable({
    occurrenceKey: v.string(),
    jobId: v.id("aiJobs"),
    claimedAt: v.number(),
  }).index("by_occurrence", ["occurrenceKey"]),

  // ---------------- Data import (section 28) ----------------
  dataImports: defineTable({
    orgId: v.id("organizations"),
    batchId: v.string(),
    entity: v.union(
      v.literal("clients"),
      v.literal("matters"),
      v.literal("hearings"),
      v.literal("chronology"),
      v.literal("document_metadata"),
    ),
    status: v.union(
      v.literal("staged"),
      v.literal("committed"),
      v.literal("discarded"),
    ),
    fileName: v.string(),
    totalRows: v.number(),
    validRows: v.number(),
    errorCount: v.number(),
    errors: v.array(v.object({ row: v.number(), message: v.string() })),
    duplicateStrategy: v.union(v.literal("skip"), v.literal("create")),
    duplicateCount: v.optional(v.number()),
    createdCount: v.optional(v.number()),
    updatedCount: v.optional(v.number()),
    rows: v.array(v.any()),
    committedById: v.optional(v.id("users")),
    committedAt: v.optional(v.number()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_batch", ["batchId"]),

  // Backups & restore tests (section 28). Convex performs platform-level
  // backups of the database and object storage; what a chamber controls
  // here is (a) its own full archive export and (b) an honest register of
  // restore tests executed in a non-production environment.
  backupRecords: defineTable({
    orgId: v.id("organizations"),
    kind: v.union(v.literal("archive_export"), v.literal("restore_test")),
    label: v.string(),
    counts: v.optional(
      v.object({
        clients: v.number(),
        matters: v.number(),
        hearings: v.number(),
        orders: v.number(),
        tasks: v.number(),
        invoices: v.number(),
        documents: v.number(),
        events: v.number(),
      }),
    ),
    environment: v.optional(v.string()),
    procedureNote: v.optional(v.string()),
    result: v.optional(
      v.union(v.literal("passed"), v.literal("failed"), v.literal("partial")),
    ),
    retentionNote: v.optional(v.string()),
    performedById: v.id("users"),
    performedAt: v.number(),
    // archive_export rows: the stored archive blob (restore drills read
    // this directly instead of parsing the label).
    storageId: v.optional(v.id("_storage")),
  }).index("by_org", ["orgId"]),

  // =====================================================================
  // ADVANCED MATTER INTELLIGENCE & AI LEGAL ASSOCIATE (section 27)
  // =====================================================================

  // Lawyer-curated facts of a matter. Every fact carries an explicit
  // epistemic status; the AI may PROPOSE facts but only a lawyer moves
  // anything into "confirmed". Corrections are versioned, never
  // destructive.
  matterFacts: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    // Stable within the matter so versions/corrections can reference
    // the same fact across rows.
    factKey: v.string(),
    statement: v.string(),
    // "allegation" = claimed by a party, unverified.
    // "extracted" = AI-proposed from a source, awaiting review.
    // "disputed" = contradicted by another source/fact.
    // "confirmed" = lawyer-verified (and only these feed summaries and
    // draft pre-fill).
    status: v.union(
      v.literal("allegation"),
      v.literal("extracted"),
      v.literal("disputed"),
      v.literal("confirmed"),
      v.literal("rejected"),
    ),
    // The document + the versioned extracted-text row the fact came
    // from (source-linking; aiSources rows are per version/page).
    sourceDocumentId: v.optional(v.id("matterDocuments")),
    sourceAiSourceId: v.optional(v.id("aiSources")),
    // Precise pinpoint references (page/paragraph/page:para).
    sourceRefs: v.optional(
      v.array(
        v.object({
          page: v.optional(v.number()),
          paragraph: v.optional(v.number()),
          quote: v.optional(v.string()),
        }),
      ),
    ),
    // Corroboration/contradiction links between facts.
    contradictsFactId: v.optional(v.id("matterFacts")),
    supersededById: v.optional(v.id("matterFacts")),
    // Structured bits the extractor may propose (all optional).
    occurredOn: v.optional(v.string()), // YYYY-MM-DD
    partyName: v.optional(v.string()),
    amountMinor: v.optional(v.number()),
    // Governance.
    proposedBy: v.optional(v.string()), // "ai" | userId
    proposedById: v.optional(v.id("users")),
    confirmedById: v.optional(v.id("users")),
    confirmedAt: v.optional(v.number()),
    rejectedReason: v.optional(v.string()),
    correctionOfId: v.optional(v.id("matterFacts")), // version chain
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"])
    .index("by_fact_key", ["matterId", "factKey"]),

  // Version history for fact corrections (the chain, not just the tip).
  matterFactRevisions: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    factId: v.id("matterFacts"),
    priorStatus: v.string(),
    priorStatement: v.string(),
    newStatus: v.string(),
    newStatement: v.string(),
    changedById: v.id("users"),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_fact", ["factId"]),

  // Contradiction candidates detected between facts/documents.
  matterContradictions: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    factAId: v.id("matterFacts"),
    factBId: v.id("matterFacts"),
    // "open" → "resolved_favoring_a" | "resolved_favoring_b" | "not_a_contradiction"
    status: v.union(
      v.literal("open"),
      v.literal("resolved_favoring_a"),
      v.literal("resolved_favoring_b"),
      v.literal("not_a_contradiction"),
    ),
    explanation: v.optional(v.string()),
    resolvedById: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_matter_status", ["matterId", "status"]),

  // AI document analyses (facts/dates/parties/obligations/amounts/issues)
  // per document version; regenerate → new analysis row, old preserved.
  documentAnalyses: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    documentId: v.id("matterDocuments"),
    aiSourceId: v.optional(v.id("aiSources")),
    analysisVersion: v.number(),
    status: v.union(
      v.literal("proposed"),
      v.literal("reviewed"),
    ),
    proposedFacts: v.array(
      v.object({
        factKey: v.string(),
        statement: v.string(),
        status: v.literal("allegation"),
        page: v.optional(v.number()),
        paragraph: v.optional(v.number()),
        quote: v.optional(v.string()),
        occurredOn: v.optional(v.string()),
        partyName: v.optional(v.string()),
        amountMinor: v.optional(v.number()),
      }),
    ),
    dates: v.array(
      v.object({ date: v.string(), context: v.optional(v.string()) }),
    ),
    parties: v.array(v.string()),
    obligations: v.array(
      v.object({ text: v.string(), ref: v.optional(v.string()) }),
    ),
    amounts: v.array(
      v.object({ amountMinor: v.number(), context: v.optional(v.string()) }),
    ),
    issues: v.array(v.string()),
    duplicatesOfDocumentId: v.optional(v.id("matterDocuments")),
    missingInformation: v.array(v.string()),
    model: v.optional(v.string()),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_matter", ["matterId"]),

  // Versioned, citation-checked matter summaries.
  matterSummaries: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    summaryVersion: v.number(),
    body: v.string(),
    // Content hash of inputs — changes when sources change; a mismatch
    // marks older summaries stale (prior versions preserved).
    inputsHash: v.string(),
    stale: v.boolean(),
    // Per-citation backend checks (same machinery as the research
    // workspace: quote verification ≠ conclusion support — that call
    // stays with the lawyer).
    citationChecks: v.optional(
      v.array(
        v.object({
          stableKey: v.string(),
          anchorValid: v.boolean(),
          quoteVerified: v.boolean(),
          note: v.optional(v.string()),
        }),
      ),
    ),
    findings: v.array(
      v.object({
        kind: v.string(), // obligation|defined_term|inconsistency|missing_clause|compliance|question
        passage: v.string(),
        sourceKey: v.optional(v.string()),
        explanation: v.string(),
        missingFacts: v.optional(v.string()),
        suggestedStep: v.optional(v.string()),
      }),
    ),
    generatedBy: v.optional(v.string()), // model name or "deterministic"
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"]),

  // Governed template library (target 300+; count reported honestly).
  draftTemplates: defineTable({
    orgId: v.id("organizations"),
    key: v.string(),
    title: v.string(),
    docType: v.string(), // legal_notice|petition|agreement|affidavit|...
    practiceArea: v.string(),
    jurisdiction: v.string(), // "in", "in-mh", "eu-…" — matter jurisdiction wins when set
    version: v.number(),
    reviewDueOn: v.optional(v.string()),
    authorSource: v.string(),
    usageRights: v.string(),
    approvalStatus: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("retired"),
    ),
    approvedById: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    requiredFields: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        kind: v.union(
          v.literal("text"),
          v.literal("date"),
          v.literal("amount"),
          v.literal("party"),
          v.literal("court"),
        ),
        required: v.boolean(),
        prefillFrom: v.optional(v.string()), // approved-fact/matter field key
      }),
    ),
    optionalClauses: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        body: v.string(),
        isDefault: v.boolean(),
      }),
    ),
    bodyTemplate: v.string(),
    instructions: v.string(),
    limitations: v.string(),
    createdById: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "approvalStatus"]),

  // A lawyer's use of a template on a matter (rendered draft snapshot).
  templateUses: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    templateId: v.id("draftTemplates"),
    templateVersion: v.number(),
    // Filled values, provenance-tagged (approved fact vs user-typed).
    values: v.array(
      v.object({
        key: v.string(),
        value: v.string(),
        source: v.union(
          v.literal("approved_fact"),
          v.literal("matter_field"),
          v.literal("user"),
          v.literal("missing"),
        ),
      }),
    ),
    renderedBody: v.string(),
    missingPlaceholders: v.array(v.string()),
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_template", ["templateId"]),

  // AI-suggested tasks awaiting lawyer approval (never auto-created).
  taskSuggestions: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    title: v.string(),
    rationale: v.string(),
    // Source of the suggestion (order id, document, approved fact...).
    sourceKind: v.union(
      v.literal("order"),
      v.literal("document"),
      v.literal("approved_fact"),
      v.literal("hearing"),
    ),
    sourceId: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    proposedDueOn: v.optional(v.string()), // calculated proposal only
    dueBasis: v.optional(v.string()), // e.g. "order date + 30 days"
    // proposed → approved (task created) | dismissed
    status: v.union(v.literal("proposed"), v.literal("approved"), v.literal("dismissed")),
    approvedById: v.optional(v.id("users")),
    dismissedReason: v.optional(v.string()),
    createdTaskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  })
    .index("by_matter_status", ["matterId", "status"]),
  // ---------------- GitHub integration ----------------
  // One row per organization. The token lives ONLY in the server-side
  // environment (Keys tab → GITHUB_TOKEN); the browser never sees it.
  // A repo is linked only when the caller can actually read it with the
  // configured token — no unverified claims.
  githubConnections: defineTable({
    orgId: v.id("organizations"),
    repo: v.string(), // "owner/name"
    owner: v.string(),
    name: v.string(),
    defaultBranch: v.string(),
    connectedById: v.id("users"),
    connectedAt: v.number(),
    lastVerifiedAt: v.number(),
    lastError: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_repo", ["orgId", "repo"]),

  // Audit entries for GitHub actions, kept separate from the matter audit
  // log (which requires a matterId). Connecting a repo still leaves a
  // reviewable trail.
  githubAudit: defineTable({
    orgId: v.id("organizations"),
    actorId: v.id("users"),
    actorName: v.string(),
    action: v.string(), // connect, disconnect, list_branches, push_chronology
    repo: v.optional(v.string()),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // ---------------- Offline court mode (section 27) ----------------
  // One row per prepared offline bundle (per user + device). The row
  // records WHAT was downloaded, when it was last verified against the
  // server, and any note updates queued while offline. Revocation is
  // recorded here but honestly takes effect only on the next sync —
  // a disconnected device keeps its copy until it reconnects and the
  // user removes it.
  offlineBundles: defineTable({
    orgId: v.id("organizations"),
    matterId: v.id("matters"),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceLabel: v.string(),
    // Limited selection — never the whole firm database.
    selection: v.object({
      hearingId: v.optional(v.id("hearings")),
      sectionIds: v.array(v.string()),
      includeNotes: v.boolean(),
      documentIds: v.array(v.id("matterDocuments")),
    }),
    // Hash of the exact payload served at prepare/sync time. The device
    // reports its fingerprint on reconnect; a mismatch means the server
    // copy moved on while the device was offline (conflict detection).
    fingerprint: v.string(),
    preparedAt: v.number(),
    syncedAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedById: v.optional(v.id("users")),
    removedAt: v.optional(v.number()),
    // Permitted note updates typed on the device while offline. Status
    // "conflict" means the matter changed since the device last synced
    // and a human must choose to apply the note after review.
    queuedNotes: v.optional(
      v.array(
        v.object({
          id: v.string(),
          body: v.string(),
          queuedAt: v.number(),
          baseSyncedAt: v.number(),
          status: v.union(
            v.literal("pending"),
            v.literal("applied"),
            v.literal("conflict"),
          ),
          conflictReason: v.optional(v.string()),
        }),
      ),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_matter", ["matterId"])
    .index("by_org", ["orgId"]),
});
