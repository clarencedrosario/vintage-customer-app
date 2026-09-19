import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// ---------------------------------------------------------------------
// ADVOKATE.IN roles. Four portal experiences; the working roles inside a
// firm are the nine legal-industry roles. Legacy values are mapped.
// ---------------------------------------------------------------------
export const ROLES = {
  FIRM_OWNER: "firm_owner",
  LAWYER: "lawyer",
  STAFF: "staff",
  CLIENT: "client",
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.FIRM_OWNER),
  v.literal(ROLES.LAWYER),
  v.literal(ROLES.STAFF),
  v.literal(ROLES.CLIENT),
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

/** Working roles inside an organization, in seniority order. */
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
export const orgRoleValidator = v.union(...ORG_ROLES.map((r) => v.literal(r)));
export type OrgRole = Infer<typeof orgRoleValidator>;

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

export const MEMBERSHIP_STATUSES = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  INVITED: "invited",
} as const;
export const membershipStatusValidator = v.union(
  v.literal(MEMBERSHIP_STATUSES.ACTIVE),
  v.literal(MEMBERSHIP_STATUSES.SUSPENDED),
  v.literal(MEMBERSHIP_STATUSES.INVITED),
);
export type MembershipStatus = Infer<typeof membershipStatusValidator>;

/** Legacy single-role → portal mapping (used for portal gating). */
export function portalForRole(
  role: string | undefined,
): "firm" | "lawyer" | "staff" | "client" | null {
  switch (role) {
    case ROLES.FIRM_OWNER:
    case ROLES.ADMIN:
      return "firm";
    case ROLES.LAWYER:
    case ROLES.USER:
      return "lawyer";
    case ROLES.STAFF:
    case ROLES.MEMBER:
      return "staff";
    case ROLES.CLIENT:
      return "client";
    default:
      return null;
  }
}

/** Org roles that may open the chamber console (never support staff). */
export const CONSOLE_ORG_ROLES: readonly OrgRole[] = ORG_ROLES.filter(
  (r) => r !== "support_staff",
);

// Matter lifecycle at a chamber.
export const MATTER_STATUSES = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  ON_HOLD: "on_hold",
  CLOSED: "closed",
} as const;

export const matterStatusValidator = v.union(
  v.literal(MATTER_STATUSES.OPEN),
  v.literal(MATTER_STATUSES.IN_PROGRESS),
  v.literal(MATTER_STATUSES.ON_HOLD),
  v.literal(MATTER_STATUSES.CLOSED),
);
export type MatterStatus = Infer<typeof matterStatusValidator>;

// Task states on a matter.
export const TASK_STATUSES = {
  PENDING: "pending",
  DONE: "done",
} as const;

export const taskStatusValidator = v.union(
  v.literal(TASK_STATUSES.PENDING),
  v.literal(TASK_STATUSES.DONE),
);
export type TaskStatus = Infer<typeof taskStatusValidator>;

