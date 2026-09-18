import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { getCurrentUser } from "./users";

// ---------------- Admin: users & company overview ----------------

/** All clients (non-anonymous users), for the admin client list. */
export const listClients = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin") return [];

    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => !u.isAnonymous)
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  },
});

// ---------------- Admin: bookings & orders ----------------

/** All bookings with client and service joined. */
export const listAllBookings = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin") return [];

    const bookings = await ctx.db.query("bookings").collect();
    const sorted = bookings.sort((a, b) => a.startAt - b.startAt);

    return Promise.all(
      sorted.map(async (b) => ({
        ...b,
        service: await ctx.db.get(b.serviceId),
        client: await ctx.db.get(b.clientUserId),
      })),
    );
  },
});

/** All orders with client and service joined. */
export const listAllOrders = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin") return [];

    const orders = await ctx.db.query("orders").collect();
    const sorted = orders.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      sorted.map(async (o) => ({
        ...o,
        service: await ctx.db.get(o.serviceId),
        client: await ctx.db.get(o.clientUserId),
      })),
    );
  },
});

/** Admin marks an order paid (e.g. invoice settled offline). */
export const markOrderPaid = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin")
      throw new Error("Administrator access required.");

    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");

    await ctx.db.patch(args.orderId, { status: "paid" });
  },
});

/** Admin updates a booking status (completed / cancelled / confirmed). */
export const updateBookingStatus = mutation({
  args: {
    bookingId: v.id("bookings"),
    status: v.union(
      v.literal("confirmed"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin")
      throw new Error("Administrator access required.");

    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found.");

    await ctx.db.patch(args.bookingId, { status: args.status });
  },
});

// ---------------- Admin: aggregate stats for the overview ----------------

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const admin = await getCurrentUser(ctx);
    if (!admin || admin.role !== "admin") return null;

    const [matters, orders, bookings, users] = await Promise.all([
      ctx.db.query("matters").collect(),
      ctx.db.query("orders").collect(),
      ctx.db.query("bookings").collect(),
      ctx.db.query("users").collect(),
    ]);

    const revenueCents = orders
      .filter((o) => o.status === "paid")
      .reduce((sum, o) => sum + o.amountCents, 0);

    return {
      clients: users.filter((u) => !u.isAnonymous).length,
      openMatters: matters.filter(
        (m) => m.status !== "closed",
      ).length,
      paidOrders: orders.filter((o) => o.status === "paid").length,
      invoiceOrders: orders.filter((o) => o.status === "invoiced").length,
      revenueCents,
      upcomingBookings: bookings.filter(
        (b) => b.status === "confirmed" && b.startAt > Date.now(),
      ).length,
    };
  },
});
