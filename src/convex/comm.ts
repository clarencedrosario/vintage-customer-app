// =====================================================================
// Communications orchestration — opt-in preferences, the WhatsApp
// template registry, hearing/invoice reminders, and client updates
// prepared from approved information.
//
// Guardrails baked in:
//  - WhatsApp requires an explicit opt-in (commPreferences row with
//    whatsappEnabled) AND a registry-listed approved template. The
//    "Open WhatsApp" quick link never fabricates a send.
//  - Client updates are posts on the matter thread. They may only be
//    SENT after approval (an approved draft version) or an explicit,
//    per-thread "auto-send approved updates" authorization recorded by
//    a lawyer. Internal strategy never auto-flows: only text a lawyer
//    types into the update composer is sent.
// =====================================================================

import { v } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { can, getAccessContext, requireAccess, requireMatter } from "./access";

const MAX_TEXT = 4000;

// ---------------------------------------------------------------------
// WhatsApp template registry — only templates listed here can be sent.
// Names must match templates approved in the Meta Business Manager.
// ---------------------------------------------------------------------

export const WHATSAPP_TEMPLATES: Record<
  string,
  { label: string; category: string; params: string[]; languageCode: string }
> = {
  hearing_reminder: {
    label: "Hearing reminder",
    category: "hearing",
    params: ["clientName", "matterRef", "hearingDate", "courtName"],
    languageCode: "en",
  },
  invoice_reminder: {
    label: "Invoice payment reminder",
    category: "invoice",
    params: ["clientName", "invoiceNumber", "amountDue", "dueDate"],
    languageCode: "en",
  },
  case_update: {
    label: "Case update",
    category: "client_update",
    params: ["clientName", "matterRef", "updateText"],
    languageCode: "en",
  },
};

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

/** The matter's client thread (creates nothing; null when absent). */
async function clientThread(
  ctx: QueryCtx | MutationCtx,
  matterId: Id<"matters">,
) {
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_matter", (q) => q.eq("matterId", matterId))
    .collect();
  return (
    rows
      .filter((c) => c.scope === "matter" && !c.archivedAt)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

/** WhatsApp target for a user, honouring opt-in and category toggles. */
async function userWhatsappTarget(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  category: "hearing" | "invoice" | "client_update",
): Promise<{ to: string } | null> {
  const prefs = await ctx.db
    .query("commPreferences")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .first();
  if (!prefs?.whatsappEnabled || !prefs.whatsappNumber) return null;
  if (category === "hearing" && !prefs.hearingReminders) return null;
  if (category === "invoice" && !prefs.invoiceReminders) return null;
  if (category === "client_update" && !prefs.clientUpdates) return null;
  return { to: prefs.whatsappNumber };
}

// ---------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------

export const myPreferences = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db
      .query("commPreferences")
      .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", ac.user._id))
      .first();
    return (
      row ?? {
        emailEnabled: true,
        whatsappEnabled: false,
        whatsappNumber: undefined,
        hearingReminders: true,
        invoiceReminders: true,
        clientUpdates: true,
      }
    );
  },
});

