// ---------------------------------------------------------------------
// Client intake & matter opening (Feature 4).
//
// Staged intake (identity/contact → party details → matter → parties
// involved → conflict → KYC → referral → fees → engagement → risk →
// team → review) with draft saving. Client and matter records are
// created EXACTLY ONCE at approval — guarded by createdClientId /
// createdMatterId and the pure state machine in lib/intakeFlow.ts.
//
// Secure client completion: an expiring invitation (hashed with a
// per-intake salt, same hashing as staff/client invites) lets the
// client fill the intake; an EXISTING client's account must
// authenticate (sign-in verified server-side) to touch a sensitive
// intake. Duplicate-client prevention reuses the conflict module's
// normalizers; the Feature-3 gate is enforced at approval.
// ---------------------------------------------------------------------

import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { can, getAccessContext, requireAccess } from "./access";
import { getCurrentUser } from "./users";
import {
  INTAKE_STATE_LABELS,
  canTransitionIntake,
  engagementIsAccepted,
  findDuplicateClients,
  intakeApprovalBlocker,
  intakeInvitationBlocker,
  intakeInvitationExpiry,
  intakeMissingRequiredFields,
  intakeCreationAlreadyDone,
  kycChecklist,
  mayEditIntake,
  type DuplicateCandidate,
  type DuplicateHit,
  type IntakeClientKind,
  type IntakeFormData,
  type IntakeMatterKind,
  type IntakeStage,
  type IntakeState,
  type IntakeUrgency,
} from "../lib/intakeFlow";
import {
  invitationTokenHash,
  freshInviteSalt,
} from "../lib/invitationFlow";
import { normalizeEmail, normalizePhone } from "../lib/conflictFlow";
import { openingGate } from "./conflicts";
import { nextMatterReference } from "./matters";

const now = () => Date.now();

async function logAudit(
  ctx: { db: MutationCtx["db"] },
  orgId: Id<"organizations">,
  actorId: Id<"users">,
  actorName: string,
  action: string,
  intakeId: Id<"intakes">,
  detail?: string,
) {
  await ctx.db.insert("auditLog", {
    orgId,
    actorId,
    actorName,
    action,
    detail: detail ?? `Intake ${intakeId}`,
    createdAt: now(),
  });
}

const actorName = (u: Doc<"users">) => u.name ?? u.email ?? "Member";



// ---------------------------------------------------------------------
// Firm-side register
// ---------------------------------------------------------------------

/** Intake register for the org (matter.create / client.view_all). */
export const register = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return [];
    return ctx.db
      .query("intakes")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt));
  },
});

/** One intake for a firm-side viewer. */
export const get = query({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) return null;
    if (!can(ac, "matter.create") && !can(ac, "client.view_all")) return null;
    return row;
  },
});

// ---------------------------------------------------------------------
// Firm-side lifecycle: create draft, save, submit, cancel
// ---------------------------------------------------------------------

