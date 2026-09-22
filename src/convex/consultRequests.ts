import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { can, getAccessContext, requireAccess, requireCapability } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// ===============================================================
// Public consultation requests & bookings (section 22).
//
// A booking is a consultation appointment only: it never grants access
// to matters, documents or the client portal. Conversion to a connected
// client happens exclusively through `convertToClient`, an explicit
// chamber-side authorization step.
// ===============================================================

function makeReference(): string {
  // e.g. "AX-4F7K2Q" — unambiguous uppercase code.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `AX-${code}`;
}

function cleanHistory(
  existing: { at: number; text: string }[] | undefined,
  text: string,
): { at: number; text: string }[] {
  return [...(existing ?? []), { at: Date.now(), text: text.slice(0, 300) }].slice(-40);
}

// ---------------------------------------------------------------
// Public surface (no auth)
// ---------------------------------------------------------------

/** Public booking request against a published profile. */
export const requestBooking = mutation({
  args: {
    profileId: v.id("publicProfiles"),
    slotId: v.optional(v.number()),
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || !profile.published) {
      throw new Error("This advocate is not accepting consultation requests.");
    }
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", profile.orgId).eq("userId", profile.userId),
      )
      .collect();
    if (member[0]?.status !== "active" || member[0].orgRole === "support_staff") {
      throw new Error("This advocate is not accepting consultation requests.");
    }

    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    if (!name || name.length < 2) throw new Error("Please give your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Please give a valid email address so the advocate can reply.");
    }

    let slotAt: number | undefined;
    let slotLabel: string | undefined;
    if (args.slotId !== undefined) {
      const slot = (profile.slots ?? []).find((s) => s.startsAt === args.slotId);
      if (!slot) throw new Error("That slot is no longer offered — pick another.");
      if (slot.startsAt < Date.now()) {
        throw new Error("That slot has already passed — pick an upcoming one.");
      }
      slotAt = slot.startsAt;
      slotLabel = slot.label;
    }

    const org = await ctx.db.get(profile.orgId);
    if (!org) throw new Error("Chamber not found.");
    const advocate = await ctx.db.get(profile.userId);
    const advocateName = advocate?.name ?? "the advocate";

    const reference = makeReference();
    const now = Date.now();
    const id = await ctx.db.insert("consultations", {
      orgId: profile.orgId,
      clientName: name.slice(0, 200),
      clientEmail: email.slice(0, 160),
      clientPhone: args.phone?.trim().slice(0, 24) || undefined,
      matterSummary: args.summary?.trim().slice(0, 1000) || undefined,
      amountMinor: profile.feeMinor,
      status: "requested",
      source: "public",
      reference,
      advocateUserId: profile.userId,
      profileId: profile._id,
      slotAt,
      requesterUserId: undefined,
      history: [
        {
          at: now,
          text:
            slotAt !== undefined
              ? `Request sent to ${advocateName} for the slot “${slotLabel ?? "offered time"}”.`
              : `Request sent to ${advocateName} (no specific slot chosen).`,
        },
      ],
      createdAt: now,
      // createdById is undefined for public bookings — no chamber member
      // stands behind this request.
    });

    // Notify the advocate + billing-capable members in-app (best-effort).
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyNewRequest, {
      consultationId: id,
    });

    return { reference, orgName: org.name, advocateName };
  },
});

/**
 * Requester actions without an account, authenticated by reference code +
 * the email used at booking. Confirm a proposed reschedule, or cancel.
 */
export const requesterConfirmReschedule = mutation({
  args: { reference: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const c = await lookupPublic(ctx, args.reference, args.email);
    if (!c) throw new Error("No booking found for that reference and email.");
    if (c.status !== "reschedule_proposed" || c.proposedSlotAt === undefined) {
      throw new Error("There is no proposed new time to confirm right now.");
    }
    await ctx.db.patch(c._id, {
      slotAt: c.proposedSlotAt,
      proposedSlotAt: undefined,
      status: c.amountMinor > 0 ? "accepted" : "scheduled",
      updatedAt: Date.now(),
      history: cleanHistory(c.history, `Requester accepted the new time (${new Date(c.proposedSlotAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}).`),
    });
    return { ok: true };
  },
});

