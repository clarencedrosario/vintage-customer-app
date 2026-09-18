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

// Statuses a client matter moves through at the firm.
export const MATTER_STATUSES = {
  RECEIVED: "received",
  UNDER_REVIEW: "under_review",
  ENGAGED: "engaged",
  CLOSED: "closed",
} as const;

export const matterStatusValidator = v.union(
  v.literal(MATTER_STATUSES.RECEIVED),
  v.literal(MATTER_STATUSES.UNDER_REVIEW),
  v.literal(MATTER_STATUSES.ENGAGED),
  v.literal(MATTER_STATUSES.CLOSED),
);
export type MatterStatus = Infer<typeof matterStatusValidator>;

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
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // A legal matter: a client's inquiry that the firm tracks from intake to close.
    matters: defineTable({
      title: v.string(),
      practiceArea: v.string(),
      description: v.string(),
      status: matterStatusValidator,
      clientUserId: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_client", ["clientUserId"])
      .index("by_status", ["status"]),

    // Firm↔client correspondence attached to a matter.
    matterMessages: defineTable({
      matterId: v.id("matters"),
      authorUserId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),

    // Append-only status/audit trail for a matter ("the docket").
    matterEvents: defineTable({
      matterId: v.id("matters"),
      kind: v.string(), // e.g. "created", "status", "message", "closed"
      detail: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