/** Start a new intake (client.edit or matter.create holders). */
export const startIntake = mutation({
  args: {
    clientMode: v.union(v.literal("new_client"), v.literal("existing_client")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error(
        "Your role is not permitted to begin a client intake.",
      );
    }
    const t = now();
    const intakeId = await ctx.db.insert("intakes", {
      orgId: ac.org._id,
      state: "draft",
      form: {},
      prospectiveName: "",
      clientMode: args.clientMode,
      createdById: ac.user._id,
      createdByName: actorName(ac.user),
      lastEditedById: ac.user._id,
      lastEditedByName: actorName(ac.user),
      createdAt: t,
      updatedAt: t,
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Client intake started",
      intakeId,
      `Started as ${args.clientMode === "existing_client" ? "an existing client" : "a new client"}.`,
    );
    return intakeId;
  },
});

type SaveArgs = {
  intakeId: Id<"intakes">;
  form?: IntakeFormData;
  prospectiveName?: string;
  prospectiveEmail?: string;
  prospectivePhone?: string;
  prospectiveIdentityNo?: string;
};

/**
 * Who the edit is attributed to. Firm-side edits carry the acting
 * user; completion-link edits are attributed to the prospective
 * client by the link's email, with the firm-side creator recorded as
 * a traceable stand-in id (no user row exists yet for a new client).
 */
type EditorScope = {
  orgId: Id<"organizations">;
  editorId: Id<"users">;
  editorName: string;
};

async function saveDraftCore(
  ctx: MutationCtx,
  scope: EditorScope,
  args: SaveArgs,
) {
  const row = await ctx.db.get(args.intakeId);
  if (!row || row.orgId !== scope.orgId) {
    throw new Error("Intake not found in your organization.");
  }
  if (!mayEditIntake(row.state)) {
    throw new Error(
      `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} and can no longer be edited.`,
    );
  }

  const form: IntakeFormData = { ...((row.form as IntakeFormData) ?? {}), ...(args.form ?? {}) };

  // Engagement acceptance is decided ONLY by the signature events below
  // (acceptEngagement / unacceptEngagement); a saved flag can never
  // forge acceptance.
  if (form.engagementAccepted === true) {
    const prior = (row.form as IntakeFormData) ?? {};
    if (!engagementIsAccepted(prior)) {
      form.engagementAccepted = undefined;
    }
  }

  // Normalized prospective identity for duplicate prevention.
  const email = (args.prospectiveEmail ?? form.email ?? row.prospectiveEmail ?? "")
    .trim()
    .toLowerCase();
  const phone = (
    args.prospectivePhone ??
    form.phone ??
    row.prospectivePhone ??
    ""
  ).trim();
  const identityNo = (
    args.prospectiveIdentityNo ??
    form.organisationRegistrationNo ??
    row.prospectiveIdentityNo ??
    ""
  ).trim();

  const duplicateHits = findDuplicateClients(
    {
      kind: (form.clientKind ?? "individual") as IntakeClientKind,
      name: args.prospectiveName ?? form.fullName ?? row.prospectiveName,
      email: email || null,
      phone: phone || null,
      identityNo: identityNo || null,
    },
    (
      await ctx.db
        .query("clients")
        .withIndex("by_org", (q) => q.eq("orgId", scope.orgId))
        .collect()
    ).map((c) => ({
      key: c._id,
      kind: c.kind as IntakeClientKind,
      name: c.name,
      email: c.email ?? null,
      phone: c.phone ?? null,
      identityNo: c.gstin ?? null,
    })),
  );

  await ctx.db.patch(args.intakeId, {
    form,
    prospectiveName: (args.prospectiveName ?? form.fullName ?? row.prospectiveName ?? "").trim(),
    prospectiveEmail: email || undefined,
    prospectivePhone: phone || undefined,
    prospectiveIdentityNo: identityNo || undefined,
    duplicateHits: duplicateHits as unknown as Array<Record<string, unknown>>,
    lastEditedById: scope.editorId,
    lastEditedByName: scope.editorName,
    updatedAt: now(),
  });

  return duplicateHits;
}

/** Save (draft) — firm staff with the intake capability. */
export const saveDraft = mutation({
  args: {
    intakeId: v.id("intakes"),
    form: v.optional(v.any()),
    prospectiveName: v.optional(v.string()),
    prospectiveEmail: v.optional(v.string()),
    prospectivePhone: v.optional(v.string()),
    prospectiveIdentityNo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to edit this intake.");
    }
    return await saveDraftCore(
      ctx,
      { orgId: ac.org._id, editorId: ac.user._id, editorName: actorName(ac.user) },
      args,
    );
  },
});

/** Client-side draft save — requires an authenticated client session. */
export const clientSaveDraft = mutation({
  args: {
    intakeId: v.id("intakes"),
    form: v.optional(v.any()),
    prospectiveName: v.optional(v.string()),
    prospectiveEmail: v.optional(v.string()),
    prospectivePhone: v.optional(v.string()),
    prospectiveIdentityNo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in to complete this intake.");
    if (user.isAnonymous) {
      throw new Error("Sign in with your own account to complete this intake.");
    }
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You no longer have access to this intake.");
    return await saveDraftCore(
      ctx,
      { orgId: ac.org._id, editorId: user._id, editorName: actorName(user) },
      args,
    );
  },
});

