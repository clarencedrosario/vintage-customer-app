import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { requireAccess, requireCapability, getAccessContext } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

// =====================================================================
// §32 PHASE 3 — MATTER-IMPACT ALERTS (legal changes affecting active
// matters). OPT-IN per matter: only matters whose legalProfile carries
// impactAlerts:true are ever alerted — no firm-wide silent watching.
//
// The evaluator reuses the ingestion-run state machine (legalIntel):
// when a run CLOSES with outcome "updated" (a new legalSourceVersion is
// now latest), matters that anchor that source get ONE alert per
// matter+source+version (dedupeKey `matter:stableKey:version` —
// re-running is idempotent). A LATER version re-alerts under a bumped
// key; the earlier alert is marked superseded, its recorded actions
// preserved. Corrections are therefore never silent.
//
// TREATMENT: a treatment label is reported ONLY together with its
// treatmentSourceKey (same structural rule as adverseAuthority).
// A label without a supporting source is WITHHELD as an alerting event
// and recorded only as a reference note stating why nothing was alerted.
//
// Every alert is a lawyer-review item: acknowledge (with note),
// dismiss (with reason), assign, or convert to a task through the
// EXISTING taskSuggestions propose→approve flow — nothing is created
// without explicit lawyer approval. Coverage disclosure: alerts reflect
// the ingested corpus only; no alerts does NOT mean the law has not
// moved.
// =====================================================================

const CAPABILITY_NOTE =
  "Alerts reflect the ingested corpus only — sources that were never ingested are invisible, and no alerts does NOT mean the law has not moved.";

/** Does the matter opt in to impact alerts? */
function alertsEnabled(matter: Doc<"matters">): boolean {
  return matter.legalProfile?.impactAlerts === true;
}

/**
 * Internal evaluator: called when an ingestion run closes with a new
 * latest version (or when a sourced treatment is recorded on a source).
 * Finds opted-in, active matters whose legal profile anchors the source
 * and creates/re-alerts one alert per matter+version.
 *
 * Dedupe/re-alert semantics:
 *  - key `matter:stableKey:version` exists → no-op (idempotent re-run)
 *  - key with an EARLIER version exists → new alert, old one superseded
 */
export const evaluateSourceUpdate = internalMutation({
  args: {
    stableKey: v.string(),
    newVersionId: v.id("legalSourceVersions"),
    runId: v.optional(v.id("ingestionRuns")),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db
      .query("legalSources")
      .withIndex("by_stable_key", (q) => q.eq("stableKey", args.stableKey))
      .unique();
    if (!source) return { alerted: 0, reason: "source-missing" as const };
    const version = await ctx.db.get(args.newVersionId);
    if (!version) return { alerted: 0, reason: "version-missing" as const };

    // The truthful "previous version" is the newest OTHER version row of
    // the SAME source (by version number) — NOT the matter's alert
    // history: a matter that joins (opts in) between two source versions
    // has no prior alert, yet the source still moved (e.g. v1→v2) and the
    // alert should say so. Undefined = previous version unknown (honest).
    const priorVersionRow = (
      await ctx.db
        .query("legalSourceVersions")
        .withIndex("by_source", (q) => q.eq("sourceId", source._id))
        .collect()
    )
      .filter((row) => row._id !== version._id && row.version < version.version)
      .sort((a, b) => b.version - a.version)[0];

    // Treatment is reported ONLY when a supporting source exists.
    const treatmentSupported = !!(source.treatment && source.treatmentSourceKey);
    const withheldNote =
      source.treatment && !treatmentSupported
        ? `The corpus carries a treatment label ("${source.treatment}") WITHOUT a supporting source. It is withheld: treatment claims require sources, so this generated NO alert.`
        : undefined;

    // Opted-in, active matters that anchor this stableKey.
    const matters = (await ctx.db.query("matters").collect()).filter(
      (m) =>
        m.status !== "closed" &&
        alertsEnabled(m) &&
        (m.legalProfile?.anchoredSourceKeys ?? []).includes(args.stableKey),
    );

    let alerted = 0;
    for (const m of matters) {
      const dedupeKey = `${m._id}:${args.stableKey}:${version.version}`;
      const existing = await ctx.db
        .query("matterImpactAlerts")
        .withIndex("by_dedupe", (q) =>
          q.eq("matterId", m._id).eq("dedupeKey", dedupeKey),
        )
        .collect();
      if (existing.length > 0) continue; // idempotent re-run

      // Find the most recent alert for this matter+source (any version).
      const prior = (
        await ctx.db
          .query("matterImpactAlerts")
          .withIndex("by_matter_status", (q) => q.eq("matterId", m._id))
          .collect()
      )
        .filter((a) => a.stableKey === args.stableKey)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      const now = Date.now();
      await ctx.db.insert("matterImpactAlerts", {
        orgId: m.orgId,
        matterId: m._id,
        dedupeKey,
        stableKey: args.stableKey,
        sourceTitle: source.title,
        fromVersion: priorVersionRow?.version,
        toVersion: version.version,
        treatment: treatmentSupported ? source.treatment! : undefined,
        treatmentSourceKey: treatmentSupported
          ? source.treatmentSourceKey!
          : undefined,
        withheldTreatmentNote: withheldNote,
        sourceUrl: source.sourceUrl,
        status: "open",
        reason: `Matter profile anchors ${args.stableKey}; a newer version (v${version.version}) is now the latest in the ingested corpus.`,
        supersedesId: prior?._id,
        runId: args.runId,
        createdAt: now,
        updatedAt: now,
      });
      if (prior && prior.status === "open") {
        await ctx.db.patch(prior._id, {
          status: "superseded",
          updatedAt: now,
        });
      }
      alerted += 1;
    }
    return { alerted, withheldNote: withheldNote ?? null };
  },
});

