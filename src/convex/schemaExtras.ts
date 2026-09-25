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
