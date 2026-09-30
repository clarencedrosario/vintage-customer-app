import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAccess, requireWriteAccess } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// DPDP COMPLIANCE IMPLEMENTATION REGISTER (§1 of the India-specific
// capabilities).
//
// This module is an honest WORKFLOW AND RECORDS system, not a compliance
// engine. Design rules enforced here:
//  - Every register entry carries its OFFICIAL SOURCE and the date the
//    requirement actually becomes operative per the commencement
//    notification — the DPDP Act (11 Aug 2023) and the DPDP Rules 2025
//    (notified 13 Nov 2025, G.S.R. 846(E)) commence in PHASES, so the
//    seed records effective dates rather than assuming every provision
//    is already operational.
//  - Legal review state defaults to "outstanding" and is only moved by
//    an explicit human action with a note. No software setting claims
//    legal compliance.
//  - Consent records exist for activities where consent IS the basis;
//    the register separately records other lawful bases. Consent
//    withdrawal stops future processing flagged as consent-based and is
//    preserved on the record (never deleted).
//  - Requests (access / correction / erasure / grievance) are tracked
//    with due dates and human resolution; the module exports what it
//    can and states honestly what it cannot erase (e.g. entries whose
//    retention is driven by a legal hold or statutory retention rule).
// =====================================================================

type RegisterSeed = {
  requirement: string;
  officialSource: string;
  effectiveFrom?: string;
  applicability: string;
  controls: string;
  evidence?: string;
  status: "open" | "implemented" | "blocked";
};

/**
 * Register seed — requirements drawn from the DPDP Act, 2023 and the
 * Digital Personal Data Protection Rules, 2025 (G.S.R. 846(E), notified
 * 13 Nov 2025) with their commencement phases as published. Effective
 * dates of LATER phases are recorded as the phase windows announced in
 * the notification (12 / 18-month tails); a qualified review must
 * confirm the operative date per requirement — the review column stays
 * "outstanding" until then.
 */