/** Submit for review — validates required fields. */
async function submitCore(ctx: MutationCtx, ac: Parameters<typeof requireAccess> extends never ? never : Awaited<ReturnType<typeof getAccessContext>> & { user: Doc<"users"> }, args: { intakeId: Id<"intakes"> }) {
  const row = await ctx.db.get(args.intakeId);
  if (!row || row.orgId !== ac.org._id) {
    throw new Error("Intake not found in your organization.");
  }
  const next = canTransitionIntake(row.state, "submit");
  if (!next) {
    throw new Error(
      `This intake cannot be submitted from its current state (${INTAKE_STATE_LABELS[row.state]}).`,
    );
  }
  const form = (row.form as IntakeFormData) ?? {};
  const missing = intakeMissingRequiredFields(form);
  if (missing.length > 0) {
    throw new Error(
      `Intake is incomplete: ${missing
        .slice(0, 4)
        .map((m) => m.label)
        .join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`,
    );
  }
  await ctx.db.patch(args.intakeId, {
    state: next,
    lastEditedById: ac.user._id,
    lastEditedByName: actorName(ac.user),
    updatedAt: now(),
  });
  await logAudit(
    ctx,
    ac.org._id,
    ac.user._id,
    actorName(ac.user),
    "Client intake submitted",
    args.intakeId,
  );
}

/** Firm-side submit. */
export const submit = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to submit this intake.");
    }
    await submitCore(ctx, ac, args);
  },
});

/** Client-side submit (portal). */
export const clientSubmit = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in to complete this intake.");
    if (user.isAnonymous) {
      throw new Error("Sign in with your own account to complete this intake.");
    }
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You no longer have access to this intake.");
    await submitCore(ctx, { ...ac, user }, args);
  },
});

