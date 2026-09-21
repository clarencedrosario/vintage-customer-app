import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

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

export const TASK_STATUSES = ["pending", "in_progress", "done"] as const;

/** Firm-wide tasks are filing / service / delivery / collection errands. */
export const TASK_KINDS = [
  "general",
  "filing",
  "service",
  "delivery",
  "collection",
] as const;

export const TASK_PRIORITIES = ["normal", "high", "urgent"] as const;

/** Limitation and compliance deadline categories (legally significant). */
export const DEADLINE_CATEGORIES = [
  "limitation",
  "filing",
  "compliance",
  "court_order",
  "custom",
] as const;

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

  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    // Legacy console/portal role (memberships govern real permissions).
    role: v.optional(v.string()),
    // Organization the user is currently working in.
    activeOrgId: v.optional(v.id("organizations")),
    designation: v.optional(v.string()),
    phone: v.optional(v.string()),
    barCouncilId: v.optional(v.string()),
  }).index("email", ["email"]),

  // Convex Auth manages authSessions/authAccounts/authVerificationCodes
  // authRateLimits/authRefreshTokens via the authTables spread above.

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
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
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
      v.literal("trust"),
      v.literal("government"),
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
    matches: v.optional(v.array(v.any())),
    status: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedNote: v.optional(v.string()),
    matchCount: v.optional(v.number()),
    note: v.optional(v.string()),
    reviewerId: v.optional(v.id("users")),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  matters: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    reference: v.string(), // e.g. ADV/2026/0001
    title: v.string(),
    practiceArea: v.string(),
    description: v.optional(v.string()),
    status: matterStatusValidator,
    priority: v.optional(
      v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    ),
    court: v.optional(v.string()),
    jurisdiction: v.optional(v.string()),
    caseNumber: v.optional(v.string()),
    bench: v.optional(v.string()),
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
    evidence: v.optional(
      v.array(
        v.object({
          label: v.string(),
          documentId: v.optional(v.id("matterDocuments")),
          supports: v.boolean(),
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
    // Client portal submissions land here.
    submittedByClient: v.optional(v.boolean()),
    requestedFromClient: v.optional(v.boolean()),
    requestedNote: v.optional(v.string()),
    seenByClient: v.optional(v.array(v.id("users"))),
    createdAt: v.number(),
  }).index("by_matter", ["matterId"]),

  matterNotes: defineTable({
    matterId: v.id("matters"),
    authorId: v.optional(v.id("users")),
    body: v.string(),
    fromClient: v.optional(v.boolean()),
    toClient: v.optional(v.boolean()),
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
    createdAt: v.number(),
  })
    .index("by_matter", ["matterId"])
    .index("by_uninvoiced", ["matterId", "invoiceId"]),

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
    ),
    subtotal: v.number(),
    taxPercent: v.number(),
    taxAmount: v.number(),
    total: v.number(),
    amountPaid: v.number(),
    notes: v.optional(v.string()),
    issuedOn: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_matter", ["matterId"])
    .index("by_client", ["clientId"]),

  payments: defineTable({
    invoiceId: v.id("invoices"),
    amount: v.number(),
    mode: v.optional(
      v.union(
        v.literal("upi"),
        v.literal("neft"),
        v.literal("cash"),
        v.literal("cheque"),
        v.literal("other"),
      ),
    ),
    reference: v.optional(v.string()),
    receivedOn: v.string(),
    createdAt: v.number(),
  }).index("by_invoice", ["invoiceId"]),

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
});