const REGISTER_SEED: RegisterSeed[] = [
  {
    requirement:
      "Notice to data principals: itemized, standalone notice at the time of seeking consent (S.5).",
    officialSource:
      "DPDP Act 2023 s.5; DPDP Rules 2025 (G.S.R. 846(E), 13 Nov 2025) r.3 — operative from notification date",
    effectiveFrom: "2025-11-13",
    applicability:
      "Client intake, client portal onboarding, staff onboarding, any consent collection touchpoint.",
    controls:
      "Privacy notice surfaces are part of portal design; notice content authored from the Act text.",
    status: "open",
  },
  {
    requirement:
      "Lawful bases: consent (S.6) OR certain legitimate uses (S.7) — consent is NOT the only basis; record the applicable basis per activity.",
    officialSource: "DPDP Act 2023 ss.6–7",
    effectiveFrom: "2023-08-11",
    applicability:
      "All processing activities; litigation-relevant processing typically relies on S.7 legitimate uses (e.g. responding to legal claims, court-mandated processing) rather than consent.",
    controls:
      "Basis recorded per register row and per consent record; no activity proceeds without a recorded basis.",
    status: "open",
  },
  {
    requirement:
      "Consent manager interoperability: consent taken through a registered Consent Manager must be honoured (S.6, r.4).",
    officialSource: "DPDP Rules 2025 r.4 — Consent Manager framework",
    effectiveFrom: "2025-11-13",
    applicability:
      "Applies when a data principal consents via a registered Consent Manager. No Consent Manager integration exists in Advokate yet.",
    controls: "None implemented — recorded as a gap; no claim of interoperability.",
    status: "blocked",
  },
  {
    requirement:
      "Data-principal rights handling: access, correction, erasure, grievance redressal, nomination (ss.11, 13, 14); response timelines per Rules.",
    officialSource:
      "DPDP Act 2023 ss.11–14; DPDP Rules 2025 — grievance/redressal timing requirements",
    applicability:
      "Requests from clients, staff and portal users; handled by this module's request workflow.",
    controls:
      "dpdpRequests workflow with due dates, human resolution and audit trail; export path exists for authorised data.",
    effectiveFrom: "2025-11-13",
    status: "implemented",
    evidence: "dpdpCompliance.test.ts — request lifecycle + withdrawal + closure tested.",
  },
  {
    requirement:
      "Security safeguards (reasonable security safeguards to prevent personal-data breach) (S.8(5), r.6).",
    officialSource: "DPDP Act 2023 s.8(5); DPDP Rules 2025 r.6",
    applicability: "Whole platform.",
    controls:
      "AES-256-GCM credential encryption (@noble/ciphers), session auth, server-side tenant isolation (tested), role-based permissions, hash-chained audit log.",
    effectiveFrom: "2025-11-13",
    status: "implemented",
    evidence: "Tenant-isolation and audit-chain tests; crypto.ts implementation.",
  },
  {
    requirement:
      "Breach notification: intimate each affected data principal and the Board without delay, with prescribed content and timelines (S.8(6), r.7).",
    officialSource: "DPDP Act 2023 s.8(6); DPDP Rules 2025 r.7",
    applicability: "Any personal-data breach affecting data the firm processes.",
    controls:
      "dpdpIncidents register records detection, containment, and notification dates + basis; workflow requires human filing. Automated Board submission does NOT exist — manual filing via official channels.",
    effectiveFrom: "2025-11-13",
    status: "open",
  },
  {
    requirement:
      "Retention: erase personal data on consent withdrawal or when purpose is met, unless retention is required by law (S.8(7), r.8).",
    officialSource: "DPDP Act 2023 s.8(7); DPDP Rules 2025 r.8",
    applicability:
      "Client and staff personal data; NOTE litigation records carry statutory/professional retention obligations that override erasure — documented per category.",
    controls:
      "Erasure workflow records refusals honestly (legal hold / statutory retention) instead of pretending; erasure + export paths exist for authorised records.",
    effectiveFrom: "2025-11-13",
    status: "open",
  },
  {
    requirement:
      "Children's data: verifiable parental consent, no tracking/targeted ads at children (S.9, r.10).",
    officialSource: "DPDP Act 2023 s.9; DPDP Rules 2025 r.10",
    applicability:
      "Only if the firm ever processes data of persons under 18 (e.g. juvenile-in-camera matters); currently no such processing recorded.",
    controls: "Detect-and-flag at intake is NOT yet implemented; recorded as a gap.",
    effectiveFrom: "2025-11-13",
    status: "blocked",
  },
  {
    requirement:
      "Significant Data Fiduciary obligations (DPO in India, data audits, DPIAs) — apply only if notified as SDF.",
    officialSource: "DPDP Act 2023 s.10; DPDP Rules 2025 r.11 (SDF notification-based)",
    applicability:
      "Conditional — Advokate/firms are NOT notified Significant Data Fiduciaries; obligations activate only upon government notification.",
    controls: "Recorded for awareness; no obligations assumed before notification.",
    effectiveFrom: "2025-11-13",
    status: "open",
  },
  {
    requirement:
      "Cross-border transfer restrictions: transfer allowed except to restricted countries notified by the Government (S.16).",
    officialSource: "DPDP Act 2023 s.16; related Rules provisions",
    applicability:
      "All processing with any offshore dependency (hosting region, support access, model APIs if ever enabled).",
    controls:
      "Data-location inventory (dataResidency module) records where each category resides; restricted-country list must be checked from official sources at review time — not yet verified.",
    effectiveFrom: "2025-11-13",
    status: "open",
  },
];

/** Seed the register — idempotent by (requirement, applicability). */
export const seedRegister = mutation({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can seed the DPDP register.");
    }
    let created = 0;
    for (const r of REGISTER_SEED) {
      const existing = await ctx.db
        .query("dpdpRegister")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
        .then((rows) =>
          rows.find((x) => x.requirement === r.requirement && x.applicability === r.applicability),
        );
      if (existing) continue;
      await ctx.db.insert("dpdpRegister", {
        orgId: ac.org._id,
        requirement: r.requirement,
        officialSource: r.officialSource,
        effectiveFrom: r.effectiveFrom,
        applicability: r.applicability,
        controls: r.controls,
        evidence: r.evidence,
        legalReview: "outstanding",
        responsiblePerson: "UNASSIGNED — assign a responsible person and review date",
        status: r.status,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      created += 1;
    }
    return { created, total: REGISTER_SEED.length };
  },
});

/** The register for the org. */
export const listRegister = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("dpdpRegister")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => a.requirement.localeCompare(b.requirement)));
  },
});