/** Cancel a not-yet-decided intake. */
export const cancel = mutation({
  args: {
    intakeId: v.id("intakes"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to cancel this intake.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    const next = canTransitionIntake(row.state, "cancel");
    if (!next) {
      throw new Error(
        `This intake cannot be cancelled from its current state (${INTAKE_STATE_LABELS[row.state]}).`,
      );
    }
    await ctx.db.patch(args.intakeId, {
      state: next,
      reviewNote: args.reason?.trim().slice(0, 2000) || row.reviewNote,
      reviewedById: ac.user._id,
      reviewedByName: actorName(ac.user),
      reviewedAt: now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Client intake cancelled",
      args.intakeId,
      args.reason?.trim().slice(0, 200) || undefined,
    );
  },
});

// ---------------------------------------------------------------------
// Review: return for correction, reject, approve (exactly-once creation)
// ---------------------------------------------------------------------

/**
 * Return a submitted intake to the client / originating staff for
 * correction. The correction note is mandatory.
 */
export const returnForCorrection = mutation({
  args: { intakeId: v.id("intakes"), note: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to review intakes.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    const next = canTransitionIntake(row.state, "return_for_correction");
    if (!next) {
      throw new Error(
        `Only a submitted intake can be returned for correction (current state: ${INTAKE_STATE_LABELS[row.state]}).`,
      );
    }
    const note = args.note.trim();
    if (note.length < 5) {
      throw new Error("Tell the client what needs correcting (at least 5 characters).");
    }
    await ctx.db.patch(args.intakeId, {
      state: next,
      reviewNote: note.slice(0, 2000),
      reviewedById: ac.user._id,
      reviewedByName: actorName(ac.user),
      reviewedAt: now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Intake returned for correction",
      args.intakeId,
      note.slice(0, 200),
    );
  },
});

/** Reject an intake outright. */
export const reject = mutation({
  args: { intakeId: v.id("intakes"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to review intakes.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    const next = canTransitionIntake(row.state, "reject");
    if (!next) {
      throw new Error(
        `Only a submitted intake can be rejected (current state: ${INTAKE_STATE_LABELS[row.state]}).`,
      );
    }
    const reason = args.reason.trim();
    if (reason.length < 5) {
      throw new Error("Give a reason for rejecting this intake (at least 5 characters).");
    }
    await ctx.db.patch(args.intakeId, {
      state: next,
      reviewNote: reason.slice(0, 2000),
      reviewedById: ac.user._id,
      reviewedByName: actorName(ac.user),
      reviewedAt: now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Intake rejected",
      args.intakeId,
      reason.slice(0, 200),
    );
  },
});

/** Acknowledge duplicates after human review (definite hits must be acknowledged). */
export const acknowledgeDuplicates = mutation({
  args: { intakeId: v.id("intakes"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to review intakes.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    await ctx.db.patch(args.intakeId, {
      duplicatesAcknowledged: true,
      duplicatesAcknowledgeById: ac.user._id,
      duplicatesAcknowledgeByName: actorName(ac.user),
      duplicatesAcknowledgeAt: now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Duplicate warning acknowledged",
      args.intakeId,
      args.note?.trim().slice(0, 200) || undefined,
    );
  },
});

/**
 * Approve the intake: create the client and matter EXACTLY ONCE.
 *
 * Order of enforcement (each aborts before any record is created):
 *   1. state machine — only a submitted intake can be approved;
 *   2. capability — approver must hold matter.create;
 *   3. conflict gate — a cleared check for the proposed client
 *      (Feature 3) must be attached; openingGate validates it;
 *   4. required fields + KYC + unsigned-engagement refusal;
 *   5. duplicate guard — definite duplicates must be acknowledged;
 *   6. idempotency — if createdClientId/createdMatterId already exist,
 *      return them without creating anything.
 */
export const approve = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    const form = (row.form as IntakeFormData) ?? {};

    // Exactly-once: if creation already happened, report it (idempotent).
    if (intakeCreationAlreadyDone(row)) {
      return { clientId: row.createdClientId!, matterId: row.createdMatterId! };
    }

    const blocker = intakeApprovalBlocker({
      state: row.state,
      form,
      conflictCheckId: row.conflictCheckId ?? null,
      approverCanCreateMatters: can(ac, "matter.create"),
    });
    if (blocker) throw new Error(blocker);

    // Re-run the Feature-3 gate against the attached check (it may have
    // been rejected or downgraded after attachment).
    const gate = await openingGate(
      ctx,
      ac,
      form.fullName?.trim() ?? row.prospectiveName,
      form.fullName?.trim() ?? row.prospectiveName,
      row.conflictCheckId ?? undefined,
    );
    if (!gate.ok) throw new Error(gate.reason);

    const definite = (row.duplicateHits as unknown as DuplicateHit[] | undefined)?.filter(
      (h) => h?.severity === "definite",
    );
    if (definite && definite.length > 0 && row.duplicatesAcknowledged !== true) {
      throw new Error(
        "A definite duplicate was flagged for this client. Review and acknowledge it before approving.",
      );
    }

    const t = now();
    const matterKind = form.matterKind;

    // ---- Client (exactly once) ----
    const clientId =
      row.createdClientId ??
      (await ctx.db.insert("clients", {
        orgId: ac.org._id,
        kind: (form.clientKind ?? "individual") as "individual" | "company" | "trust" | "government",
        name: form.fullName!.trim(),
        email: form.email?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        addressLine1: form.addressLine1?.trim() || undefined,
        city: form.city?.trim() || undefined,
        state: form.stateName?.trim() || undefined,
        pincode: form.pincode?.trim() || undefined,
        gstin: form.organisationRegistrationNo?.trim().toUpperCase() || undefined,
        billingName: form.organisationName?.trim() || undefined,
        notes: [
          form.organisationName ? `Organisation: ${form.organisationName.trim()}` : null,
          form.authorisedRepresentative ? `Representative: ${form.authorisedRepresentative.trim()}` : null,
          form.referredBy ? `Referred by: ${form.referredBy.trim()}` : null,
          form.riskNotes ? `Risk: ${form.riskLevel} — ${form.riskNotes.trim()}` : null,
        ]
          .filter(Boolean)
          .join("\n") || undefined,
        responsibleLawyerId: (form.responsibleLawyerId as Id<"users"> | undefined) || undefined,
        createdBy: ac.user._id,
        createdAt: t,
      }));

    // ---- Matter (exactly once) ----
    const matterId =
      row.createdMatterId ??
      (await ctx.db.insert("matters", {
        orgId: ac.org._id,
        clientId,
        reference: await nextMatterReference(ctx, ac.org._id, ac.org.invoicePrefix),
        title: form.matterTitle!.trim(),
        practiceArea: form.practiceArea!.trim(),
        description: form.matterDescription?.trim() || undefined,
        status: "open" as const,
        priority:
          form.urgency === "court_deadline"
            ? ("urgent" as const)
            : form.urgency === "time_sensitive"
              ? ("high" as const)
              : ("normal" as const),
        court: form.court?.trim() || undefined,
        caseNumber: form.caseNumber?.trim() || undefined,
        opposingParty: form.adverseParties?.length
          ? form.adverseParties[0]!.trim() || undefined
          : undefined,
        opposingCounsel: form.opposingCounsel?.trim() || undefined,
        billingArrangement: [form.feeType, form.feeNotes?.trim()]
          .filter(Boolean)
          .join(" — ") || undefined,
        keyDates:
          form.deadlineDate
            ? [{ label: "Intake deadline", date: form.deadlineDate }]
            : undefined,
        teamIds: (form.teamIds as Id<"users">[] | undefined)?.length
          ? (form.teamIds as Id<"users">[])
          : undefined,
        leadLawyerId: (form.responsibleLawyerId as Id<"users"> | undefined) || undefined,
        conflictCheckId: gate.conflictId,
        createdBy: ac.user._id,
        createdAt: t,
        updatedAt: t,
      }));

    await ctx.db.patch(args.intakeId, {
      state: "approved",
      createdClientId: clientId,
      createdMatterId: matterId,
      approvedById: ac.user._id,
      approvedByName: actorName(ac.user),
      approvedAt: t,
      reviewedById: ac.user._id,
      reviewedByName: actorName(ac.user),
      reviewedAt: t,
      reviewNote: row.reviewNote ?? "Approved — client and matter opened.",
      updatedAt: t,
    });

    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Intake approved — client and matter opened",
      args.intakeId,
      `${form.matterTitle!.trim()} — matter kind: ${matterKind}.`,
    );

    return { clientId, matterId };
  },
});

// ---------------------------------------------------------------------
// Secure client completion — expiring invitations + authentication
// ---------------------------------------------------------------------

/**
 * Create an expiring completion invitation for a staged intake.
 * The raw token is returned ONCE (never stored); only its salted hash
 * is kept, as with staff/client invitations.
 */
export const createCompletionInvite = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to invite clients.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} — a completion link can no longer be issued.`,
      );
    }
    const form = (row.form as IntakeFormData) ?? {};
    const email = form.email?.trim().toLowerCase();
    if (!email) throw new Error("Record the client's email before inviting them to complete the intake.");

    const token = freshInviteSalt() + freshInviteSalt() + freshInviteSalt();
    const salt = freshInviteSalt();
    await ctx.db.patch(args.intakeId, {
      invite: {
        email,
        salt,
        tokenHash: invitationTokenHash(salt, token),
        expiresAt: intakeInvitationExpiry(now()),
        createdAt: now(),
      },
      lastEditedById: ac.user._id,
      lastEditedByName: actorName(ac.user),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Intake completion link issued",
      args.intakeId,
      `Expiring link issued for ${email}.`,
    );
    return { token };
  },
});

/** Revoke a completion invitation. */
export const revokeCompletionInvite = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to manage invitations.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    if (!row.invite || row.invite.usedAt) {
      throw new Error("There is no live completion link for this intake.");
    }
    await ctx.db.patch(args.intakeId, {
      invite: { ...row.invite, revokedAt: now() },
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Intake completion link revoked",
      args.intakeId,
    );
  },
});

/**
 * Public inspection of a completion token — reports which intake it
 * opens. Existing-client intakes are withheld until the caller
 * authenticates with the invited email (sensitive intake rule).
 */
export const inspectCompletionToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db.query("intakes").collect();
    const row = rows.find(
      (r) =>
        r.invite &&
        !r.invite.usedAt &&
        !r.invite.revokedAt &&
        r.invite.tokenHash === invitationTokenHash(r.invite.salt, args.token),
    );
    if (!row) return null;
    const blocker = intakeInvitationBlocker(
      {
        usedAt: row.invite!.usedAt,
        revokedAt: row.invite!.revokedAt,
        expiresAt: row.invite!.expiresAt,
        email: row.invite!.email,
      },
      now(),
    );
    if (blocker) return null;

    // EXISTING clients must authenticate with the invited email before
    // any intake content is disclosed.
    if (row.clientMode === "existing_client") {
      if (!user || user.isAnonymous || !user.email) return null;
      if (user.email.trim().toLowerCase() !== row.invite!.email) return null;
    }

    return {
      intakeId: row._id,
      prospectiveName: row.prospectiveName,
      clientMode: row.clientMode,
      email: row.invite!.email,
    };
  },
});

/**
 * Redeem a completion token. NEW clients may redeem unauthenticated
 * (that is the point of the link). EXISTING clients must be signed in
 * as the invited email — their account already holds the relationship,
 * so the intake is bound to their verified identity, not the link.
 */
export const redeemCompletionToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db.query("intakes").collect();
    const row = rows.find(
      (r) =>
        r.invite &&
        !r.invite.usedAt &&
        !r.invite.revokedAt &&
        r.invite.tokenHash === invitationTokenHash(r.invite.salt, args.token),
    );
    if (!row) throw new Error("This completion link is not valid.");

    const blocker = intakeInvitationBlocker(
      {
        usedAt: row.invite!.usedAt,
        revokedAt: row.invite!.revokedAt,
        expiresAt: row.invite!.expiresAt,
        email: row.invite!.email,
      },
      now(),
    );
    if (blocker === "expired") throw new Error("This completion link has expired.");
    if (blocker === "revoked") throw new Error("This completion link has been revoked.");
    if (blocker === "already_used") throw new Error("This completion link has already been used.");
    if (blocker) throw new Error("This completion link is not valid.");

    if (row.clientMode === "existing_client") {
      if (!user) {
        throw new Error(
          "This intake belongs to an existing client. Sign in with the invited email to continue.",
        );
      }
      if (user.isAnonymous || !user.email) {
        throw new Error("Sign in with your own verified account to continue.");
      }
      if (user.email.trim().toLowerCase() !== row.invite!.email) {
        throw new Error(
          "This completion link was issued to a different email address.",
        );
      }
      // Linking is idempotent.
      if (row.clientUserId !== user._id) {
        await ctx.db.patch(row._id, { clientUserId: user._id });
      }
      return { intakeId: row._id };
    }

    // New client: mark the invitation used and stamp completion.
    await ctx.db.patch(row._id, {
      invite: { ...row.invite!, usedAt: now() },
      clientCompletedAt: now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      row.orgId,
      user?._id ?? row.createdById!,
      user?.name ?? user?.email ?? row.invite!.email,
      "Intake completion link redeemed",
      row._id,
      row.invite!.email,
    );
    return { intakeId: row._id };
  },
});

/**
 * Firm-side record of consent and engagement-acceptance signature.
 * consentGiven: a factual note that consent was recorded (staff cannot
 * mark the engagement accepted — only the client's own signature event
 * below can).
 */
export const recordConsent = mutation({
  args: { intakeId: v.id("intakes"), consentNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create") && !can(ac, "client.edit")) {
      throw new Error("Your role is not permitted to edit this intake.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} and can no longer be edited.`,
      );
    }
    const form = { ...((row.form as IntakeFormData) ?? {}) } as IntakeFormData;
    form.consentGiven = true;
    if (args.consentNote?.trim()) {
      form.riskNotes = [
        form.riskNotes,
        `Consent recorded: ${args.consentNote.trim()}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    await ctx.db.patch(args.intakeId, {
      form,
      lastEditedById: ac.user._id,
      lastEditedByName: actorName(ac.user),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Client consent recorded",
      args.intakeId,
      args.consentNote?.trim().slice(0, 200) || undefined,
    );
  },
});

/**
 * The client's own engagement-acceptance signature. Unsigned ≠
 * accepted: only this mutation (or the client-facing wrapper) sets
 * engagementAccepted together with engagementSignedAt.
 */
export const acceptEngagement = mutation({
  args: {
    intakeId: v.id("intakes"),
    template: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in to accept the engagement letter.");
    if (user.isAnonymous) {
      throw new Error("Sign in with your own account to accept the engagement letter.");
    }
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You no longer have access to this intake.");
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    // The client themself accepts — the account bound to the intake
    // (existing-client redemption) is the signer.
    if (row.clientUserId && row.clientUserId !== user._id) {
      throw new Error("Only the client bound to this intake can accept the engagement letter.");
    }
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} — engagement can no longer be accepted.`,
      );
    }
    const form = { ...((row.form as IntakeFormData) ?? {}) } as IntakeFormData;
    form.engagementTemplate = args.template?.trim().slice(0, 120) || form.engagementTemplate;
    form.engagementAccepted = true;
    form.engagementSignedAt = now();
    await ctx.db.patch(args.intakeId, {
      form,
      lastEditedById: user._id,
      lastEditedByName: actorName(user),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      user._id,
      actorName(user),
      "Engagement letter accepted (signed)",
      args.intakeId,
      form.engagementTemplate ? `Template: ${form.engagementTemplate}` : undefined,
    );
  },
});

