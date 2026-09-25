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
