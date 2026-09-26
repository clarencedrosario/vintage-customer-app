// =====================================================================
// Conversations — matter threads (with the client) and internal
// colleague threads, with participant management, authorized
// attachments, read/unread state and client-to-lawyer messaging.
//
// Access is enforced on every path:
//  - lists       -> org + role + matter-level filtering
//  - detail      -> participant OR matter access (members); portal users
//                   only see conversations attached to their bound client
//  - sends       -> active participant
//  - read-state  -> participant
//  - attachments -> matter access + document-level access re-checked on
//                   every read; internal documents never reach clients
// =====================================================================

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import {
  can,
  canViewDocument,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import type { AccessContext } from "./access";

const MAX_BODY = 4000;
const MAX_SUBJECT = 150;
// Chat attachments: per-message cap and per-file cap (25 MB).
const MAX_FILES_PER_MESSAGE = 6;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

/** The verified client identity bound to the signed-in portal user. */
async function clientForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"clients"> | null> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const alive = rows.filter((c) => !c.archivedAt);
  return alive[0] ?? null;
}

/** Participant row for this conversation, or null. */
async function participantRow(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  const rows = await ctx.db
    .query("conversationParticipants")
    .withIndex("by_conv_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId),
    )
    .collect();
  return rows.find((p) => !p.removedAt) ?? null;
}

/**
 * Can the caller open this conversation?
 * - console members: participant, or (for matter threads) matter access
 *   so responsible lawyers never lose visibility of the client thread
 * - clients: participant and bound identity, matter thread only
 */
async function canViewConversation(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  ac: AccessContext,
  portal: "member" | "client",
): Promise<boolean> {
  if (conversation.orgId !== ac.org._id) return false;
  if (conversation.archivedAt) return false;
  const participant = await participantRow(ctx, conversation._id, ac.user._id);
  if (portal === "client") {
    if (!participant || participant.role !== "client") return false;
    // The bound client must match the thread's client.
    const me = await clientForUser(ctx, ac.user._id);
    if (!me || conversation.clientId !== me._id) return false;
    if (conversation.matterId === undefined) return false;
    return true;
  }
  if (participant) return true;
  const matterId = conversation.matterId;
  if (matterId !== undefined) {
    const matter = await ctx.db.get(matterId);
    if (matter && canViewMatter(ac, matter)) return true;
  }
  return false;
}

async function requireConversation(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
  portal: "member" | "client",
) {
  const ac = await getAccessContext(ctx);
  if (!ac) throw new Error("You must be signed in.");
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  if (!(await canViewConversation(ctx, conversation, ac, portal))) {
    throw new Error("You do not have access to this conversation.");
  }
  return { ac, conversation };
}

// ---------------------------------------------------------------------
// Queries — lists
// ---------------------------------------------------------------------

export const listForMe = query({
  args: { scope: v.optional(v.union(v.literal("matter"), v.literal("internal"))) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const memberships = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_user", (q) => q.eq("userId", ac.user._id))
      .collect();
    const mine = memberships.filter((p) => !p.removedAt);
    const seen = new Set<Id<"conversations">>();
    const out: Array<{
      _id: Id<"conversations">;
      subject: string;
      scope: "matter" | "internal";
      matterId: Id<"matters"> | undefined;
      matterRef: string | null;
      matterTitle: string | null;
      lastMessageAt: number | undefined;
      unreadCount: number;
      canSend: boolean;
    }> = [];
    for (const p of mine) {
      if (seen.has(p.conversationId)) continue;
      seen.add(p.conversationId);
      const conv = await ctx.db.get(p.conversationId);
      if (!conv || conv.archivedAt) continue;
      if (args.scope && conv.scope !== args.scope) continue;
      if (conv.orgId !== ac.org._id) continue;
      // Non-participant matter visibility (responsible lawyers) for the desk.
      const direct = await canViewConversation(ctx, conv, ac, "member");
      if (!direct) continue;
      let matterRef: string | null = null;
      let matterTitle: string | null = null;
      if (conv.matterId !== undefined) {
        const matter = await ctx.db.get(conv.matterId);
        matterRef = matter?.reference ?? null;
        matterTitle = matter?.title ?? null;
      }
      out.push({
        _id: conv._id,
        subject: conv.subject,
        scope: conv.scope,
        matterId: conv.matterId,
        matterRef,
        matterTitle,
        lastMessageAt: conv.lastMessageAt,
        unreadCount: p.unreadCount,
        canSend: true,
      });
    }
    return out.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  },
});