export const setPreferences = mutation({
  args: {
    emailEnabled: v.boolean(),
    whatsappEnabled: v.boolean(),
    whatsappNumber: v.optional(v.string()),
    hearingReminders: v.boolean(),
    invoiceReminders: v.boolean(),
    clientUpdates: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const existing = await ctx.db
      .query("commPreferences")
      .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", ac.user._id))
      .first();
    const cleanNumber = args.whatsappNumber?.replace(/[^\d]/g, "");
    const values = {
      orgId: ac.org._id,
      userId: ac.user._id,
      emailEnabled: args.emailEnabled,
      whatsappEnabled: args.whatsappEnabled && Boolean(cleanNumber),
      whatsappNumber: cleanNumber,
      hearingReminders: args.hearingReminders,
      invoiceReminders: args.invoiceReminders,
      clientUpdates: args.clientUpdates,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("commPreferences", values);
  },
});

// ---------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------

export const listTemplates = query({
  args: {},
  handler: async () =>
    Object.entries(WHATSAPP_TEMPLATES).map(([name, t]) => ({
      name,
      label: t.label,
      category: t.category,
      params: t.params,
      languageCode: t.languageCode,
    })),
});

// ---------------------------------------------------------------------
// Reminders — hearing & invoice (WhatsApp to opted-in recipients)
// ---------------------------------------------------------------------

/** Send a WhatsApp hearing reminder to the matter's client identity. */
export const sendHearingReminder = mutation({
  args: { hearingId: v.id("hearings") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "hearing.manage") && !can(ac, "team.manage")) {
      throw new Error("Your role is not permitted to send reminders.");
    }
    const hearing = await ctx.db.get(args.hearingId);
    if (!hearing) throw new Error("Hearing not found.");
    const matter = await requireMatter(ctx, ac, hearing.matterId);
    const client = await ctx.db.get(matter.clientId);
    if (!client?.userId) {
      throw new Error(
        "This client has no portal identity — invite them from the client file first.",
      );
    }
    const target = await userWhatsappTarget(ctx, ac.org._id, client.userId, "hearing");
    if (!target) throw new Error("The client has not opted in to WhatsApp reminders.");

    const when = new Date(hearing.at).toLocaleString("en-IN", {
      timeZone: ac.org.timezone || "Asia/Kolkata",
    });
    // Mutations cannot await actions; schedule the provider call.
    await ctx.scheduler.runAfter(0, api.notify.sendWhatsappTemplate, {
      orgId: ac.org._id,
      to: target.to,
      recipientUserId: client.userId,
      category: "hearing_reminder",
      templateName: "hearing_reminder",
      languageCode: WHATSAPP_TEMPLATES.hearing_reminder.languageCode,
      params: [client.name, matter.reference, when, matter.court ?? "the court"],
    });
    return { ok: true as const };
  },
});

/** Send a WhatsApp payment reminder for one invoice. */
export const sendInvoiceReminder = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "billing.payment") && !can(ac, "billing.invoice")) {
      throw new Error("Your role is not permitted to send payment reminders.");
    }
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== ac.org._id) throw new Error("Invoice not found.");
    const client = await ctx.db.get(invoice.clientId);
    if (!client?.userId) throw new Error("This client has no portal identity yet.");
    const target = await userWhatsappTarget(ctx, ac.org._id, client.userId, "invoice");
    if (!target) throw new Error("The client has not opted in to WhatsApp reminders.");

    const outstanding = Math.round(invoice.totalMinor - (invoice.amountPaidMinor ?? 0)) / 100;
    const due = invoice.dueOn ?? invoice.issuedOn;
    await ctx.scheduler.runAfter(0, api.notify.sendWhatsappTemplate, {
      orgId: ac.org._id,
      to: target.to,
      recipientUserId: client.userId,
      category: "invoice_reminder",
      templateName: "invoice_reminder",
      languageCode: WHATSAPP_TEMPLATES.invoice_reminder.languageCode,
      params: [client.name, invoice.number, `Rs. ${outstanding.toLocaleString("en-IN")}`, due],
    });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------
// Client updates — approval-gated posting to the matter thread
// ---------------------------------------------------------------------

export const prepareClientUpdate = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const matter = await requireMatter(ctx, ac, args.matterId);
    const client = await ctx.db.get(matter.clientId);
    const thread = await clientThread(ctx, args.matterId);
    let clientWhatsappOptIn = false;
    const clientUserId = client?.userId;
    if (clientUserId) {
      const prefs = await ctx.db
        .query("commPreferences")
        .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", clientUserId))
        .first();
      clientWhatsappOptIn = Boolean(prefs?.whatsappEnabled);
    }
    return {
      matterRef: matter.reference,
      matterTitle: matter.title,
      clientName: client?.name ?? "Client",
      clientWhatsappOptIn,
      threadId: thread?._id ?? null,
      autoSendUpdates: Boolean(thread?.autoSendUpdates),
    };
  },
});

/**
 * Post a client update onto the matter thread. The text is exactly what
 * the lawyer typed — nothing internal is pulled in automatically.
 * Approval gate: either the version was approved in the Drafts desk
 * (approvedVersionId) or the thread carries an explicit auto-send rule.
 */