/** Open alerts for one matter (opted-in matters only, by construction). */
export const list = query({
  args: { matterId: v.id("matters"), includeHandled: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) return [];
    const rows = await ctx.db
      .query("matterImpactAlerts")
      .withIndex("by_matter_status", (q) => q.eq("matterId", args.matterId))
      .collect();
    const visible = args.includeHandled
      ? rows
      : rows.filter((r) => r.status === "open" || r.status === "superseded");
    return visible
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r, coverageNote: CAPABILITY_NOTE }));
  },
});

/** Toggle the matter's OPT-IN flag (lawyer-controlled, matter.edit). */
export const setOptIn = mutation({
  args: { matterId: v.id("matters"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const profile = matter.legalProfile;
    if (!profile) {
      throw new Error(
        "Confirm the matter's legal profile first — alerts anchor to the profile's sources and jurisdiction.",
      );
    }
    await ctx.db.patch(matter._id, {
      legalProfile: { ...profile, impactAlerts: args.enabled },
      updatedAt: Date.now(),
    });
    return { enabled: args.enabled };
  },
});

/** Add/remove an anchored source stableKey on the matter's profile. */
export const setAnchor = mutation({
  args: { matterId: v.id("matters"), stableKey: v.string(), remove: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "matter.edit");
    const matter = await ctx.db.get(args.matterId);
    if (!matter || matter.orgId !== ac.org._id) {
      throw new Error("Matter not found in this organization.");
    }
    const profile = matter.legalProfile;
    if (!profile) {
      throw new Error(
        "Confirm the matter's legal profile first — alerts anchor to the profile's sources and jurisdiction.",
      );
    }
    const current = profile.anchoredSourceKeys ?? [];
    const next = args.remove
      ? current.filter((k) => k !== args.stableKey)
      : [...new Set([...current, args.stableKey])];
    await ctx.db.patch(matter._id, {
      legalProfile: { ...profile, anchoredSourceKeys: next },
      updatedAt: Date.now(),
    });
    return { anchoredSourceKeys: next };
  },
});

/** Acknowledge an alert with a mandatory note. */
export const acknowledge = mutation({
  args: { alertId: v.id("matterImpactAlerts"), note: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.orgId !== ac.org._id) {
      throw new Error("Alert not found in this organization.");
    }
    if (alert.status !== "open") {
      throw new Error("Only an open alert can be acknowledged.");
    }
    const note = args.note.trim();
    if (note.length < 10) {
      throw new Error(
        "State what was reviewed (at least 10 characters) — the record must be self-explanatory.",
      );
    }
    await ctx.db.patch(alert._id, {
      status: "acknowledged",
      acknowledgedAt: Date.now(),
      acknowledgedById: ac.user._id,
      acknowledgedNote: note.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { acknowledged: true };
  },
});

/** Dismiss an alert with a mandatory reason (never deleted — recorded). */
export const dismiss = mutation({
  args: { alertId: v.id("matterImpactAlerts"), reason: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.orgId !== ac.org._id) {
      throw new Error("Alert not found in this organization.");
    }
    if (alert.status !== "open") {
      throw new Error("Only an open alert can be dismissed.");
    }
    const reason = args.reason.trim();
    if (reason.length < 10) {
      throw new Error("A reason of at least 10 characters is required.");
    }
    await ctx.db.patch(alert._id, {
      status: "dismissed",
      dismissedReason: reason.slice(0, 300),
      updatedAt: Date.now(),
    });
    return { dismissed: true };
  },
});

/** Assign an alert to a member for follow-up. */
export const assign = mutation({
  args: { alertId: v.id("matterImpactAlerts"), assigneeId: v.id("users") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.orgId !== ac.org._id) {
      throw new Error("Alert not found in this organization.");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const member = membership.find((m) => m.userId === args.assigneeId);
    if (!member || member.status !== "active") {
      throw new Error("Assignee must be an active member of this organization.");
    }
    await ctx.db.patch(alert._id, {
      assignedToId: args.assigneeId,
      assignedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { assigned: true };
  },
});

/**
 * Convert an alert into a TASK PROPOSAL via the existing taskSuggestions
 * flow — the lawyer then approves it like any other suggestion (approve
 * creates the real task). Nothing is created here without approval.
 */
export const convertToTaskProposal = mutation({
  args: { alertId: v.id("matterImpactAlerts") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const alert = await ctx.db.get(args.alertId);
    if (!alert || alert.orgId !== ac.org._id) {
      throw new Error("Alert not found in this organization.");
    }
    if (alert.status !== "open") {
      throw new Error("Only an open alert can be converted.");
    }
    const suggestionId = (await ctx.db.insert("taskSuggestions", {
      orgId: ac.org._id,
      matterId: alert.matterId,
      title: `Review legal-source update: ${alert.sourceTitle} (v${alert.toVersion})`.slice(
        0,
        300,
      ),
      rationale: `Source ${alert.stableKey} now has version ${alert.toVersion} in the ingested corpus${alert.treatment ? `; sourced treatment "${alert.treatment}"` : ""}. Lawyer assessment of the impact on this matter is required. ${CAPABILITY_NOTE}`.slice(
        0,
        600,
      ),
      sourceKind: "document",
      sourceId: String(alert._id),
      sourceRef: `matterImpactAlert ${alert.dedupeKey}`,
      status: "proposed",
      createdAt: Date.now(),
    })) as Id<"taskSuggestions">;
    await ctx.db.patch(alert._id, {
      status: "converted_to_task",
      taskSuggestionId: suggestionId,
      updatedAt: Date.now(),
    });
    return { suggestionId: String(suggestionId) };
  },
});