/** The client withdraws a signature (still editable — starts a new one). */
export const unacceptEngagement = mutation({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Sign in first.");
    const ac = await getAccessContext(ctx);
    if (!ac) throw new Error("You no longer have access to this intake.");
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    if (row.clientUserId && row.clientUserId !== user._id) {
      throw new Error("Only the client bound to this intake can change the engagement signature.");
    }
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} — the signature can no longer be changed.`,
      );
    }
    const form = { ...((row.form as IntakeFormData) ?? {}) } as IntakeFormData;
    form.engagementAccepted = undefined;
    form.engagementSignedAt = null;
    await ctx.db.patch(args.intakeId, {
      form,
      lastEditedById: user._id,
      lastEditedByName: actorName(user),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      user._id,
      actorName(user),
      "Engagement acceptance withdrawn",
      args.intakeId,
    );
  },
});

/**
 * Attach (or re-attach) a cleared conflict check from the Feature-3
 * desk. The check must belong to this org and be cleared — this is the
 * intake-side mirror of matters.create's gate.
 */
export const attachConflictCheck = mutation({
  args: {
    intakeId: v.id("intakes"),
    conflictCheckId: v.id("conflictChecks"),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "matter.create")) {
      throw new Error("Your role is not permitted to approve intakes.");
    }
    const row = await ctx.db.get(args.intakeId);
    if (!row || row.orgId !== ac.org._id) {
      throw new Error("Intake not found in your organization.");
    }
    const check = await ctx.db.get(args.conflictCheckId);
    if (!check || check.orgId !== ac.org._id) {
      throw new Error("That conflict check belongs to a different organization.");
    }
    if (check.reviewStatus !== "cleared") {
      throw new Error("Only a cleared conflict check can be attached to an intake.");
    }
    await ctx.db.patch(args.intakeId, {
      conflictCheckId: args.conflictCheckId,
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      ac.org._id,
      ac.user._id,
      actorName(ac.user),
      "Conflict check attached to intake",
      args.intakeId,
    );
  },
});

/**
 * Record which checklist the intake requires (used by the UI) and
 * expose the pure helper through a query so pages need no re-derivation.
 */
export const intakeChecklist = query({
  args: { clientKind: v.optional(v.string()) },
  handler: async (_ctx, args) =>
    kycChecklist(
      (args.clientKind as IntakeClientKind | undefined) ?? undefined,
    ),
});

/**
 * Token-authorized intake lookup for NEW-client completion links.
 * The link works while it is live (not used, not revoked, not expired)
 * and the intake is still editable. Existing-client intakes never
 * authorize through the token alone — the caller must be the bound,
 * authenticated account (handled by the separate mutations above).
 */
async function intakeByCompletionToken(
  ctx: QueryCtx,
  token: string,
): Promise<Doc<"intakes"> | null> {
  const rows = await ctx.db.query("intakes").collect();
  for (const row of rows) {
    if (
      row.invite &&
      row.clientMode === "new_client" &&
      !row.invite.usedAt &&
      !row.invite.revokedAt &&
      now() <= row.invite.expiresAt &&
      row.invite.tokenHash === invitationTokenHash(row.invite.salt, token)
    ) {
      return row;
    }
  }
  return null;
}

/** New-client draft save through the completion link (no account yet). */
export const clientTokenSaveDraft = mutation({
  args: {
    token: v.string(),
    form: v.optional(v.any()),
    prospectiveName: v.optional(v.string()),
    prospectiveEmail: v.optional(v.string()),
    prospectivePhone: v.optional(v.string()),
    prospectiveIdentityNo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await intakeByCompletionToken(ctx, args.token);
    if (!row) throw new Error("This completion link is not valid or has expired.");
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} and can no longer be edited.`,
      );
    }
    return await saveDraftCore(
      ctx,
      {
        orgId: row.orgId,
        editorId: row.createdById!,
        editorName: `Client (via completion link) — ${row.invite?.email ?? "unknown"}`,
      },
      {
        intakeId: row._id,
        form: args.form,
        prospectiveName: args.prospectiveName,
        prospectiveEmail: args.prospectiveEmail,
        prospectivePhone: args.prospectivePhone,
        prospectiveIdentityNo: args.prospectiveIdentityNo,
      },
    );
  },
});

