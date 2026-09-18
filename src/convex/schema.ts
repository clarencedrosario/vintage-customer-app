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

// Statuses a client matter moves through.
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

// Booking lifecycle for consultations.
export const BOOKING_STATUSES = {
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export const bookingStatusValidator = v.union(
  v.literal(BOOKING_STATUSES.CONFIRMED),
  v.literal(BOOKING_STATUSES.COMPLETED),
  v.literal(BOOKING_STATUSES.CANCELLED),
);
export type BookingStatus = Infer<typeof bookingStatusValidator>;

// Payment lifecycle for orders.
export const ORDER_STATUSES = {
  PENDING: "pending",
  PAID: "paid",
  INVOICED: "invoiced",
  CANCELLED: "cancelled",
} as const;

export const orderStatusValidator = v.union(
  v.literal(ORDER_STATUSES.PENDING),
  v.literal(ORDER_STATUSES.PAID),
  v.literal(ORDER_STATUSES.INVOICED),
  v.literal(ORDER_STATUSES.CANCELLED),
);
export type OrderStatus = Infer<typeof orderStatusValidator>;

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
      companyName: v.optional(v.string()), // business the user represents
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ---------------- Advokate catalog & commerce ----------------

    // A bookable legal service offered to businesses.
    services: defineTable({
      name: v.string(),
      slug: v.string(),
      category: v.string(),
      summary: v.string(),
      description: v.string(),
      priceCents: v.number(),
      durationMinutes: v.number(),
      isActive: v.boolean(),
    })
      .index("by_slug", ["slug"])
      .index("by_category", ["category"]),

    // A scheduled consultation between a client and the firm.
    bookings: defineTable({
      serviceId: v.id("services"),
      clientUserId: v.id("users"),
      startAt: v.number(),
      notes: v.optional(v.string()),
      status: bookingStatusValidator,
      createdAt: v.number(),
    })
      .index("by_client", ["clientUserId"])
      .index("by_service", ["serviceId"])
      .index("by_start", ["startAt"]),

    // A purchase: either a card order (paid via Stripe) or a request for an invoice.
    orders: defineTable({
      serviceId: v.id("services"),
      clientUserId: v.id("users"),
      amountCents: v.number(),
      status: orderStatusValidator,
      kind: v.union(v.literal("card"), v.literal("invoice")),
      stripeSessionId: v.optional(v.string()),
      companyName: v.optional(v.string()),
      billingEmail: v.optional(v.string()),
      notes: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_client", ["clientUserId"])
      .index("by_session", ["stripeSessionId"])
      .index("by_status", ["status"]),

    // ---------------- Existing client-portal tables ----------------

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

    // Documents uploaded by clients to a matter.
    matterDocuments: defineTable({
      matterId: v.id("matters"),
      uploaderUserId: v.id("users"),
      name: v.string(),
      kind: v.union(v.literal("contract"), v.literal("correspondence")),
      storageId: v.optional(v.id("_storage")),
      createdAt: v.number(),
    }).index("by_matter", ["matterId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