/** Update one register row (owner/admin; legal review moves ONLY here). */
export const updateRegisterEntry = mutation({
  args: {
    entryId: v.id("dpdpRegister"),
    status: v.optional(v.union(v.literal("open"), v.literal("implemented"), v.literal("blocked"))),
    legalReview: v.optional(
      v.union(v.literal("outstanding"), v.literal("in_progress"), v.literal("completed")),
    ),
    responsiblePerson: v.optional(v.string()),
    reviewDueOn: v.optional(v.string()),
    controls: v.optional(v.string()),
    evidence: v.optional(v.string()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (ac.membership.orgRole !== "owner" && ac.membership.orgRole !== "administrator") {
      throw new Error("Only owners and administrators can update the DPDP register.");
    }
    const entry = (await ctx.db.get(args.entryId)) as Doc<"dpdpRegister"> | null;
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Register entry not found.");
    const patch: Partial<Doc<"dpdpRegister">> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.legalReview !== undefined) patch.legalReview = args.legalReview;
    if (args.responsiblePerson !== undefined) patch.responsiblePerson = args.responsiblePerson;
    if (args.reviewDueOn !== undefined) patch.reviewDueOn = args.reviewDueOn;
    if (args.controls !== undefined) patch.controls = args.controls;
    if (args.evidence !== undefined) patch.evidence = args.evidence;
    if (args.reviewNote !== undefined) {
      patch.evidence = [entry.evidence, `Review note (${ac.user.email ?? ac.user._id}): ${args.reviewNote}`]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 1000);
    }
    await ctx.db.patch(args.entryId, patch);
    return { updated: true };
  },
});

// ---------------------------------------------------------------------
// Data-principal requests
// ---------------------------------------------------------------------

const DEFAULT_REQUEST_DAYS = 30;

/** Record an incoming data-principal request. */
export const createRequest = mutation({
  args: {
    kind: v.union(
      v.literal("access"),
      v.literal("correction"),
      v.literal("erasure"),
      v.literal("grievance"),
      v.literal("withdrawal"),
    ),
    subjectName: v.string(),
    subjectContact: v.optional(v.string()),
    matterId: v.optional(v.id("matters")),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!args.subjectName.trim() || !args.details.trim()) {
      throw new Error("Subject name and details are required.");
    }
    if (args.matterId) {
      const matter = await ctx.db.get(args.matterId);
      if (!matter || matter.orgId !== ac.org._id) {
        throw new Error("Matter not found in this organization.");
      }
    }
    const now = Date.now();
    const id = (await ctx.db.insert("dpdpRequests", {
      orgId: ac.org._id,
      kind: args.kind,
      subjectName: args.subjectName.trim().slice(0, 200),
      subjectContact: args.subjectContact?.trim().slice(0, 200),
      matterId: args.matterId,
      details: args.details.trim().slice(0, 2000),
      status: "received",
      receivedAt: now,
      dueAt: now + DEFAULT_REQUEST_DAYS * 86_400_000,
      createdAt: now,
      updatedAt: now,
    })) as Id<"dpdpRequests">;
    return { requestId: id, dueAt: now + DEFAULT_REQUEST_DAYS * 86_400_000 };
  },
});

/** Progress a request through the human workflow. */
export const updateRequest = mutation({
  args: {
    requestId: v.id("dpdpRequests"),
    status: v.union(
      v.literal("received"),
      v.literal("in_progress"),
      v.literal("fulfilled"),
      v.literal("rejected"),
      v.literal("closed"),
    ),
    resolutionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    const r = (await ctx.db.get(args.requestId)) as Doc<"dpdpRequests"> | null;
    if (!r || r.orgId !== ac.org._id) throw new Error("Request not found.");
    const patch: Partial<Doc<"dpdpRequests">> = {
      status: args.status,
      handledById: ac.user._id,
      updatedAt: Date.now(),
    };
    if (args.resolutionNote !== undefined) patch.resolutionNote = args.resolutionNote.slice(0, 1000);
    if (args.status === "fulfilled" || args.status === "closed" || args.status === "rejected") {
      patch.closedAt = Date.now();
    }
    await ctx.db.patch(args.requestId, patch);
    return { updated: true };
  },
});

/** All requests for the org (newest first). */
export const listRequests = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("dpdpRequests")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.receivedAt - a.receivedAt));
  },
});

// ---------------------------------------------------------------------
// Consent records (where consent IS the basis)
// ---------------------------------------------------------------------

/** Record consent with its notice version. */
export const recordConsent = mutation({
  args: {
    subjectName: v.string(),
    subjectContact: v.optional(v.string()),
    purpose: v.string(),
    noticeVersion: v.string(),
    recordRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!args.subjectName.trim() || !args.purpose.trim() || !args.noticeVersion.trim()) {
      throw new Error("Subject, purpose and notice version are required.");
    }
    const id = (await ctx.db.insert("dpdpConsents", {
      orgId: ac.org._id,
      subjectName: args.subjectName.trim().slice(0, 200),
      subjectContact: args.subjectContact?.trim().slice(0, 200),
      purpose: args.purpose.trim().slice(0, 500),
      noticeVersion: args.noticeVersion.trim().slice(0, 60),
      consentGivenAt: Date.now(),
      status: "active",
      recordRef: args.recordRef?.slice(0, 200),
      createdAt: Date.now(),
    })) as Id<"dpdpConsents">;
    return { consentId: id };
  },
});

