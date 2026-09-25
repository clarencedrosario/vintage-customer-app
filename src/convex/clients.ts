import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
} from "./access";
import type { Doc, Id } from "./_generated/dataModel";

/** Clients of the active org (view capability), newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    requireCapability(ac, "client.view_all");
    return await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

/** One client. */
export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) return null;
    if (!can(ac, "client.view_all")) return null;
    return client;
  },
});

/** Create a client (individual / company / partnership / LLP / trust / society / government / other). */
export const create = mutation({
  args: {
    name: v.string(),
    kind: v.union(
      v.literal("individual"),
      v.literal("company"),
      v.literal("partnership"),
      v.literal("llp"),
      v.literal("trust"),
      v.literal("society"),
      v.literal("government"),
      v.literal("other"),
    ),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    pan: v.optional(v.string()),
    cin: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.create");

    const name = args.name.trim();
    if (!name) throw new Error("Client name is required.");
    if (args.pincode && !/^\d{6}$/.test(args.pincode.trim())) {
      throw new Error("PIN code must be exactly 6 digits.");
    }
    if (
      args.gstin &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(
        args.gstin.trim().toUpperCase(),
      )
    ) {
      throw new Error("That GSTIN does not look valid.");
    }

    if (
      args.pan &&
      !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(args.pan.trim().toUpperCase())
    ) {
      throw new Error("That PAN does not look valid.");
    }
    if (
      args.cin &&
      !/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(
        args.cin.trim().toUpperCase(),
      )
    ) {
      throw new Error("That CIN does not look valid.");
    }

    return await ctx.db.insert("clients", {
      orgId: ac.org._id,
      ...args,
      name,
      gstin: args.gstin?.trim().toUpperCase() || undefined,
      pan: args.pan?.trim().toUpperCase() || undefined,
      cin: args.cin?.trim().toUpperCase() || undefined,
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
  },
});

/** Update a client. */
export const update = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("individual"),
        v.literal("company"),
        v.literal("partnership"),
        v.literal("llp"),
        v.literal("trust"),
        v.literal("society"),
        v.literal("government"),
        v.literal("other"),
      ),
    ),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    pincode: v.optional(v.string()),
    gstin: v.optional(v.string()),
    pan: v.optional(v.string()),
    cin: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }

    const { clientId, ...patch } = args;
    if (
      patch.pincode &&
      !/^\d{6}$/.test(patch.pincode.trim())
    ) {
      throw new Error("PIN code must be exactly 6 digits.");
    }
    await ctx.db.patch(clientId, patch);
  },
});

/** Open matters count per client, for list display. */
export const openMatterCounts = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return {};
    const matters = await ctx.db
      .query("matters")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const counts: Record<string, number> = {};
    for (const m of matters) {
      if (m.status !== "closed") {
        counts[m.clientId] = (counts[m.clientId] ?? 0) + 1;
      }
    }
    return counts;
  },
});

// ===============================================================
// Archive / restore
// ===============================================================

/** Archive a client (soft-hide; matters and history are preserved). */
export const archive = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    const openMatters = (
      await ctx.db
        .query("matters")
        .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
        .collect()
    ).filter((m) => m.status !== "closed");
    if (openMatters.length > 0) {
      throw new Error(
        `This client still has ${openMatters.length} open matter${openMatters.length === 1 ? "" : "s"}. Close them before archiving.`,
      );
    }
    await ctx.db.patch(args.clientId, {
      archivedAt: Date.now(),
      archivedBy: ac.user._id,
    });
  },
});

/** Restore an archived client. */
export const unarchive = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    await ctx.db.patch(args.clientId, {
      archivedAt: undefined,
      archivedBy: undefined,
    });
  },
});

/** Set the responsible lawyer (client.edit). */
export const setResponsibleLawyer = mutation({
  args: {
    clientId: v.id("clients"),
    lawyerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    await ctx.db.patch(args.clientId, {
      responsibleLawyerId: args.lawyerId,
    });
  },
});

// ===============================================================
// Additional contacts
// ===============================================================

export const listContacts = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) return [];
    if (!can(ac, "client.view_all")) return [];
    return ctx.db
      .query("clientContacts")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
  },
});