export const requesterCancel = mutation({
  args: { reference: v.string(), email: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const c = await lookupPublic(ctx, args.reference, args.email);
    if (!c) throw new Error("No booking found for that reference and email.");
    if (["cancelled", "declined", "completed", "refunded"].includes(c.status)) {
      throw new Error("This booking is already closed.");
    }
    await ctx.db.patch(c._id, {
      status: "cancelled",
      cancelReason: args.reason?.trim().slice(0, 300) || "Cancelled by requester.",
      updatedAt: Date.now(),
      history: cleanHistory(c.history, "Cancelled by the requester."),
    });
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyRequesterInternal, {
      consultationId: c._id,
      text: "Your consultation request was cancelled (at your request).",
    });
    return { ok: true };
  },
});

async function lookupPublic(
  ctx: MutationCtx,
  reference: string,
  email: string,
): Promise<Doc<"consultations"> | null> {
  const ref = reference.trim().toUpperCase();
  const rows = await ctx.db
    .query("consultations")
    .withIndex("by_reference", (q) => q.eq("reference", ref))
    .collect();
  return (
    rows.find(
      (r) =>
        r.source === "public" &&
        (r.clientEmail ?? "").toLowerCase() === email.trim().toLowerCase(),
    ) ?? null
  );
}

// ---------------------------------------------------------------
// Chamber surface (authenticated)
// ---------------------------------------------------------------

/** All consultation requests & bookings for the active organization. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!can(ac, "billing.invoice") && !can(ac, "billing.payment") && !can(ac, "matter.create"))
      return [];
    const rows = await ctx.db
      .query("consultations")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (c) => {
          const advocate = c.advocateUserId ? await ctx.db.get(c.advocateUserId) : null;
          return {
            _id: c._id,
            reference: c.reference ?? null,
            source: c.source ?? "chamber",
            clientName: c.clientName,
            clientEmail: c.clientEmail ?? null,
            clientPhone: c.clientPhone ?? null,
            matterSummary: c.matterSummary ?? null,
            amountMinor: c.amountMinor,
            status: c.status,
            slotAt: c.slotAt ?? null,
            proposedSlotAt: c.proposedSlotAt ?? null,
            advocateName: advocate?.name ?? null,
            advocateUserId: c.advocateUserId ?? null,
            profileId: c.profileId ?? null,
            connectedClientId: c.connectedClientId ?? null,
            cancelReason: c.cancelReason ?? null,
            paymentLinkUrl: c.paymentLinkUrl ?? null,
            history: (c.history ?? []).slice(-10),
            createdAt: c.createdAt,
          };
        }),
    );
  },
});

/** Accept a public request: confirm the slot (or set one now). */
export const accept = mutation({
  args: {
    consultationId: v.id("consultations"),
    slotAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await getScoped(ctx, ac, args.consultationId);
    if (c.status !== "requested" && c.status !== "reschedule_proposed") {
      throw new Error("Only an open request can be accepted.");
    }
    const slotAt = args.slotAt ?? c.slotAt ?? Date.now() + 3 * 24 * 60 * 60 * 1000;
    if (slotAt < Date.now()) throw new Error("The consultation time must be in the future.");
    const when = new Date(slotAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const needsPayment = c.amountMinor > 0;
    await ctx.db.patch(c._id, {
      status: needsPayment ? "accepted" : "scheduled",
      slotAt,
      proposedSlotAt: undefined,
      updatedAt: Date.now(),
      history: cleanHistory(
        c.history,
        `Accepted by ${ac.user.name ?? "the chamber"} — ${when}${needsPayment ? ". Fee payment pending." : ""}`,
      ),
    });
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyRequesterInternal, {
      consultationId: c._id,
      text: `Your consultation was accepted for ${when} with ${ac.user.name ?? "the chamber"}${needsPayment ? ". The fee payment link will be shared." : "."}`,
    });
    return { ok: true };
  },
});