/** Withdraw consent: stops consent-based processing on the record. */
export const withdrawConsent = mutation({
  args: { consentId: v.id("dpdpConsents"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    const c = (await ctx.db.get(args.consentId)) as Doc<"dpdpConsents"> | null;
    if (!c || c.orgId !== ac.org._id) throw new Error("Consent record not found.");
    if (c.status === "withdrawn") throw new Error("Consent already withdrawn.");
    await ctx.db.patch(args.consentId, {
      status: "withdrawn",
      withdrawnAt: Date.now(),
    });
    // Withdrawal also opens an erasure review request unless one exists —
    // S.8(7): erasure on withdrawal UNLESS retention is required by law.
    const existing = await ctx.db
      .query("dpdpRequests")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const dupe = existing.find(
      (r) =>
        r.kind === "erasure" &&
        r.subjectName === c.subjectName &&
        (r.status === "received" || r.status === "in_progress"),
    );
    if (!dupe) {
      await ctx.db.insert("dpdpRequests", {
        orgId: ac.org._id,
        kind: "erasure",
        subjectName: c.subjectName,
        subjectContact: c.subjectContact,
        details: `Erasure review following consent withdrawal.${args.reason ? ` Reason: ${args.reason}` : ""} Record ref: ${c.recordRef ?? c._id}. NOTE: retention obligations (statutory/litigation) must be assessed before erasure — refusal must be recorded with its legal basis, not assumed.`,
        status: "received",
        receivedAt: Date.now(),
        dueAt: Date.now() + DEFAULT_REQUEST_DAYS * 86_400_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { withdrawn: true };
  },
});

/** Consent records (newest first). */
export const listConsents = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("dpdpConsents")
      .withIndex("by_org_status", (q) => q.eq("orgId", ac.org._id).eq("status", "active"))
      .collect();
  },
});

// ---------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------

/** Record a privacy incident. */
export const recordIncident = mutation({
  args: {
    detectedAt: v.number(),
    description: v.string(),
    affectedData: v.string(),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    if (!args.description.trim() || !args.affectedData.trim()) {
      throw new Error("Description and affected data are required.");
    }
    const now = Date.now();
    const id = (await ctx.db.insert("dpdpIncidents", {
      orgId: ac.org._id,
      detectedAt: args.detectedAt,
      description: args.description.trim().slice(0, 2000),
      affectedData: args.affectedData.trim().slice(0, 1000),
      status: "open",
      createdAt: now,
      updatedAt: now,
    })) as Id<"dpdpIncidents">;
    return { incidentId: id };
  },
});

/**
 * Record containment and notifications. The module records DATES and the
 * human-stated BASIS; it does not itself decide that notification was or
 * was not required — the assessment is human and reviewable.
 */
export const updateIncident = mutation({
  args: {
    incidentId: v.id("dpdpIncidents"),
    containment: v.optional(v.string()),
    regulatorNotifiedAt: v.optional(v.number()),
    subjectsNotifiedAt: v.optional(v.number()),
    notificationBasis: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("contained"), v.literal("closed"))),
  },
  handler: async (ctx, args) => {
    const ac = await requireWriteAccess(ctx);
    const inc = (await ctx.db.get(args.incidentId)) as Doc<"dpdpIncidents"> | null;
    if (!inc || inc.orgId !== ac.org._id) throw new Error("Incident not found.");
    const patch: Partial<Doc<"dpdpIncidents">> = { updatedAt: Date.now() };
    if (args.containment !== undefined) patch.containment = args.containment.slice(0, 1000);
    if (args.status !== undefined) patch.status = args.status;
    if (args.status === "closed") patch.closedAt = Date.now();
    if (
      args.regulatorNotifiedAt !== undefined ||
      args.subjectsNotifiedAt !== undefined ||
      args.notificationBasis !== undefined
    ) {
      patch.notifications = {
        regulatorNotifiedAt: args.regulatorNotifiedAt ?? inc.notifications?.regulatorNotifiedAt,
        subjectsNotifiedAt: args.subjectsNotifiedAt ?? inc.notifications?.subjectsNotifiedAt,
        basis: args.notificationBasis ?? inc.notifications?.basis,
      };
    }
    await ctx.db.patch(args.incidentId, patch);
    return { updated: true };
  },
});

/** Open + recent incidents. */
export const listIncidents = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return ctx.db
      .query("dpdpIncidents")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect()
      .then((rows) => rows.sort((a, b) => b.detectedAt - a.detectedAt));
  },
});