export const sendClientUpdate = mutation({
  args: {
    matterId: v.id("matters"),
    text: v.string(),
    whatsappAlso: v.optional(v.boolean()),
    approvedVersionId: v.optional(v.id("draftVersions")),
    autoAuthorized: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ conversationId: Id<"conversations">; whatsappQueued: boolean }> => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("Your role is not permitted to post client updates.");
    }
    const matter = await requireMatter(ctx, ac, args.matterId);
    const text = args.text.trim();
    if (!text) throw new Error("Update text is required.");
    if (text.length > MAX_TEXT) throw new Error("Update is too long.");

    // The approval gate.
    if (args.approvedVersionId !== undefined) {
      const version = await ctx.db.get(args.approvedVersionId);
      if (version?.status !== "approved") {
        throw new Error("That draft version is not approved.");
      }
    } else if (args.autoAuthorized) {
      const thread = await clientThread(ctx, args.matterId);
      if (!thread?.autoSendUpdates) {
        throw new Error(
          "Enable 'send approved updates automatically' on the matter thread first, or link an approved draft version.",
        );
      }
    } else {
      throw new Error(
        "Link an approved draft version or enable the thread's auto-send rule before sending.",
      );
    }

    // Ensure the thread exists and carries the client.
    let thread: Doc<"conversations"> | null = await clientThread(ctx, args.matterId);
    if (!thread) {
      const created: { conversationId: Id<"conversations"> } = await (
        ctx as MutationCtx
      ).runMutation(api.conversations.createConversation, {
        matterId: args.matterId,
        scope: "matter" as const,
        subject: `${matter.reference} — client thread`,
        memberIds: matter.leadLawyerId ? [matter.leadLawyerId] : undefined,
        includeClient: true,
      });
      thread = await ctx.db.get(created.conversationId);
    }
    if (!thread) throw new Error("Could not open the client thread.");

    const client = await ctx.db.get(matter.clientId);
    await ctx.runMutation(internal.conversations.postSystemUpdate, {
      conversationId: thread._id,
      body: text,
      senderId: ac.user._id,
      kind: "client_update" as const,
    });

    // Optional WhatsApp fan-out using the case_update template.
    let whatsappQueued = false;
    const clientUserId = client?.userId;
    if (args.whatsappAlso && client && clientUserId) {
      const target = await userWhatsappTarget(ctx, ac.org._id, clientUserId, "client_update");
      if (target) {
        await ctx.scheduler.runAfter(0, api.notify.sendWhatsappTemplate, {
          orgId: ac.org._id,
          to: target.to,
          recipientUserId: clientUserId,
          category: "client_update",
          templateName: "case_update",
          languageCode: WHATSAPP_TEMPLATES.case_update.languageCode,
          params: [client.name, matter.reference, text.slice(0, 400)],
          conversationId: thread._id,
        });
        whatsappQueued = true;
      }
    }
    return { conversationId: thread._id, whatsappQueued };
  },
});

/**
 * Toggle the explicit auto-send rule on a matter thread. Deliberately
 * manual — a lawyer must turn it on for each thread.
 */
export const setThreadAutoSend = mutation({
  args: { conversationId: v.id("conversations"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.edit") && !can(ac, "team.manage")) {
      throw new Error("Only lawyers managing the matter can change this.");
    }
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.orgId !== ac.org._id) throw new Error("Conversation not found.");
    if (conv.matterId !== undefined) await requireMatter(ctx, ac, conv.matterId);
    await ctx.db.patch(args.conversationId, { autoSendUpdates: args.enabled });
  },
});

// ---------------------------------------------------------------------
// Invitation email wiring (called by the invitations flow)
// ---------------------------------------------------------------------

/** Queue the invitation email through the provider bridge. */
export const sendInvitationEmail = mutation({
  args: {
    orgId: v.id("organizations"),
    to: v.string(),
    orgName: v.string(),
    roleLabel: v.string(),
    inviteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, api.notify.sendInviteEmail, {
      orgId: args.orgId,
      to: args.to,
      orgName: args.orgName,
      roleLabel: args.roleLabel,
      inviteUrl: args.inviteUrl,
    });
    return { queued: true as const };
  },
});
