import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

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

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      designation: v.optional(v.string()), // e.g. Senior Advocate, Associate
      barCouncilId: v.optional(v.string()),
      phone: v.optional(v.string()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ---------------------------------------------------------------
    // ADVOKATE.IN — The Digital Chamber
    // Organization → Team & Clients → Matters → everything else
    // ---------------------------------------------------------------

    // One row; singleton chamber profile + configurable settings.
    settings: defineTable({
      key: v.string(), // "chamber"
      chamberName: v.string(),
      addressLine1: v.string(),
      addressLine2: v.optional(v.string()),
      city: v.string(),
      state: v.string(),
      pincode: v.string(),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      website: v.optional(v.string()),
      gstin: v.optional(v.string()),
      currency: v.string(), // "INR"
      timezone: v.string(), // "Asia/Kolkata"
      financialYearStart: v.string(), // "04-01" (MM-DD)
      taxLabel: v.string(), // "GST"
      taxPercent: v.number(), // e.g. 18
      invoicePrefix: v.string(), // e.g. "ADV"
    }).index("by_key", ["key"]),

    // Clients of the chamber: individuals, companies, trusts, government.
    clients: defineTable({
      name: v.string(),
      kind: v.union(
        v.literal("individual"),
        v.literal("company"),
        v.literal("trust"),
        v.literal("government"),
      ),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      // Indian postal address
      addressLine1: v.optional(v.string()),
      addressLine2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      pincode: v.optional(v.string()),
      gstin: v.optional(v.string()),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_created_by", ["createdBy"]),

    // A matter: the central record everything else links to.
    matters: defineTable({
      title: v.string(),
      reference: v.string(), // chamber reference, e.g. ADV/2026/0007
      clientId: v.id("clients"),
      practiceArea: v.string(),
      court: v.optional(v.string()),
      opposingParty: v.optional(v.string()),
      status: matterStatusValidator,
      description: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_client", ["clientId"])
      .index("by_status", ["status"])
      .index("by_reference", ["reference"]),

    // Hearings on a matter.
    hearings: defineTable({
      matterId: v.id("matters"),
      title: v.string(),
      court: v.optional(v.string()),
      at: v.number(),
      appearance: v.optional(v.string()), // physical / virtual
      notes: v.optional(v.string()),
      status: v.union(v.literal("scheduled"), v.literal("held"), v.literal("adjourned")),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]).index("by_at", ["at"]),

    // Orders & judgments received on a matter.
    orders: defineTable({
      matterId: v.id("matters"),
      title: v.string(),
      passedOn: v.number(),
      summary: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Tasks & deadlines on a matter.
    tasks: defineTable({
      matterId: v.id("matters"),
      title: v.string(),
      dueAt: v.optional(v.number()),
      status: taskStatusValidator,
      assigneeId: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_status", ["status"])
      .index("by_due", ["dueAt"]),

    // Time entries (fees) on a matter.
    timeEntries: defineTable({
      matterId: v.id("matters"),
      userId: v.id("users"),
      description: v.string(),
      minutes: v.number(),
      ratePerHour: v.number(), // in paise? no — in INR units
      date: v.string(), // YYYY-MM-DD (financial-year bucketing)
      invoiceId: v.optional(v.id("invoices")),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_uninvoiced", ["matterId", "invoiceId"]),

    // Expenses (disbursements) on a matter.
    expenses: defineTable({
      matterId: v.id("matters"),
      description: v.string(),
      amount: v.number(),
      date: v.string(), // YYYY-MM-DD
      invoiceId: v.optional(v.id("invoices")),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_uninvoiced", ["matterId", "invoiceId"]),

    // Invoices raised by the chamber.
    invoices: defineTable({
      number: v.string(), // ADV/2026-27/0001
      matterId: v.id("matters"),
      clientId: v.id("clients"),
      status: invoiceStatusValidator,
      subtotal: v.number(),
      taxPercent: v.number(),
      taxAmount: v.number(),
      total: v.number(),
      amountPaid: v.number(),
      notes: v.optional(v.string()),
      issuedOn: v.string(), // YYYY-MM-DD
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_matter", ["matterId"])
      .index("by_client", ["clientId"])
      .index("by_status", ["status"]),

    // Payments received against invoices.
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
      receivedOn: v.string(), // YYYY-MM-DD
      createdAt: v.number(),
    }).index("by_invoice", ["invoiceId"]),

    // Notes on a matter.
    matterNotes: defineTable({
      matterId: v.id("matters"),
      authorId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Append-only docket (audit trail) for a matter.
    matterEvents: defineTable({
      matterId: v.id("matters"),
      kind: v.string(), // created / hearing / order / task / time / expense / invoice / payment / note / document / status
      detail: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Documents and communications on a matter.
    matterDocuments: defineTable({
      matterId: v.id("matters"),
      uploaderId: v.id("users"),
      name: v.string(),
      kind: v.union(v.literal("document"), v.literal("communication")),
      storageId: v.optional(v.id("_storage")),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