/**
 * New-client submit through the completion link: validates required
 * fields, flips the state to submitted and burns the link (single use).
 */
export const clientTokenSubmit = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await intakeByCompletionToken(ctx, args.token);
    if (!row) throw new Error("This completion link is not valid or has expired.");
    const next = canTransitionIntake(row.state, "submit");
    if (!next) {
      throw new Error(
        `This intake cannot be submitted from its current state (${INTAKE_STATE_LABELS[row.state]}).`,
      );
    }
    const form = (row.form as IntakeFormData) ?? {};
    const missing = intakeMissingRequiredFields(form);
    if (missing.length > 0) {
      throw new Error(
        `Intake is incomplete: ${missing
          .slice(0, 4)
          .map((m) => m.label)
          .join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`,
      );
    }
    const t = now();
    await ctx.db.patch(row._id, {
      state: next,
      invite: row.invite ? { ...row.invite, usedAt: t } : undefined,
      clientCompletedAt: t,
      updatedAt: t,
    });
    await logAudit(
      ctx,
      row.orgId,
      row.createdById!,
      row.createdByName ?? row.invite?.email ?? "Client",
      "Client intake submitted (completion link)",
      row._id,
      row.invite?.email,
    );
  },
});

/** New-client engagement signature through the completion link. */
export const clientTokenAcceptEngagement = mutation({
  args: { token: v.string(), template: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await intakeByCompletionToken(ctx, args.token);
    if (!row) throw new Error("This completion link is not valid or has expired.");
    if (!mayEditIntake(row.state)) {
      throw new Error(
        `This intake is ${INTAKE_STATE_LABELS[row.state].toLowerCase()} — engagement can no longer be accepted.`,
      );
    }
    const form = { ...((row.form as IntakeFormData) ?? {}) } as IntakeFormData;
    form.engagementTemplate =
      args.template?.trim().slice(0, 120) || form.engagementTemplate;
    form.engagementAccepted = true;
    form.engagementSignedAt = now();
    await ctx.db.patch(row._id, {
      form,
      clientCompletedAt: row.clientCompletedAt ?? now(),
      updatedAt: now(),
    });
    await logAudit(
      ctx,
      row.orgId,
      row.createdById!,
      row.invite?.email ?? "Client (completion link)",
      "Engagement letter accepted (signed via completion link)",
      row._id,
    );
  },
});

// ---------------------------------------------------------------------
// Portal access for the bound client account
// ---------------------------------------------------------------------

/**
 * The intakes the signed-in client may see: those bound to their
 * account (existing-client redemption) or completed via their link.
 * Contents are org-scoped by construction; access does not survive
 * redemption of a revoked/expired link.
 */
export const myIntakes = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return [];
    const rows = await ctx.db.query("intakes").collect();
    return rows
      .filter(
        (r) =>
          r.clientUserId === user._id ||
          (r.createdById === user._id && r.clientMode === "new_client"),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Client-side read of one intake — the bound client account only.
 * Sensitive intake data is never exposed to anyone else.
 */
export const getForClient = query({
  args: { intakeId: v.id("intakes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user || user.isAnonymous) return null;
    const row = await ctx.db.get(args.intakeId);
    if (!row) return null;
    if (row.clientUserId !== user._id && !(row.createdById === user._id && row.clientMode === "new_client")) {
      return null;
    }
    return row;
  },
});