/** Conversations attached to one matter (chamber view). */
export const listForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const visible = [];
    for (const conv of rows) {
      if (conv.archivedAt) continue;
      if (!(await canViewConversation(ctx, conv, ac, "member"))) continue;
      const participants = await ctx.db
        .query("conversationParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conv._id))
        .collect();
      const live = participants.filter((p) => !p.removedAt);
      const people = await Promise.all(
        live.map(async (p) => {
          const u = await ctx.db.get(p.userId);
          return { userId: p.userId, name: u?.name ?? "Member", role: p.role };
        }),
      );
      visible.push({
        _id: conv._id,
        subject: conv.subject,
        scope: conv.scope,
        lastMessageAt: conv.lastMessageAt,
        participants: people,
      });
    }
    return visible.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  },
});

// ---------------------------------------------------------------------
// Queries — detail (messages, participants, attachments re-checked)
// ---------------------------------------------------------------------

export const detail = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) return null;
    const portal = (await clientForUser(ctx, ac.user._id)) ? "client" : "member";
    if (!(await canViewConversation(ctx, conversation, ac, portal))) return null;

    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    const messages = [];
    for (const m of msgs.sort((a, b) => a.createdAt - b.createdAt)) {
      // Attachments are re-checked against the READER's access on every load.
      const attachments = [];
      for (const docId of m.attachmentDocumentIds ?? []) {
        const doc = await ctx.db.get(docId);
        if (!doc) continue;
        const matter = await ctx.db.get(doc.matterId);
        if (!matter) continue;
        if (!canViewDocument(ac, doc, matter)) continue;
        attachments.push({ documentId: doc._id, name: doc.name });
      }
      // Uploaded images/files: URL is minted per read; images render
      // inline in the UI, other files download.
      const files = [];
      for (const f of m.attachmentFiles ?? []) {
        const url = await ctx.storage.getUrl(f.storageId);
        if (!url) continue; // deleted storage — drop silently
        files.push({ ...f, url });
      }
      let invoiceRef: string | null = null;
      let invoiceAmountMinor: number | null = null;
      if (m.linkedInvoiceId) {
        const inv = await ctx.db.get(m.linkedInvoiceId);
        if (inv && inv.orgId === ac.org._id) {
          invoiceRef = inv.number;
          invoiceAmountMinor = inv.totalMinor;
        }
      }
      const sender = m.senderId ? await ctx.db.get(m.senderId) : null;
      messages.push({
        _id: m._id,
        body: m.body,
        senderKind: m.senderKind,
        senderName:
          sender?.name ??
          (m.senderKind === "system" ? "System" : m.senderKind === "client" ? "Client" : "Member"),
        createdAt: m.createdAt,
        attachments,
        files,
        invoiceRef,
        invoiceAmountMinor,
        kind: m.kind ?? "message",
      });
    }

    const participantRows = (
      await ctx.db
        .query("conversationParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
        .collect()
    ).filter((p) => !p.removedAt);
    const participants = [];
    for (const p of participantRows) {
      const u = await ctx.db.get(p.userId);
      participants.push({
        userId: p.userId,
        name: u?.name ?? "Member",
        role: p.role,
        unreadCount: p.unreadCount,
      });
    }

    const me = participantRows.find((p) => p.userId === ac.user._id) ?? null;
    return {
      _id: conversation._id,
      subject: conversation.subject,
      scope: conversation.scope,
      matterId: conversation.matterId,
      messages,
      participants,
      myUnread: me?.unreadCount ?? 0,
    };
  },
});

