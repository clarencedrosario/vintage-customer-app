// =====================================================================
// FEATURE 5 — Deadline rules engine: table definitions.
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