/** Decline with a written reason (never silent). */
export const decline = mutation({
  args: { consultationId: v.id("consultations"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await getScoped(ctx, ac, args.consultationId);
    if (!["requested", "accepted", "reschedule_proposed"].includes(c.status)) {
      throw new Error("This request is already closed.");
    }
    const reason = args.reason.trim();
    if (!reason) throw new Error("Give the requester a short reason.");
    await ctx.db.patch(c._id, {
      status: "declined",
      cancelReason: reason.slice(0, 300),
      updatedAt: Date.now(),
      history: cleanHistory(c.history, `Declined — ${reason.slice(0, 200)}`),
    });
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyRequesterInternal, {
      consultationId: c._id,
      text: `Your consultation request was declined. Reason: ${reason.slice(0, 200)}`,
    });
    return { ok: true };
  },
});

/** Propose a new time; the requester confirms from their reference. */
export const proposeReschedule = mutation({
  args: { consultationId: v.id("consultations"), slotAt: v.number() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await getScoped(ctx, ac, args.consultationId);
    if (!["requested", "accepted", "scheduled", "reschedule_proposed"].includes(c.status)) {
      throw new Error("This booking can no longer be rescheduled.");
    }
    if (args.slotAt < Date.now()) throw new Error("Pick a future time.");
    const when = new Date(args.slotAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await ctx.db.patch(c._id, {
      status: "reschedule_proposed",
      proposedSlotAt: args.slotAt,
      updatedAt: Date.now(),
      history: cleanHistory(c.history, `New time proposed: ${when} — awaiting the requester's confirmation.`),
    });
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyRequesterInternal, {
      consultationId: c._id,
      text: `A new consultation time was proposed: ${when}. Confirm it with your reference code ${c.reference ?? ""} on the booking page.`,
    });
    return { ok: true };
  },
});

