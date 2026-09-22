import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { can, requireAccess, requireMatter } from "./access";
import type { Id } from "./_generated/dataModel";

// =====================================================================
// Firm knowledge (section 25).
//
// Precedents, templates, research notes and saved authorities with
// categories, tags, search, version history, authors, source links and
// draft/approved state. Guardrails:
//  - Private client material is never auto-published: entries are
//    authored deliberately, and reuse copies into a matter via an
//    explicit action by someone with access to both.
//  - Approvals attach to a specific version; any edit creates a new
//    version and returns the entry to draft.
//  - Permission-controlled reuse: drafting/reuse requires note.write;
//    approving requires task.manage or team.manage.
// =====================================================================

const MAX_TITLE = 200;
const MAX_BODY = 20000;
const MAX_TAGS = 12;
const MAX_TAG = 30;

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const cleaned = Array.from(
    new Set(
      tags
        .map((t) => t.trim().toLowerCase().replace(/^#/, "").slice(0, MAX_TAG))
        .filter(Boolean),
    ),
  ).slice(0, MAX_TAGS);
  return cleaned.length ? cleaned : undefined;
}

/** Org-scoped search across the body of the latest version. */
async function matchesSearch(
  ctx: QueryCtx,
  entryId: Id<"knowledgeEntries">,
  needle: string,
): Promise<boolean> {
  if (!needle) return true;
  const latest = await latestVersion(ctx, entryId);
  if (!latest) return false;
  return latest.body.toLowerCase().includes(needle);
}

type VersionRow = { version: number; body: string; sourceUrl?: string; sourceRef?: string };

async function latestVersion(
  ctx: QueryCtx,
  entryId: Id<"knowledgeEntries">,
): Promise<VersionRow | null> {
  const rows = await ctx.db
    .query("knowledgeVersions")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  return rows.sort((a, b) => b.version - a.version)[0] ?? null;
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Categories for the filter bar / picker. */
export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    return (
      await ctx.db
        .query("knowledgeCategories")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createCategory = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to manage categories.");
    }
    const name = args.name.trim().slice(0, 80);
    if (!name) throw new Error("Category name is required.");
    const existing = (
      await ctx.db
        .query("knowledgeCategories")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
    ).find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing._id;
    return await ctx.db.insert("knowledgeCategories", {
      orgId: ac.org._id,
      name,
      createdAt: Date.now(),
    });
  },
});

/**
 * The library list. `includeDrafts` is a preference, not a permission
 * bypass — drafts are always visible inside the firm (that is what
 * makes review possible), while `retired` entries are hidden unless
 * explicitly requested.
 */
export const list = query({
  args: {
    search: v.optional(v.string()),
    categoryId: v.optional(v.id("knowledgeCategories")),
    tag: v.optional(v.string()),
    kind: v.optional(
      v.union(
        v.literal("precedent"),
        v.literal("template"),
        v.literal("research_note"),
        v.literal("authority"),
      ),
    ),
    state: v.optional(
      v.union(v.literal("draft"), v.literal("approved"), v.literal("retired"), v.literal("all")),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const needle = args.search?.trim().toLowerCase();
    let rows = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    if (args.state && args.state !== "all") {
      rows = rows.filter((e) => e.state === args.state);
    } else {
      rows = rows.filter((e) => e.state !== "retired");
    }
    if (args.kind) rows = rows.filter((e) => e.kind === args.kind);
    if (args.categoryId) rows = rows.filter((e) => e.categoryId === args.categoryId);
    if (args.tag) {
      const tag = args.tag.trim().toLowerCase();
      rows = rows.filter((e) => (e.tags ?? []).includes(tag));
    }
    if (needle) {
      rows = rows.filter(
        (e) =>
          e.title.toLowerCase().includes(needle) ||
          (e.tags ?? []).some((t) => t.includes(needle)),
      );
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt);

    return Promise.all(
      rows.slice(0, 200).map(async (e) => {
        const inSearch = needle ? await matchesSearch(ctx, e._id, needle) : true;
        if (needle && !inSearch) return null;
        const author = await ctx.db.get(e.authorId);
        const version = await latestVersion(ctx, e._id);
        return {
          _id: e._id,
          kind: e.kind,
          title: e.title,
          state: e.state,
          tags: e.tags ?? [],
          categoryId: e.categoryId ?? null,
          currentVersion: e.currentVersion,
          reuseCount: e.reuseCount ?? 0,
          updatedAt: e.updatedAt,
          authorName: author?.name ?? author?.email ?? "Member",
          excerpt:
            (version?.body ?? "").slice(0, 180) +
            ((version?.body ?? "").length > 180 ? "…" : ""),
        };
      }),
    ).then((r) => r.filter((x): x is NonNullable<typeof x> => x !== null));
  },
});

/** Full entry: metadata, version history and the requested version body. */
export const get = query({
  args: { entryId: v.id("knowledgeEntries"), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) {
      throw new Error("Entry not found.");
    }
    const versions = (
      await ctx.db
        .query("knowledgeVersions")
        .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
        .collect()
    ).sort((a, b) => b.version - a.version);
    const current = args.version
      ? versions.find((x) => x.version === args.version)
      : versions[0];
    if (!current) throw new Error("Version not found.");
    const [author, approver] = await Promise.all([
      ctx.db.get(entry.authorId),
      entry.approvedById ? ctx.db.get(entry.approvedById) : Promise.resolve(null),
    ]);
    return {
      _id: entry._id,
      kind: entry.kind,
      title: entry.title,
      state: entry.state,
      tags: entry.tags ?? [],
      categoryId: entry.categoryId ?? null,
      restrictedRoles: entry.restrictedRoles ?? [],
      currentVersion: entry.currentVersion,
      approvedVersion: entry.approvedVersion ?? null,
      approvedByName: approver?.name ?? null,
      approvedAt: entry.approvedAt ?? null,
      reuseCount: entry.reuseCount ?? 0,
      lastReusedAt: entry.lastReusedAt ?? null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      authorName: author?.name ?? author?.email ?? "Member",
      body: current.body,
      bodyVersion: current.version,
      sourceUrl: current.sourceUrl ?? null,
      sourceRef: current.sourceRef ?? null,
      changeNote: current.changeNote ?? null,
      versions: versions.map((x) => ({
        version: x.version,
        authorId: x.authorId,
        createdAt: x.createdAt,
        changeNote: x.changeNote ?? null,
        sourceUrl: x.sourceUrl ?? null,
        sourceRef: x.sourceRef ?? null,
      })),
    };
  },
});