// ---------------------------------------------------------------------
// Mutations — threads & participants
// ---------------------------------------------------------------------

export const createConversation = mutation({
  args: {
    matterId: v.optional(v.id("matters")),
    scope: v.union(v.literal("matter"), v.literal("internal")),
    subject: v.string(),
    memberIds: v.optional(v.array(v.id("users"))),
    includeClient: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const subject = args.subject.trim();
    if (!subject) throw new Error("Subject is required.");
    if (subject.length > MAX_SUBJECT) throw new Error("Subject is too long.");
    if (args.scope === "matter") {
      if (args.matterId === undefined) throw new Error("Choose a matter for this thread.");
      await requireMatter(ctx, ac, args.matterId);
    }
    const now = Date.now();
    // For matter threads carrying the client, record the matter's client.
    let clientId: Id<"clients"> | undefined;
    if (args.includeClient && args.matterId !== undefined) {
      const matter = await ctx.db.get(args.matterId);
      if (matter) clientId = matter.clientId;
    }
    const conversationId = await ctx.db.insert("conversations", {
      orgId: ac.org._id,
      matterId: args.matterId,
      clientId,
      scope: args.scope,
      subject,
      createdBy: ac.user._id,
      createdAt: now,
      lastMessageAt: now,
    });

    const addIds = new Set<Id<"users">>([ac.user._id, ...(args.memberIds ?? [])]);
    for (const uid of addIds) {
      const m = await ctx.db
        .query("memberships")
        .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", uid))
        .first();
      if (!m || m.status !== "active") continue; // active members only
      await ctx.db.insert("conversationParticipants", {
        conversationId,
        orgId: ac.org._id,
        userId: uid,
        role: "member",
        unreadCount: 0,
        addedBy: ac.user._id,
        createdAt: now,
      });
    }

    // Attach the bound portal identity of the matter's client.
    if (args.includeClient && args.matterId !== undefined) {
      const matter = await ctx.db.get(args.matterId);
      if (matter) {
        const client = await ctx.db.get(matter.clientId);
        if (client?.userId && !client.archivedAt) {
          await ctx.db.insert("conversationParticipants", {
            conversationId,
            orgId: ac.org._id,
            userId: client.userId,
            role: "client",
            unreadCount: 0,
            addedBy: ac.user._id,
            createdAt: now,
          });
        }
      }
    }
    return { conversationId };
  },
});

export const addParticipant = mutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    role: v.optional(v.union(v.literal("member"), v.literal("client"))),
  },
  handler: async (ctx, args) => {
    const { ac, conversation } = await requireConversation(ctx, args.conversationId, "member");
    // Only colleagues with team-management rights or the thread creator.
    if (!can(ac, "team.manage") && conversation.createdBy !== ac.user._id) {
      throw new Error("Only the thread creator or team managers can add participants.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", args.userId))
      .first();
    const isMember = membership?.status === "active";
    if (args.role === "client") {
      // Client participants must be the verified portal identity of a
      // client of this org; internal threads never take clients.
      if (conversation.scope !== "matter") {
        throw new Error("Internal threads are colleague-only.");
      }
      const clients = await ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect();
      const bound = clients.find((c) => c.userId === args.userId && !c.archivedAt);
      if (!bound) {
        throw new Error("That user is not the verified portal identity of one of your clients.");
      }
    } else if (!isMember) {
      throw new Error("Participants must be active members of the organisation.");
    }
    const existing = await participantRow(ctx, args.conversationId, args.userId);
    if (existing) return;
    await ctx.db.insert("conversationParticipants", {
      conversationId: args.conversationId,
      orgId: ac.org._id,
      userId: args.userId,
      role: args.role === "client" ? "client" : "member",
      unreadCount: 0,
      addedBy: ac.user._id,
      createdAt: Date.now(),
    });
  },
});