/** Chamber-side cancellation. */
export const cancelByChamber = mutation({
  args: { consultationId: v.id("consultations"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await getScoped(ctx, ac, args.consultationId);
    if (["cancelled", "declined", "completed", "refunded"].includes(c.status)) {
      throw new Error("This booking is already closed.");
    }
    const reason = args.reason.trim() || "Cancelled by the chamber.";
    await ctx.db.patch(c._id, {
      status: "cancelled",
      cancelReason: reason.slice(0, 300),
      updatedAt: Date.now(),
      history: cleanHistory(c.history, `Cancelled by the chamber — ${reason.slice(0, 200)}`),
    });
    await ctx.scheduler.runAfter(0, internal.consultRequests.notifyRequesterInternal, {
      consultationId: c._id,
      text: `Your consultation was cancelled by the chamber. Reason: ${reason.slice(0, 200)}`,
    });
    return { ok: true };
  },
});

/** Mark a held consultation completed. */
export const markCompleted = mutation({
  args: { consultationId: v.id("consultations") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const c = await getScoped(ctx, ac, args.consultationId);
    if (!["scheduled", "paid", "accepted"].includes(c.status)) {
      throw new Error("Only a scheduled consultation can be completed.");
    }
    await ctx.db.patch(c._id, {
      status: "completed",
      updatedAt: Date.now(),
      history: cleanHistory(c.history, "Consultation held and marked completed."),
    });
    return { ok: true };
  },
});

/**
 * Conversion to a connected client — an explicit authorization step by
 * a member. Creates the client record (bound to the requester's email
 * for future portal identity verification) and marks the booking
 * converted. The booking itself never granted any access; the new
 * client still gets nothing beyond ordinary client onboarding.
 */
export const convertToClient = mutation({
  args: {
    consultationId: v.id("consultations"),
    kind: v.union(
      v.literal("individual"),
      v.literal("company"),
      v.literal("trust"),
      v.literal("government"),
    ),
    city: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "client.create");
    const c = await getScoped(ctx, ac, args.consultationId);
    if (c.connectedClientId) {
      return { clientId: c.connectedClientId, already: true };
    }
    if (!c.clientEmail) {
      throw new Error(
        "The requester left no email — collect one before converting to a client record.",
      );
    }
    const email = c.clientEmail.toLowerCase();
    // Conflict-check by email within the organization.
    const existing = await ctx.db
      .query("clients")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const match = existing.find(
      (x) => (x.email ?? "").toLowerCase() === email && x.archivedAt === undefined,
    );
    let clientId: Id<"clients">;
    if (match) {
      clientId = match._id;
    } else {
      clientId = await ctx.db.insert("clients", {
        orgId: ac.org._id,
        kind: args.kind,
        name: c.clientName,
        email: c.clientEmail,
        phone: args.phone?.trim() || c.clientPhone || undefined,
        city: args.city?.trim() || undefined,
        responsibleLawyerId: c.advocateUserId ?? ac.user._id,
        createdBy: ac.user._id,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(c._id, {
      connectedClientId: clientId,
      updatedAt: Date.now(),
      history: cleanHistory(
        c.history,
        `Converted to a connected client by ${ac.user.name ?? "the chamber"} — portal access remains gated on identity verification and explicit grants.`,
      ),
    });
    return { clientId, already: false };
  },
});

// ---------------------------------------------------------------
// Internals
// ---------------------------------------------------------------

async function getScoped(
  ctx: MutationCtx,
  ac: { org: { _id: Id<"organizations"> } },
  consultationId: Id<"consultations">,
): Promise<Doc<"consultations">> {
  const c = await ctx.db.get(consultationId);
  if (!c || c.orgId !== ac.org._id) throw new Error("Consultation not found.");
  return c;
}

/** Notify advocate & billing members about a fresh public request. */
export const notifyNewRequest = internalMutation({
  args: { consultationId: v.id("consultations") },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.consultationId);
    if (!c || c.source !== "public") return;
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", c.orgId))
      .collect();
    const targets = members.filter(
      (m) => m.status === "active" && (m.userId === c.advocateUserId || m.orgRole === "owner"),
    );
    const chosen = targets.length > 0 ? targets : members.filter((m) => m.status === "active");
    for (const m of chosen.slice(0, 5)) {
      await ctx.runMutation(internal.notifications.createInternal, {
        orgId: c.orgId,
        userId: m.userId,
        kind: "message",
        title: `New consultation request — ${c.clientName}`,
        body: c.matterSummary?.slice(0, 200) ?? "A public visitor requested a consultation.",
        linkTo: "/billing",
        dedupeKey: `consult_request:${c._id}:${m.userId}`,
      });
    }
  },
});

/** Status notification to the requester (email when configured). */
export const notifyRequesterInternal = internalMutation({
  args: { consultationId: v.id("consultations"), text: v.string() },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.consultationId);
    if (!c || !c.clientEmail) return;
    const org = await ctx.db.get(c.orgId);
    const advocate = c.advocateUserId ? await ctx.db.get(c.advocateUserId) : null;
    await ctx.scheduler
      .runAfter(
      0,
      api.notify.sendEmail,
      {
        orgId: c.orgId,
        to: c.clientEmail,
        category: "consultation_status",
        subject: `Consultation ${c.reference ?? ""} — update`,
        title: `Consultation update — ${org?.name ?? "the chamber"}`,
        bodyHtml: `<p>${escapeHtml(args.text)}</p><p>Reference: <strong>${escapeHtml(c.reference ?? "")}</strong><br/>Advocate: ${escapeHtml(advocate?.name ?? "—")}</p>`,
        footerNote: "Booking a consultation does not create a client relationship or grant access to case files.",
      },
      )
      .catch(() => {
        // Email is best-effort; the status trail on the booking is the
        // source of truth and the requester can always look it up.
      });
  },
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