// Invoice lifecycle.
export const INVOICE_STATUSES = {
  DRAFT: "draft",
  SENT: "sent",
  PARTIALLY_PAID: "partially_paid",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;

export const invoiceStatusValidator = v.union(
  v.literal(INVOICE_STATUSES.DRAFT),
  v.literal(INVOICE_STATUSES.SENT),
  v.literal(INVOICE_STATUSES.PARTIALLY_PAID),
  v.literal(INVOICE_STATUSES.PAID),
  v.literal(INVOICE_STATUSES.CANCELLED),
);
export type InvoiceStatus = Infer<typeof invoiceStatusValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),

      role: v.optional(roleValidator), // legacy portal role
      activeOrgId: v.optional(v.id("organizations")), // active membership
      designation: v.optional(v.string()),
      barCouncilId: v.optional(v.string()),
      phone: v.optional(v.string()),
    }).index("email", ["email"]),

    // ---------------------------------------------------------------
    // Organizations — independent chambers & multi-lawyer firms.
    // ---------------------------------------------------------------
    organizations: defineTable({
      name: v.string(),
      slug: v.string(), // unique short key
      kind: v.union(v.literal("chamber"), v.literal("firm")),
      logoStorageId: v.optional(v.id("_storage")),
      // Billing identity & address
      addressLine1: v.optional(v.string()),
      addressLine2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      pincode: v.optional(v.string()),
      gstin: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      website: v.optional(v.string()),
      // Conventions
      currency: v.string(),
      timezone: v.string(),
      financialYearStart: v.string(),
      taxLabel: v.string(),
      taxPercent: v.number(),
      invoicePrefix: v.string(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_slug", ["slug"]),

    // Membership: a user belongs to many organizations, one role each.
    memberships: defineTable({
      orgId: v.id("organizations"),
      userId: v.id("users"),
      orgRole: orgRoleValidator,
      status: membershipStatusValidator, // active / suspended / invited
      invitedBy: v.optional(v.id("users")),
      invitedEmail: v.optional(v.string()), // for pending invitations
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_user", ["userId"])
      .index("by_org_user", ["orgId", "userId"])
      .index("by_invited_email", ["invitedEmail"]),

    // Editable per-org permission overrides. Absent keys fall back to
    // the documented defaults in convex/access.ts.
    rolePermissions: defineTable({
      orgId: v.id("organizations"),
      orgRole: orgRoleValidator,
      permissions: v.array(v.string()), // capability keys granted
      updatedBy: v.id("users"),
      updatedAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_org_role", ["orgId", "orgRole"]),

    // Clients belong to an organization and may be bound to a portal user.
    clients: defineTable({
      orgId: v.id("organizations"),
      name: v.string(),
      kind: v.union(
        v.literal("individual"),
        v.literal("company"),
        v.literal("trust"),
        v.literal("government"),
      ),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      addressLine1: v.optional(v.string()),
      addressLine2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      pincode: v.optional(v.string()),
      gstin: v.optional(v.string()),
      notes: v.optional(v.string()),
      userId: v.optional(v.id("users")), // portal access grant
      // Account management
      responsibleLawyerId: v.optional(v.id("users")),
      archivedAt: v.optional(v.number()),
      archivedBy: v.optional(v.id("users")),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_user", ["userId"]),

    // Additional contacts on a client record (referred-by, accounts,
    // family members, authorised representatives, etc.).
    clientContacts: defineTable({
      orgId: v.id("organizations"),
      clientId: v.id("clients"),
      name: v.string(),
      relation: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      isPrimary: v.optional(v.boolean()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_client", ["clientId"])
      .index("by_org", ["orgId"]),

    // Conflict checks: possible matches surfaced for HUMAN review.
    // A cleared record is an editorial judgement recorded by a person;
    // the system never asserts that clearance is guaranteed.
    conflictChecks: defineTable({
      orgId: v.id("organizations"),
      clientId: v.optional(v.id("clients")), // set when run during create
      subject: v.string(), // the name searched
      matches: v.array(
        v.object({
          clientId: v.id("clients"),
          clientName: v.string(),
          evidence: v.array(v.string()),
        }),
      ),
      status: v.union(
        v.literal("open"),
        v.literal("reviewed"),
      ),
      reviewedBy: v.optional(v.id("users")),
      reviewedNote: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_org", ["orgId"]),

    // Matters belong to an organization; access is further restricted
    // to the responsible team (see access.ts matter-level rules).
    matters: defineTable({
      orgId: v.id("organizations"),
      title: v.string(),
      reference: v.string(),
      clientId: v.id("clients"),
      practiceArea: v.string(),
      court: v.optional(v.string()),
      opposingParty: v.optional(v.string()),
      status: matterStatusValidator,
      description: v.optional(v.string()),
      // Court record
      jurisdiction: v.optional(v.string()),
      caseNumber: v.optional(v.string()),
      bench: v.optional(v.string()),
      // People
      leadLawyerId: v.optional(v.id("users")),
      opposingCounsel: v.optional(v.string()),
      // Matter-level access: null = all firm roles; otherwise only these
      // users (plus owner/partner/administrator) may open the file.
      teamIds: v.optional(v.array(v.id("users"))),
      // Priority: normal / high / urgent. Key dates (filling, limitation,
      // next appearance) as a small typed list.
      priority: v.optional(
        v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
      ),
      keyDates: v.optional(
        v.array(
          v.object({
            label: v.string(),
            date: v.string(), // YYYY-MM-DD
          }),
        ),
      ),
      // Billing arrangement summary (e.g. "Fixed fee ₹50,000 per stage",
      // "Hourly ₹3,000/hr, monthly billing").
      billingArrangement: v.optional(v.string()),
      // When true, the connected client may upload documents from the
      // client portal (submission is per-matter opt-in).
      clientSubmission: v.optional(v.boolean()),
      // Soft archive.
      archivedAt: v.optional(v.number()),
      archivedBy: v.optional(v.id("users")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_org", ["orgId"])
      .index("by_client", ["clientId"])
      .index("by_status", ["status"])
      .index("by_reference", ["reference"])
      .index("by_lead", ["leadLawyerId"]),

    // Parties to a matter (petitioners, respondents, witnesses,
    // intervenors…). Opposing counsel lives on the matter; named
    // party rows make the Parties & team area editable.
    matterParties: defineTable({
      orgId: v.id("organizations"),
      matterId: v.id("matters"),
      name: v.string(),
      side: v.union(v.literal("ours"), v.literal("opposing"), v.literal("neutral")),
      role: v.optional(v.string()), // petitioner, respondent, witness…
      counsel: v.optional(v.string()), // their counsel on record
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Evidence & issues board: contested issues and the exhibits that
    // support or rebut them.
    matterIssues: defineTable({
      orgId: v.id("organizations"),
      matterId: v.id("matters"),
      title: v.string(),
      detail: v.optional(v.string()),
      status: v.union(
        v.literal("open"),
        v.literal("argued"),
        v.literal("resolved"),
      ),
      evidence: v.optional(
        v.array(
          v.object({
            label: v.string(),
            documentId: v.optional(v.id("matterDocuments")),
            supports: v.boolean(), // supports our case, or rebuts
          }),
        ),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Append-only audit log: who changed what, beyond matter events.
    auditLog: defineTable({
      orgId: v.id("organizations"),
      matterId: v.optional(v.id("matters")),
      actorId: v.id("users"),
      actorName: v.optional(v.string()),
      action: v.string(),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_org", ["orgId"]),

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
      ),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_at", ["at"]),

    orders: defineTable({
      matterId: v.id("matters"),
      title: v.string(),
      passedOn: v.number(),
      summary: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      // Review trail for the attention docket (unreviewed orders).
      reviewedAt: v.optional(v.number()),
      reviewedBy: v.optional(v.id("users")),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    tasks: defineTable({
      matterId: v.id("matters"),
      title: v.string(),
      dueAt: v.optional(v.number()),
      status: taskStatusValidator,
      assigneeId: v.optional(v.id("users")),
      // Progress notes posted by support staff from the staff portal.
      staffUpdates: v.optional(
        v.array(v.object({ body: v.string(), at: v.number() })),
      ),
      // Completion evidence: filing receipts, delivery proofs, etc.
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
      .index("by_matter", ["matterId"])
      .index("by_status", ["status"])
      .index("by_due", ["dueAt"])
      .index("by_assignee", ["assigneeId"]),

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
      status: invoiceStatusValidator,
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
      .index("by_client", ["clientId"])
      .index("by_status", ["status"]),

    payments: defineTable({
      invoiceId: v.id("invoices"),
      amount: v.number(),
      mode: v.union(
        v.literal("upi"),
        v.literal("neft"),
        v.literal("cash"),
        v.literal("cheque"),
        v.literal("other"),
      ),
      reference: v.optional(v.string()),
      receivedOn: v.string(),
      createdAt: v.number(),
    }).index("by_invoice", ["invoiceId"]),

    matterNotes: defineTable({
      matterId: v.id("matters"),
      authorId: v.id("users"),
      body: v.string(),
      // True when written by the client from the client portal (secure
      // messages); false/absent = internal chamber note.
      fromClient: v.optional(v.boolean()),
      // True on chamber replies addressed to the client — those, and only
      // those, are visible in the client message thread.
      toClient: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    matterEvents: defineTable({
      matterId: v.id("matters"),
      kind: v.string(),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Document-level access: `internal` files are never exposed to the
    // client portal; `shared_with_client` files are.
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
      // Client portal submissions land here (uploader is the client user).
      submittedByClient: v.optional(v.boolean()),
      // Checklist: clients are asked to supply this document.
      requestedFromClient: v.optional(v.boolean()),
      requestedNote: v.optional(v.string()),
      // Which client users have acknowledged this shared document.
      seenByClient: v.optional(v.array(v.id("users"))),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // ---------------------------------------------------------------
    // Invitations (staff into organizations; clients to the portal).
    // Raw tokens never touch the database — only salted SHA-256 hashes.
    // ---------------------------------------------------------------
    invitations: defineTable({
      orgId: v.optional(v.id("organizations")),
      email: v.string(),
      kind: v.union(v.literal("staff"), v.literal("client")),
      clientId: v.optional(v.id("clients")),
      orgRole: v.optional(orgRoleValidator),
      salt: v.string(),
      tokenHash: v.string(),
      invitedBy: v.id("users"),
      expiresAt: v.number(),
      usedAt: v.optional(v.number()),
      revokedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_email", ["email"]),

    // Two-factor enrollment (TOTP).
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
      .index("by_session", ["sessionId"])
      .index("by_user", ["userId"]),

    // ---------------------------------------------------------------
    // Attention docket: per-user dismissals and snoozes. Items reappear
    // when their data changes; critical deadlines cannot be dismissed.
    // ---------------------------------------------------------------
    attentionStates: defineTable({
      userId: v.id("users"),
      orgId: v.id("organizations"),
      itemId: v.string(), // e.g. "hearing:<id>", "deadline:<taskId>"
      dismissedAt: v.optional(v.number()),
      snoozedUntil: v.optional(v.number()),
      updatedAt: v.number(),
    })
      .index("by_user_org", ["userId", "orgId"])
      .index("by_user_item", ["userId", "itemId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