export const removeParticipant = mutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const { ac, conversation } = await requireConversation(ctx, args.conversationId, "member");
    if (!can(ac, "team.manage") && conversation.createdBy !== ac.user._id) {
      throw new Error("Only the thread creator or team managers can remove participants.");
    }
    const existing = await participantRow(ctx, args.conversationId, args.userId);
    if (!existing) return;
    await ctx.db.patch(existing._id, { removedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------
// Mutations — sending & read state
// ---------------------------------------------------------------------

/**
 * Upload URL for a chat attachment (image or file). The caller uploads
 * directly to Convex storage, then sends the message referencing the
 * storage id — sendMessage re-validates every file server-side.
 */
export const generateAttachmentUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You must be signed in.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    attachmentDocumentIds: v.optional(v.array(v.id("matterDocuments"))),
    // Uploaded images/files (Convex storage). Each entry is re-checked
    // against real storage metadata at send time — the client cannot
    // spoof size or content type.
    attachmentFiles: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          name: v.string(),
          mimeType: v.string(),
          size: v.number(),
          type: v.union(v.literal("image"), v.literal("file")),
        }),
      ),
    ),
    linkedInvoiceId: v.optional(v.id("invoices")),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You must be signed in.");
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.archivedAt) throw new Error("Conversation not found.");
    const body = args.body.trim();
    if (!body) throw new Error("Message cannot be empty.");
    if (body.length > MAX_BODY) throw new Error("Message is too long (max 4000 characters).");

    const isClient = Boolean(await clientForUser(ctx, ac.user._id));
    const portal = isClient ? "client" : "member";
    if (!(await canViewConversation(ctx, conversation, ac, portal))) {
      throw new Error("You do not have access to this conversation.");
    }
    const me = await participantRow(ctx, args.conversationId, ac.user._id);
    if (!me) throw new Error("Only participants can send in this thread.");
    if (isClient && conversation.scope !== "matter") {
      throw new Error("Clients can write only on their matter threads.");
    }

    // Attachments: every document must belong to the thread's matter and be
    // visible to the SENDER. Clients can attach nothing internal by design.
    for (const docId of args.attachmentDocumentIds ?? []) {
      const doc = await ctx.db.get(docId);
      if (!doc || doc.matterId !== conversation.matterId) {
        throw new Error("Attachments must belong to this matter.");
      }
      const matter = await ctx.db.get(doc.matterId);
      if (!matter || !canViewDocument(ac, doc, matter)) {
        throw new Error("You cannot attach a document you cannot see.");
      }
    }
    // Uploaded images/files: every storage id must really exist and the
    // declared shape must match the stored metadata. A message may carry
    // files OR documents — body may be empty when a file is present.
    const files = [];
    for (const f of args.attachmentFiles ?? []) {
      const meta = await ctx.storage.getMetadata(f.storageId);
      if (!meta) throw new Error("An attached file is no longer available — re-upload it.");
      if (!f.name.trim()) throw new Error("Attached files need a file name.");
      if ((meta.size ?? 0) > MAX_FILE_BYTES) {
        throw new Error("Each attachment must be 25 MB or smaller.");
      }
      const isImage = (meta.contentType ?? "").startsWith("image/");
      files.push({
        storageId: f.storageId,
        name: f.name.trim().slice(0, 200),
        mimeType: meta.contentType ?? f.mimeType ?? "application/octet-stream",
        size: meta.size ?? f.size ?? 0,
        type: isImage ? ("image" as const) : ("file" as const),
      });
    }
    if (files.length > MAX_FILES_PER_MESSAGE) {
      throw new Error(`Attach at most ${MAX_FILES_PER_MESSAGE} files per message.`);
    }
    if (!body && files.length === 0) {
      throw new Error("Write a message or attach a file.");
    }

    if (args.linkedInvoiceId) {
      const inv = await ctx.db.get(args.linkedInvoiceId);
      if (!inv || inv.orgId !== ac.org._id) throw new Error("Invoice not found.");
      if (isClient) {
        // Clients may reference only invoices raised to their own client.
        const me2 = await clientForUser(ctx, ac.user._id);
        if (!me2 || inv.clientId !== me2._id) {
          throw new Error("You can only reference invoices on your own file.");
        }
      }
    }

    const now = Date.now();
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      orgId: ac.org._id,
      senderId: ac.user._id,
      senderKind: isClient ? "client" : "member",
      body,
      attachmentDocumentIds: args.attachmentDocumentIds,
      attachmentFiles: files.length > 0 ? files : undefined,
      linkedInvoiceId: args.linkedInvoiceId,
      kind: "message",
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });

    // Bump unread counts for everyone except the sender.
    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const p of participants) {
      if (p.removedAt || p.userId === ac.user._id) continue;
      await ctx.db.patch(p._id, { unreadCount: p.unreadCount + 1 });
      // In-app notification (deduped per message + recipient).
      await ctx.runMutation(internal.notifications.createInternal, {
        orgId: ac.org._id,
        userId: p.userId,
        kind: "message",
        title: `New message — ${conversation.subject}`,
        body: body.slice(0, 160),
        linkTo: "/comms",
        dedupeKey: `msg:${args.conversationId}:${now}`,
      });
    }
  },
});