// ---------------------------------------------------------------------
// Authoring & lifecycle
// ---------------------------------------------------------------------

export const create = mutation({
  args: {
    kind: v.union(
      v.literal("precedent"),
      v.literal("template"),
      v.literal("research_note"),
      v.literal("authority"),
    ),
    title: v.string(),
    body: v.string(),
    categoryId: v.optional(v.id("knowledgeCategories")),
    tags: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to author knowledge.");
    }
    const title = args.title.trim().slice(0, MAX_TITLE);
    const body = args.body.trim().slice(0, MAX_BODY);
    if (!title) throw new Error("Give the entry a title.");
    if (body.length < 5) throw new Error("The entry body is empty.");

    const entryId = await ctx.db.insert("knowledgeEntries", {
      orgId: ac.org._id,
      kind: args.kind,
      title,
      authorId: ac.user._id,
      categoryId: args.categoryId,
      tags: normalizeTags(args.tags),
      state: "draft",
      currentVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("knowledgeVersions", {
      entryId,
      version: 1,
      body,
      sourceUrl: args.sourceUrl?.trim().slice(0, 500) || undefined,
      sourceRef: args.sourceRef?.trim().slice(0, 300) || undefined,
      changeNote: "Initial version.",
      authorId: ac.user._id,
      createdAt: Date.now(),
    });
    return entryId;
  },
});

/** Edit = new version + back to draft. Old approvals never carry over. */
export const edit = mutation({
  args: {
    entryId: v.id("knowledgeEntries"),
    title: v.optional(v.string()),
    body: v.string(),
    categoryId: v.optional(v.id("knowledgeCategories")),
    tags: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
    sourceRef: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to edit knowledge.");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Entry not found.");
    const body = args.body.trim().slice(0, MAX_BODY);
    if (body.length < 5) throw new Error("The entry body is empty.");
    const t = Date.now();
    const version = entry.currentVersion + 1;
    await ctx.db.patch(entry._id, {
      title: args.title !== undefined ? args.title.trim().slice(0, MAX_TITLE) || entry.title : entry.title,
      categoryId: args.categoryId,
      tags: normalizeTags(args.tags),
      state: "draft",
      approvedById: undefined,
      approvedAt: undefined,
      approvedVersion: undefined,
      currentVersion: version,
      updatedAt: t,
    });
    await ctx.db.insert("knowledgeVersions", {
      entryId: entry._id,
      version,
      body,
      sourceUrl: args.sourceUrl?.trim().slice(0, 500) || undefined,
      sourceRef: args.sourceRef?.trim().slice(0, 300) || undefined,
      changeNote: args.changeNote?.trim().slice(0, 300) || undefined,
      authorId: ac.user._id,
      createdAt: t,
    });
  },
});