export const addContact = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    relation: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    const name = args.name.trim();
    if (!name) throw new Error("Contact name is required.");
    await ctx.db.insert("clientContacts", {
      orgId: ac.org._id,
      clientId: args.clientId,
      name,
      relation: args.relation?.trim() || undefined,
      email: args.email?.trim() || undefined,
      phone: args.phone?.trim() || undefined,
      isPrimary: args.isPrimary,
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
  },
});

export const removeContact = mutation({
  args: { contactId: v.id("clientContacts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.edit");
    const contact = await ctx.db.get(args.contactId);
    if (!contact || contact.orgId !== ac.org._id) {
      throw new Error("Contact not found in your organization.");
    }
    await ctx.db.delete(args.contactId);
  },
});

// ===============================================================
// Conflict checks — evidence for human review, never a clearance
// ===============================================================

/**
 * Search the org's clients for possible conflicts with a new name.
 * Returns possible matches with the evidence that produced them;
 * a human decides what, if anything, they mean.
 */
export const conflictCheck = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return { matches: [], scopedTo: null as string | null };

    const needle = args.name.trim().toLowerCase();
    if (needle.length < 3) return { matches: [], scopedTo: ac.org.name };
    const words = needle.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0) return { matches: [], scopedTo: ac.org.name };

    const [clients, matters] = await Promise.all([
      ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
      ctx.db
        .query("matters")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect(),
    ]);
    const mattersByClient = new Map<Id<"clients">, Doc<"matters">[]>();
    for (const m of matters) {
      const list = mattersByClient.get(m.clientId) ?? [];
      list.push(m);
      mattersByClient.set(m.clientId, list);
    }

    const matches: {
      clientId: Id<"clients">;
      clientName: string;
      evidence: string[];
    }[] = [];
    for (const c of clients) {
      const evidence: string[] = [];
      const opposing = (mattersByClient.get(c._id) ?? [])
        .map((m) => m.opposingParty?.toLowerCase() ?? "")
        .filter(Boolean);

      if (c.name.toLowerCase() === needle) {
        evidence.push("Exact name match");
      } else if (words.every((w) => c.name.toLowerCase().includes(w))) {
        evidence.push("All name words present");
      } else {
        const hitWords = words.filter((w) => c.name.toLowerCase().includes(w));
        if (hitWords.length > 0) {
          evidence.push(
            `Name shares: ${hitWords.map((w) => `“${w}”`).join(", ")}`,
          );
        }
      }
      if (c.email && needle.includes(c.email.toLowerCase())) {
        evidence.push("Email appears in the new name");
      }
      for (const opp of opposing) {
        if (opp.includes(needle) || words.some((w) => opp.includes(w))) {
          evidence.push(
            `Named as opposing party on ${mattersByClient.get(c._id)!.find((m) => (m.opposingParty?.toLowerCase() ?? "") === opp)!.reference}`,
          );
        }
      }
      if (evidence.length > 0) {
        matches.push({
          clientId: c._id,
          clientName: c.name,
          evidence,
        });
      }
    }
    return { matches: matches.slice(0, 10), scopedTo: ac.org.name };
  },
});

/** Record a conflict check as human-reviewed with a note. */
export const acknowledgeConflictCheck = mutation({
  args: {
    subject: v.string(),
    clientId: v.optional(v.id("clients")),
    matchCount: v.number(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.create");
    await ctx.db.insert("conflictChecks", {
      orgId: ac.org._id,
      clientId: args.clientId,
      subject: args.subject.trim(),
      matches: [],
      status: "reviewed",
      reviewedBy: ac.user._id,
      reviewedNote: `${args.note.trim()} (${args.matchCount} possible match${args.matchCount === 1 ? "" : "es"} considered)`,
      // Legacy desk entries are human-reviewed on record: they satisfy
      // the Feature-3 gate as cleared-by-review.
      reviewStatus: "cleared",
      classification: "no_conflict",
      classificationReason: "Reviewed on the legacy conflict desk.",
      decidedById: ac.user._id,
      decidedAt: Date.now(),
      createdBy: ac.user._id,
      createdAt: Date.now(),
    });
  },
});

/** Recent conflict-check register entries for the org. */
export const conflictRegister = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!can(ac, "matter.create")) return [];
    return ctx.db
      .query("conflictChecks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20));
  },
});

// ===============================================================
// Client 360
// ===============================================================

/**
 * Everything the Client 360 page renders, for one client of the active
 * org — gated by client.view_all and matter/document-level access.
 */