/** Post an approved client update into the thread (called from comm.ts). */
export const postSystemUpdate = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
    senderId: v.id("users"),
    kind: v.union(v.literal("client_update"), v.literal("reminder")),
  },
  handler: async (ctx, args) => {
    // Internal call path only (invoked via internal references from comm.ts).
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    const now = Date.now();
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      orgId: conversation.orgId,
      senderId: args.senderId,
      senderKind: "member",
      body: args.body,
      kind: args.kind,
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const p of participants) {
      if (p.removedAt || p.userId === args.senderId) continue;
      await ctx.db.patch(p._id, { unreadCount: p.unreadCount + 1 });
    }
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You must be signed in.");
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    const isClient = Boolean(await clientForUser(ctx, ac.user._id));
    if (!(await canViewConversation(ctx, conversation, ac, isClient ? "client" : "member"))) {
      throw new Error("You do not have access to this conversation.");
    }
    const me = await participantRow(ctx, args.conversationId, ac.user._id);
    if (!me) return;
    await ctx.db.patch(me._id, { unreadCount: 0, lastReadAt: Date.now() });
  },
});

/** Notification center: recent outbound comms with delivery status. */
export const notificationFeed = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("notificationLog")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((r) => ({
        _id: r._id,
        channel: r.channel,
        category: r.category,
        recipient: r.recipient,
        recipientUserId: r.recipientUserId,
        status: r.status,
        failureReason: r.failureReason,
        createdAt: r.createdAt,
      }));
  },
});