export const approve = mutation({
  args: { entryId: v.id("knowledgeEntries"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "task.manage") && !can(ac, "team.manage")) {
      throw new Error("Only a reviewer (task or team manager) can approve entries.");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (entry.state === "retired") throw new Error("Retired entries must be revived first.");
    if (entry.state === "approved" && entry.approvedVersion === entry.currentVersion) {
      throw new Error("This version is already approved.");
    }
    await ctx.db.patch(entry._id, {
      state: "approved",
      approvedById: ac.user._id,
      approvedAt: Date.now(),
      approvedVersion: entry.currentVersion,
      updatedAt: Date.now(),
    });
  },
});

export const setState = mutation({
  args: {
    entryId: v.id("knowledgeEntries"),
    state: v.union(v.literal("draft"), v.literal("approved"), v.literal("retired")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "task.manage") && !can(ac, "team.manage") && !can(ac, "note.write")) {
      throw new Error("You do not have permission to change entry state.");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (args.state === "approved") {
      throw new Error("Use the review action to approve a specific version.");
    }
    await ctx.db.patch(entry._id, { state: args.state, updatedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------
// Permission-controlled reuse into a matter
// ---------------------------------------------------------------------

/**
 * Copy an entry into a matter as an internal note (or as a task for
 * follow-up). Explicit, permission-checked on both sides, and recorded
 * in the matter's chronology. This is the only path from the library
 * into client work — nothing flows automatically.
 */
export const reuseInMatter = mutation({
  args: {
    entryId: v.id("knowledgeEntries"),
    matterId: v.id("matters"),
    version: v.optional(v.number()),
    mode: v.union(v.literal("note"), v.literal("task")),
    taskDueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to reuse knowledge.");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.orgId !== ac.org._id) throw new Error("Entry not found.");
    if (entry.state === "retired") throw new Error("Revive this entry before reusing it.");
    await requireMatter(ctx, ac, args.matterId);

    const versions = await ctx.db
      .query("knowledgeVersions")
      .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
      .collect();
    const version = args.version
      ? versions.find((x) => x.version === args.version)
      : versions.sort((a, b) => b.version - a.version)[0];
    if (!version) throw new Error("Version not found.");

    const header = `${entry.title} (firm knowledge, v${version.version})`;
    let detail = "";
    if (args.mode === "note") {
      await ctx.db.insert("matterNotes", {
        matterId: args.matterId,
        authorId: ac.user._id,
        body: `${header}\n\n${version.body}`,
        createdAt: Date.now(),
      });
      detail = `Firm knowledge reused as a note — ${header}.`;
    } else {
      await ctx.db.insert("tasks", {
        matterId: args.matterId,
        orgId: ac.org._id,
        title: `Review knowledge: ${entry.title}`.slice(0, 200),
        kind: "general",
        status: "pending",
        priority: "normal",
        assigneeId: ac.user._id,
        createdById: ac.user._id,
        dueAt: args.taskDueDate
          ? // End of the organisation-local day (Asia/Kolkata) so a
            // date-only target does not read as overdue early.
            new Date(`${args.taskDueDate}T23:59:59+05:30`).getTime()
          : undefined,
        createdAt: Date.now(),
      });
      detail = `Firm knowledge reused as a task — ${header}.`;
    }

    await ctx.db.patch(entry._id, {
      reuseCount: (entry.reuseCount ?? 0) + 1,
      lastReusedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Chronology entry (same shape as matters.logEvent).
    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "note",
      detail,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact" as const,
      visibility: "internal" as const,
    });
  },
});

// ---------------------------------------------------------------------
// Court information — manual import/entry, honestly labelled
// ---------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Manual cause-list import. Each row records who checked it, when, and
 * against which published source — the UI always shows this as
 * "manually imported", never as a live feed.
 */
export const importCauseList = mutation({
  args: {
    listDate: v.string(),
    rows: v.array(
      v.object({
        court: v.string(),
        itemNumber: v.optional(v.string()),
        caseTitle: v.string(),
        caseNumber: v.optional(v.string()),
      }),
    ),
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "hearing.manage") && !can(ac, "note.write")) {
      throw new Error("You need hearing-management or note-writing permission to import cause lists.");
    }
    const listDate = args.listDate.trim();
    if (!DAY_RE.test(listDate)) throw new Error("Use the date picker (YYYY-MM-DD).");
    if (!args.rows.length) throw new Error("Paste at least one cause-list row.");
    const sourceName = args.sourceName.trim().slice(0, 200);
    if (!sourceName) throw new Error("Record where this list came from (e.g. the court website).");

    const inserted: Id<"causeListEntries">[] = [];
    for (const row of args.rows.slice(0, 100)) {
      const caseTitle = row.caseTitle.trim().slice(0, 300);
      if (!caseTitle) continue;
      inserted.push(
        await ctx.db.insert("causeListEntries", {
          orgId: ac.org._id,
          listDate,
          court: row.court.trim().slice(0, 200) || sourceName,
          itemNumber: row.itemNumber?.trim().slice(0, 40) || undefined,
          caseTitle,
          caseNumber: row.caseNumber?.trim().slice(0, 120) || undefined,
          sourceName,
          sourceUrl: args.sourceUrl?.trim().slice(0, 500) || undefined,
          checkedAt: Date.now(),
          checkedById: ac.user._id,
          createdAt: Date.now(),
        }),
      );
    }
    return { imported: inserted.length };
  },
});

/** Link an imported cause-list row to a matter (and record it). */
export const linkCauseListRow = mutation({
  args: {
    rowId: v.id("causeListEntries"),
    matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "hearing.manage") && !can(ac, "note.write")) {
      throw new Error("You do not have permission to link cause-list rows.");
    }
    const row = await ctx.db.get(args.rowId);
    if (!row || row.orgId !== ac.org._id) throw new Error("Row not found.");
    if (args.matterId !== undefined) {
      await requireMatter(ctx, ac, args.matterId);
      await ctx.db.insert("matterEvents", {
        matterId: args.matterId,
        kind: "hearing",
        detail: `Listed on the ${row.court} cause list for ${row.listDate}${row.itemNumber ? ` (item ${row.itemNumber})` : ""}. Manually imported from ${row.sourceName}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "exact" as const,
        sourceRef: row.sourceUrl ?? row.sourceName,
        visibility: "internal" as const,
      });
    }
    await ctx.db.patch(args.rowId, { matterId: args.matterId });
  },
});

export const listCauseList = query({
  args: { listDate: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("causeListEntries")
      .withIndex("by_org_date", (q) =>
        q.eq("orgId", ac.org._id).eq("listDate", args.listDate),
      )
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => (a.itemNumber ?? "").localeCompare(b.itemNumber ?? "", undefined, { numeric: true }))
        .map(async (r) => {
          const matter = r.matterId ? await ctx.db.get(r.matterId) : null;
          const checker = await ctx.db.get(r.checkedById);
          return {
            _id: r._id,
            listDate: r.listDate,
            court: r.court,
            itemNumber: r.itemNumber ?? null,
            caseTitle: r.caseTitle,
            caseNumber: r.caseNumber ?? null,
            sourceName: r.sourceName,
            sourceUrl: r.sourceUrl ?? null,
            checkedAt: r.checkedAt,
            checkedByName: checker?.name ?? checker?.email ?? "Member",
            matterId: r.matterId ?? null,
            matterReference: matter?.reference ?? null,
            matterTitle: matter?.title ?? null,
          };
        }),
    );
  },
});

export const addCourtUpdate = mutation({
  args: {
    kind: v.union(
      v.literal("circular"),
      v.literal("notification"),
      v.literal("roster"),
      v.literal("holiday"),
      v.literal("other"),
    ),
    title: v.string(),
    detail: v.optional(v.string()),
    court: v.optional(v.string()),
    effectiveFrom: v.optional(v.string()),
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
    matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "note.write")) {
      throw new Error("You need note-writing permission to record court updates.");
    }
    const title = args.title.trim().slice(0, 300);
    if (!title) throw new Error("Give the update a title.");
    if (!args.sourceName.trim()) {
      throw new Error("Record the source (e.g. the court's circular PDF).");
    }
    if (args.effectiveFrom && !DAY_RE.test(args.effectiveFrom)) {
      throw new Error("Use the date picker for the effective date.");
    }
    if (args.matterId !== undefined) await requireMatter(ctx, ac, args.matterId);
    await ctx.db.insert("courtUpdates", {
      orgId: ac.org._id,
      kind: args.kind,
      title,
      detail: args.detail?.trim().slice(0, 4000) || undefined,
      court: args.court?.trim().slice(0, 200) || undefined,
      effectiveFrom: args.effectiveFrom,
      sourceName: args.sourceName.trim().slice(0, 200),
      sourceUrl: args.sourceUrl?.trim().slice(0, 500) || undefined,
      checkedAt: Date.now(),
      checkedById: ac.user._id,
      matterId: args.matterId,
      createdAt: Date.now(),
    });
  },
});

export const listCourtUpdates = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    const rows = await ctx.db
      .query("courtUpdates")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return Promise.all(
      rows
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 100)
        .map(async (r) => {
          const checker = await ctx.db.get(r.checkedById);
          return {
            _id: r._id,
            kind: r.kind,
            title: r.title,
            detail: r.detail ?? null,
            court: r.court ?? null,
            effectiveFrom: r.effectiveFrom ?? null,
            sourceName: r.sourceName,
            sourceUrl: r.sourceUrl ?? null,
            checkedAt: r.checkedAt,
            checkedByName: checker?.name ?? checker?.email ?? "Member",
            matterId: r.matterId ?? null,
          };
        }),
    );
  },
});

