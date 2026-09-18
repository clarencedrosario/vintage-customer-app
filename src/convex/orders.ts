import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";
import { BOOKING_STATUSES, ORDER_STATUSES } from "./schema";

const MAX_NOTES = 2000;

/** Resolve the signed-in user inside an action (no db access available). */
import type { GenericActionCtx } from "convex/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
async function actionUser(ctx: Pick<GenericActionCtx<any>, "auth" | "runQuery">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You must be signed in.");
  const user = await ctx.runQuery(api.users.currentUser);
  if (!user) throw new Error("You must be signed in.");
  return user;
}

// ---------------- Orders ----------------

/**
 * Create an order. For "card" orders, a Stripe Checkout session is created
 * when STRIPE_SECRET_KEY is configured; otherwise the client is told to
 * request an invoice instead. For "invoice" orders, the firm follows up
 * with a payable invoice — no Stripe key required.
 */
export const createOrder = action({
  args: {
    serviceId: v.id("services"),
    kind: v.union(v.literal("card"), v.literal("invoice")),
    companyName: v.string(),
    billingEmail: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ orderId: string; checkoutUrl: string | null }> => {
    const user = await actionUser(ctx);

    const service = await ctx.runQuery(api.services.getById, {
      serviceId: args.serviceId,
    });
    if (!service) throw new Error("That service is no longer available.");

    if (args.kind === "card" && !process.env.STRIPE_SECRET_KEY) {
      throw new Error(
        "Card payments are not configured yet — please request an invoice instead.",
      );
    }

    if (args.notes && args.notes.length > MAX_NOTES) {
      throw new Error(`Notes must be at most ${MAX_NOTES} characters.`);
    }

    const orderId = await ctx.runMutation(api.orders.createPendingOrder, {
      serviceId: args.serviceId,
      amountCents: service.priceCents,
      kind: args.kind,
      companyName: args.companyName.trim() || undefined,
      billingEmail: args.billingEmail.trim() || user.email || undefined,
      notes: args.notes?.trim() || undefined,
    });

    if (args.kind === "invoice") {
      return { orderId, checkoutUrl: null };
    }

    // Card flow via Stripe Checkout.
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

    const origin =
      process.env.CLIENT_URL ??
      process.env.VITE_APP_URL ??
      "http://localhost:5173";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: service.priceCents,
            product_data: {
              name: `Advokate — ${service.name}`,
              description: service.summary,
            },
          },
        },
      ],
      customer_email: args.billingEmail.trim() || user.email || undefined,
      success_url: `${origin}/dashboard?order=${orderId}&status=success`,
      cancel_url: `${origin}/dashboard?order=${orderId}&status=cancelled`,
      metadata: { orderId },
    });

    await ctx.runMutation(api.orders.attachSession, {
      orderId,
      sessionId: session.id,
    });

    return { orderId, checkoutUrl: session.url ?? null };
  },
});

/** Clients: their own orders with the service joined, newest first. */
export const listWithService = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const orders = await ctx.db
      .query("orders")
      .withIndex("by_client", (q) => q.eq("clientUserId", user._id))
      .collect();

    const sorted = orders.sort((a, b) => b.createdAt - a.createdAt);
    return Promise.all(
      sorted.map(async (o) => ({
        ...o,
        service: await ctx.db.get(o.serviceId),
      })),
    );
  },
});

/** Clients: one of their own orders. */
export const getMineById = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const order = await ctx.db.get(args.orderId);
    if (!order || order.clientUserId !== user._id) return null;
    return order;
  },
});

/**
 * Verify a card order's payment status directly with Stripe. Called by the
 * dashboard after returning from Checkout.
 */
export const verifyOrder = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<string> => {
    await actionUser(ctx);

    const order = await ctx.runQuery(api.orders.getMineById, {
      orderId: args.orderId,
    });
    if (!order) throw new Error("Order not found.");

    if (order.status === "paid") return "paid";
    if (!order.stripeSessionId) return order.status;

    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("Card payments are not configured yet.");
    }
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    if (session.payment_status === "paid") {
      await ctx.runMutation(api.orders.markPaid, { orderId: args.orderId });
      return "paid";
    }
    return order.status;
  },
});

// ---------------- Bookings ----------------

/** Create a confirmed booking for a service at the requested time. */
export const createBooking = mutation({
  args: {
    serviceId: v.id("services"),
    startAt: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    if (args.startAt < Date.now()) {
      throw new Error("Please choose a time in the future.");
    }
    if (args.notes && args.notes.length > MAX_NOTES) {
      throw new Error(`Notes must be at most ${MAX_NOTES} characters.`);
    }

    return await ctx.db.insert("bookings", {
      serviceId: args.serviceId,
      clientUserId: user._id,
      startAt: args.startAt,
      notes: args.notes?.trim() || undefined,
      status: BOOKING_STATUSES.CONFIRMED,
      createdAt: Date.now(),
    });
  },
});

/** Clients: their own bookings with the service joined, soonest first. */
export const listMyBookings = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_client", (q) => q.eq("clientUserId", user._id))
      .collect();

    const sorted = bookings.sort((a, b) => a.startAt - b.startAt);
    return Promise.all(
      sorted.map(async (b) => ({
        ...b,
        service: await ctx.db.get(b.serviceId),
      })),
    );
  },
});

/** Cancel one of your own bookings. */
export const cancelBooking = mutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.clientUserId !== user._id) {
      throw new Error("Booking not found.");
    }
    await ctx.db.patch(args.bookingId, {
      status: BOOKING_STATUSES.CANCELLED,
    });
  },
});

// ---------------- Internal mutations invoked from actions ----------------

export const createPendingOrder = mutation({
  args: {
    serviceId: v.id("services"),
    amountCents: v.number(),
    kind: v.union(v.literal("card"), v.literal("invoice")),
    companyName: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    return await ctx.db.insert("orders", {
      serviceId: args.serviceId,
      clientUserId: user._id,
      amountCents: args.amountCents,
      status:
        args.kind === "invoice"
          ? ORDER_STATUSES.INVOICED
          : ORDER_STATUSES.PENDING,
      kind: args.kind,
      companyName: args.companyName,
      billingEmail: args.billingEmail,
      notes: args.notes,
      createdAt: Date.now(),
    });
  },
});

export const attachSession = mutation({
  args: { orderId: v.id("orders"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const order = await ctx.db.get(args.orderId);
    if (!order || order.clientUserId !== user._id) {
      throw new Error("Order not found.");
    }
    await ctx.db.patch(args.orderId, {
      stripeSessionId: args.sessionId,
    });
  },
});

export const markPaid = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("You must be signed in.");

    const order = await ctx.db.get(args.orderId);
    if (!order || order.clientUserId !== user._id) {
      throw new Error("Order not found.");
    }
    await ctx.db.patch(args.orderId, { status: ORDER_STATUSES.PAID });
  },
});