/** Trigger the portal notification email for a client message. */
export const notifyParticipantsByEmail = mutation({
  args: { conversationId: v.id("conversations"), messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const { ac, conversation } = await requireConversation(ctx, args.conversationId, "member");
    const message = await ctx.db.get(args.messageId);
    if (!message || message.conversationId !== args.conversationId) {
      throw new Error("Message not found.");
    }
    const matter = conversation.matterId ? await ctx.db.get(conversation.matterId) : null;
    const participants = await ctx.db
      .query("conversationParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    let queued = 0;
    for (const p of participants) {
      if (p.removedAt || p.userId === ac.user._id) continue;
      const prefs = await ctx.db
        .query("commPreferences")
        .withIndex("by_org_user", (q) => q.eq("orgId", ac.org._id).eq("userId", p.userId))
        .first();
      if (prefs && !prefs.emailEnabled) continue;
      const user = await ctx.db.get(p.userId);
      const email = user?.email;
      if (!email || !user?.emailVerified) continue;
      await ctx.scheduler.runAfter(0, api.notify.sendEmail, {
        orgId: ac.org._id,
        to: email,
        recipientUserId: p.userId,
        category: p.role === "client" ? "client_update" : "internal_message",
        subject: `New message — ${conversation.subject}`,
        title: conversation.subject,
        bodyHtml: `<p style="margin:0 0 10px;">${message.body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p><p style="margin:0;color:#64748B;font-size:13px;">Reply from your Advokate portal.${
          matter ? ` Matter ${matter.reference}.` : ""
        }</p>`,
        conversationId: conversation._id,
      });
      queued += 1;
    }
    return { queued };
  },
});

// =====================================================================
// Email capture (email integration)
//
// Records an email copied into Advokate (from a linked mailbox flow or
// manual filing) as a thread message carrying the email's own metadata,
// so it participates in every thread affordance: matter/client linking,
// attachments, exports. Attachments are filed to the Document Vault by
// the uploader via the normal upload flow and referenced by id here.
// Nothing invents an email record — only staff may file one.
// =====================================================================

/** File an email into a thread (staff only, audited metadata on the row). */
export const recordEmail = mutation({
  args: {
    conversationId: v.id("conversations"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    fromAddress: v.string(),
    toAddress: v.string(),
    subject: v.string(),
    body: v.string(),
    receivedAt: v.number(),
    // Vault documents already uploaded for this email's attachments.
    attachmentDocumentIds: v.optional(v.array(v.id("matterDocuments"))),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You must be signed in.");
    if (!can(ac, "note.write")) {
      throw new Error("Your role is not permitted to file emails.");
    }
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.orgId !== ac.org._id || conversation.archivedAt) {
      throw new Error("Conversation not found.");
    }
    if (conversation.matterId !== undefined) {
      await requireMatter(ctx, ac, conversation.matterId);
    }
    const body = args.body.trim();
    if (!body) throw new Error("Email body is required.");
    if (body.length > MAX_BODY) throw new Error("Email body is too long.");

    // Attachment integrity: same matter, visible to the filer.
    for (const docId of args.attachmentDocumentIds ?? []) {
      const doc = await ctx.db.get(docId);
      if (!doc || doc.matterId !== conversation.matterId) {
        throw new Error("Attachments must belong to the thread's matter.");
      }
      const matter = await ctx.db.get(doc.matterId);
      if (!matter || !canViewDocument(ac, doc, matter)) {
        throw new Error("You cannot attach a document you cannot see.");
      }
    }

    const now = Date.now();
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      orgId: ac.org._id,
      senderId: ac.user._id,
      senderKind: "member",
      body: [
        `📧 ${args.direction === "inbound" ? "From" : "To"}: ${args.fromAddress} → ${args.toAddress}`,
        `Subject: ${args.subject.trim()}`,
        ``,
        body,
      ].join("\n"),
      attachmentDocumentIds: args.attachmentDocumentIds,
      kind: "message",
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
    return { ok: true as const };
  },
});

/** Create a task from an email thread message (staff, task.manage). */
export const createTaskFromEmail = mutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.string(),
    priority: v.union(v.literal("normal"), v.literal("high"), v.literal("urgent")),
    dueDate: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ taskId: Id<"tasks"> }> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.orgId !== ac.org._id) {
      throw new Error("Conversation not found.");
    }
    if (conversation.matterId === undefined) {
      throw new Error("Link the thread to a matter before creating tasks from it.");
    }
    const { taskId } = await ctx.runMutation(api.tasks.createTask, {
      matterId: conversation.matterId,
      title: args.title.trim(),
      kind: "general",
      priority: args.priority,
      dueDate: args.dueDate,
      assigneeId: args.assigneeId,
    });
    return { taskId };
  },
});