export const client360 = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    if (!can(ac, "client.view_all")) return null;

    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) return null;

    const matters = (
      await ctx.db
        .query("matters")
        .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
        .collect()
    ).filter((m) => canViewMatter(ac, m));
    const matterIds = matters.map((m) => m._id);

    const [contacts, documents, invoices, notes] = await Promise.all([
      ctx.db
        .query("clientContacts")
        .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
        .collect(),
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterDocuments")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) =>
        Promise.all(
          rows.flat().map(async (d) => ({
            ...d,
            matter: matters.find((m) => m._id === d.matterId) ?? null,
          })),
        ),
      ),
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("invoices")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) => rows.flat()),
      Promise.all(
        matterIds.map((id) =>
          ctx.db
            .query("matterNotes")
            .withIndex("by_matter", (q) => q.eq("matterId", id))
            .collect(),
        ),
      ).then((rows) =>
        Promise.all(
          rows.flat().map(async (n) => ({
            ...n,
            authorName: n.authorId
              ? (await ctx.db.get(n.authorId))?.name ?? "Member"
              : "Member",
          })),
        ),
      ),
    ]);

    // Payments against this client's invoices.
    const invoiceIds = new Set(invoices.map((i) => i._id));
    const payments = (
      await Promise.all(
        Array.from(invoiceIds).map((id) =>
          ctx.db
            .query("payments")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", id))
            .collect(),
        ),
      )
    )
      .flat()
      .map((p) => ({
        ...p,
        invoice: invoices.find((i) => i._id === p.invoiceId) ?? null,
      }));

    // Communications = documents of kind "communication" + client portal
    // messages; both are already matter-access filtered.
    const communications = documents.filter((d) => d.kind === "communication");

    // Portal grant identity (never expose more than needed).
    const portalUser = client.userId
      ? ((await ctx.db.get(client.userId)) as Doc<"users"> | null)
      : null;

    const responsible = client.responsibleLawyerId
      ? ((await ctx.db.get(client.responsibleLawyerId)) as Doc<"users"> | null)
      : null;

    const outstanding = invoices
      .filter((i) => i.status !== "paid" && i.status !== "cancelled" && i.status !== "draft")
      .reduce((s, i) => s + (i.totalMinor - i.amountPaidMinor), 0);

    return {
      client,
      matters: matters.sort((a, b) => b.updatedAt - a.updatedAt),
      contacts,
      documents: documents.sort((a, b) => b.createdAt - a.createdAt),
      communications: communications.sort((a, b) => b.createdAt - a.createdAt),
      messages: notes
        .filter((n) => n.fromClient === true || n.toClient === true)
        .sort((a, b) => b.createdAt - a.createdAt),
      internalNotes: notes
        .filter((n) => n.fromClient !== true && n.toClient !== true)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20),
      invoices: invoices.sort((a, b) => b.createdAt - a.createdAt),
      payments: payments.sort((a, b) => b.createdAt - a.createdAt),
      outstanding,
      portalUser: portalUser
        ? { email: portalUser.email ?? null, name: portalUser.name ?? null }
        : null,
      responsible: responsible
        ? { name: responsible.name ?? null, email: responsible.email ?? null }
        : null,
      canManagePortal: can(ac, "team.manage") || can(ac, "client.edit"),
    };
  },
});

/**
 * Grant portal access: bind a verified user account to this client
 * record (client.edit or team.manage).
 */
export const grantPortalAccess = mutation({
  args: { clientId: v.id("clients"), email: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "client.edit") && !can(ac, "team.manage")) {
      throw new Error("Your role is not permitted to manage portal access.");
    }
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (!user) {
      throw new Error(
        "No verified account exists for that email. Send an invitation first — access binds to the invited account.",
      );
    }
    if (user.isAnonymous) {
      throw new Error("Portal access requires a verified account.");
    }
    await ctx.db.patch(args.clientId, { userId: user._id });
  },
});

/** Revoke portal access. */
export const revokePortalAccess = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "client.edit") && !can(ac, "team.manage")) {
      throw new Error("Your role is not permitted to manage portal access.");
    }
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== ac.org._id) {
      throw new Error("Client not found in your organization.");
    }
    await ctx.db.patch(args.clientId, { userId: undefined });
  },
});
