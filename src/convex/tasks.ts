import { v } from "convex/values";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  canViewMatter,
  getAccessContext,
  requireAccess,
  requireCapability,
  requireMatter,
} from "./access";
import {
  DEADLINE_CATEGORIES,
  TASK_KINDS,
  TASK_PRIORITIES,
  taskStatusValidator,
} from "./schema";

// ===============================================================
// Tasks, deadlines and matter playbooks.
//
// Visibility:
//  - Matter-linked records require matter access (enforced per row).
//  - Firm-wide tasks are visible to their creator, assignee, and
//    holders of the task-management capability.
// Mutation always requires authorization beyond visibility:
//  - create/edit/reassign need the task.manage capability (staff may
//    self-assign filing/service work).
//  - status changes are allowed to the assignee or task.manage.
// Assignees must be active organisation members.
//
// Playbooks are editable, versioned templates. Applying one to a
// matter copies its tasks and user-confirmed dates — the system never
// computes limitation periods or any other legal deadline.
// ===============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TITLE = 240;
const MAX_TEXT = 2000;

/** End of a YYYY-MM-DD calendar day in Asia/Kolkata (UTC+5:30, no DST). */
export function endOfDayIST(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) throw new Error("Use the date picker (YYYY-MM-DD).");
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), 18, 29, 59, 999);
  if (Number.isNaN(ms)) throw new Error("That date could not be read.");
  return ms;
}

function assertActiveMember(
  member: Doc<"memberships"> | null,
): asserts member is Doc<"memberships"> {
  if (!member || member.status !== "active") {
    throw new Error("Assignees must be active members of the organisation.");
  }
}

async function loadAssignee(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
) {
  return ctx.db
    .query("memberships")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .first();
}

/** Can the caller see this task at all? */
async function canSeeTask(
  ctx: QueryCtx,
  ac: NonNullable<Awaited<ReturnType<typeof getAccessContext>>>,
  task: Doc<"tasks">,
): Promise<boolean> {
  if (task.orgId !== ac.org._id) return false;
  if (task.assigneeId === ac.user._id) return true;
  if (task.createdById === ac.user._id) return true;
  if (can(ac, "task.manage")) return true;
  if (task.matterId !== undefined) {
    const matter = await ctx.db.get(task.matterId);
    return !!matter && canViewMatter(ac, matter);
  }
  return false;
}

/** Authorization for status changes: assignee or task.manage holder. */
function assertCanProgress(
  ac: NonNullable<Awaited<ReturnType<typeof getAccessContext>>>,
  task: Doc<"tasks">,
) {
  const mine = task.assigneeId === ac.user._id;
  if (!mine && !can(ac, "task.manage")) {
    throw new Error("You can update only your own tasks.");
  }
}

// ---------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------

/** Task desk: matter-linked (access-filtered) + firm-wide, with views. */
export const desk = query({
  args: {
    view: v.union(
      v.literal("mine"),
      v.literal("today"),
      v.literal("upcoming"),
      v.literal("overdue"),
      v.literal("completed"),
      v.literal("all"),
    ),
    includeFirmWide: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const now = Date.now();

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    // Matter visibility resolved per row (cached).
    const matterCache = new Map<Id<"matters">, Doc<"matters"> | null>();
    const visible = [] as (Doc<"tasks"> & { matter: Doc<"matters"> | null })[];
    for (const t of tasks) {
      let matter: Doc<"matters"> | null = null;
      if (t.matterId !== undefined) {
        if (matterCache.has(t.matterId)) {
          matter = matterCache.get(t.matterId) ?? null;
        } else {
          const m = await ctx.db.get(t.matterId);
          matterCache.set(t.matterId, m ?? null);
          matter = m ?? null;
        }
        if (!matter || !canViewMatter(ac, matter)) continue;
      } else if (!args.includeFirmWide) {
        continue;
      } else {
        const mine = t.assigneeId === ac.user._id;
        const createdByMe = t.createdById === ac.user._id;
        if (!mine && !createdByMe && !can(ac, "task.manage")) continue;
      }
      visible.push(Object.assign(t, { matter }));
    }

    const filtered = visible.filter((t) => {
      switch (args.view) {
        case "mine":
          return t.assigneeId === ac.user._id && t.status !== "done";
        case "today":
          return (
            t.status !== "done" &&
            t.dueAt !== undefined &&
            t.dueAt >= now - DAY_MS &&
            t.dueAt <= now + DAY_MS
          );
        case "upcoming":
          return t.status !== "done" && (t.dueAt === undefined || t.dueAt > now);
        case "overdue":
          return t.status !== "done" && t.dueAt !== undefined && t.dueAt < now - DAY_MS;
        case "completed":
          return t.status === "done";
        case "all":
        default:
          return true;
      }
    });

    const order = { urgent: 0, high: 1, normal: 2 } as const;
    filtered.sort((a, b) => {
      if (a.status !== b.status && (a.status === "done" || b.status === "done")) {
        return a.status === "done" ? 1 : -1;
      }
      const pa = order[a.priority] ?? 3;
      const pb = order[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
    });

    const userIds = new Set<Id<"users">>();
    for (const t of visible) {
      if (t.assigneeId) userIds.add(t.assigneeId);
      if (t.createdById) userIds.add(t.createdById);
    }
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    // Automation provenance for the review chip.
    const runStateById = new Map<string, string | undefined>();
    for (const t of filtered) {
      if (t.automationRunId && !runStateById.has(t.automationRunId)) {
        const run = await ctx.db.get(t.automationRunId);
        runStateById.set(t.automationRunId, run?.reviewState);
      }
    }

    return filtered.slice(0, 300).map((t) => ({
      _id: t._id,
      title: t.title,
      kind: t.kind,
      priority: t.priority,
      status: t.status,
      dueAt: t.dueAt ?? null,
      assigneeId: t.assigneeId ?? null,
      assigneeName: t.assigneeId ? (nameByUser.get(t.assigneeId) ?? null) : null,
      createdById: t.createdById,
      createdByName: nameByUser.get(t.createdById) ?? null,
      matterId: t.matterId ?? null,
      matterReference: t.matter?.reference ?? null,
      matterTitle: t.matter?.title ?? null,
      comments: (t.comments ?? []).map((c) => ({
        body: c.body,
        at: c.at,
        authorName: nameByUser.get(c.authorId) ?? "Member",
      })),
      attachments: t.attachments ?? [],
      completionNote: t.completionNote ?? null,
      completedAt: t.completedAt ?? null,
      createdAt: t.createdAt,
      automationRunId: t.automationRunId ?? null,
      automationReviewState: t.automationRunId
        ? (runStateById.get(t.automationRunId) ?? null)
        : null,
    }));
  },
});

/** Deadline register: open/completed with category + responsible filters. */
export const deadlineList = query({
  args: {
    status: v.union(v.literal("open"), v.literal("completed"), v.literal("all")),
    category: v.optional(v.string()),
    matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("deadlines")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();

    const matterCache = new Map<Id<"matters">, Doc<"matters"> | null>();
    const userIds = new Set<Id<"users">>();
    for (const d of rows) {
      if (d.responsibleId) userIds.add(d.responsibleId);
      if (d.createdById) userIds.add(d.createdById);
    }
    const nameByUser = new Map<Id<"users">, string>();
    for (const id of userIds) {
      const u = await ctx.db.get(id);
      if (u) nameByUser.set(id, u.name ?? u.email ?? "Member");
    }

    const out = [];
    for (const d of rows) {
      if (args.status !== "all" && d.status !== args.status) continue;
      if (args.category && args.category !== "all" && d.category !== args.category) continue;
      if (d.matterId !== undefined) {
        let matter = matterCache.get(d.matterId);
        if (matter === undefined) {
          const m = await ctx.db.get(d.matterId);
          matterCache.set(d.matterId, m ?? null);
          matter = m ?? null;
        }
        if (!matter || !canViewMatter(ac, matter)) continue;
        out.push({
          ...d,
          matterReference: matter.reference,
          matterTitle: matter.title,
          responsibleName: d.responsibleId
            ? (nameByUser.get(d.responsibleId) ?? null)
            : null,
          createdByName: nameByUser.get(d.createdById) ?? null,
        });
      } else {
        // Firm-wide deadlines need task/deadline management or responsibility.
        if (
          !can(ac, "task.manage") &&
          d.responsibleId !== ac.user._id &&
          d.createdById !== ac.user._id
        ) {
          continue;
        }
        out.push({
          ...d,
          matterReference: null,
          matterTitle: null,
          responsibleName: d.responsibleId
            ? (nameByUser.get(d.responsibleId) ?? null)
            : null,
          createdByName: nameByUser.get(d.createdById) ?? null,
        });
      }
    }
    out.sort((a, b) => a.dueAt - b.dueAt);
    return out;
  },
});

/** Playbook catalogue for the organisation. */
export const playbookList = query({
  args: {},
  handler: async (ctx) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    const rows = await ctx.db
      .query("playbooks")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const runs = await ctx.db
      .query("playbookRuns")
      .withIndex("by_matter")
      .collect();
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((p) => ({
        _id: p._id,
        name: p.name,
        matterType: p.matterType,
        description: p.description ?? null,
        currentVersion: p.currentVersion,
        updatedAt: p.updatedAt,
        timesApplied: runs.filter((r) => r.playbookId === p._id).length,
      }));
  },
});

/** One playbook with its current version's stages. */
export const playbookDetail = query({
  args: { playbookId: v.id("playbooks") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const p = await ctx.db.get(args.playbookId);
    if (!p || p.orgId !== ac.org._id) return null;
    const version = await ctx.db
      .query("playbookVersions")
      .withIndex("by_playbook", (q) => q.eq("playbookId", p._id))
      .collect();
    const current = version.find((x) => x.version === p.currentVersion) ?? null;
    return {
      _id: p._id,
      name: p.name,
      matterType: p.matterType,
      description: p.description ?? null,
      currentVersion: p.currentVersion,
      updatedAt: p.updatedAt,
      stages: current?.stages ?? [],
      versions: version
        .sort((a, b) => b.version - a.version)
        .map((x) => ({
          version: x.version,
          createdAt: x.createdAt,
          stageCount: x.stages.length,
          taskCount: x.stages.reduce((n, s) => n + s.tasks.length, 0),
        })),
    };
  },
});

/** Playbook applications recorded on a matter. */
export const runsForMatter = query({
  args: { matterId: v.id("matters") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return [];
    await requireMatter(ctx, ac, args.matterId);
    const runs = await ctx.db
      .query("playbookRuns")
      .withIndex("by_matter", (q) => q.eq("matterId", args.matterId))
      .collect();
    const nameById = new Map<Id<"playbooks">, string>();
    for (const r of runs) {
      if (!nameById.has(r.playbookId)) {
        const p = await ctx.db.get(r.playbookId);
        if (p) nameById.set(p._id, p.name);
      }
    }
    return runs
      .sort((a, b) => b.appliedAt - a.appliedAt)
      .map((r) => ({
        _id: r._id,
        playbookName: nameById.get(r.playbookId) ?? "Playbook",
        playbookVersion: r.playbookVersion,
        appliedAt: r.appliedAt,
        taskCount: r.createdTaskIds.length,
        deadlineCount: r.createdDeadlineIds.length,
      }));
  },
});

// ---------------------------------------------------------------------
// Task mutations
// ---------------------------------------------------------------------

/** Create a task — matter-linked or firm-wide. Requires task.manage. */
export const createTask = mutation({
  args: {
    matterId: v.optional(v.id("matters")),
    title: v.string(),
    kind: v.union(...TASK_KINDS.map((k) => v.literal(k))),
    priority: v.union(...TASK_PRIORITIES.map((p) => v.literal(p))),
    dueDate: v.optional(v.string()), // YYYY-MM-DD, organisation-local
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    if (!args.title.trim() || args.title.length > MAX_TITLE) {
      throw new Error("Give the task a clear title.");
    }
    if (args.matterId !== undefined) {
      await requireMatter(ctx, ac, args.matterId);
    }

    let assigneeId = args.assigneeId;
    if (assigneeId !== undefined) {
      const m = await loadAssignee(ctx, ac.org._id, assigneeId);
      assertActiveMember(m);
    } else if (ac.membership.orgRole === "support_staff") {
      // Support staff create filing/service work for themselves.
      assigneeId = ac.user._id;
    }

    const taskId = await ctx.db.insert("tasks", {
      matterId: args.matterId,
      orgId: ac.org._id,
      title: args.title.trim(),
      kind: args.kind,
      priority: args.priority,
      dueAt: args.dueDate ? endOfDayIST(args.dueDate) : undefined,
      status: "pending",
      assigneeId,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });

    if (args.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: args.matterId,
        kind: "task",
        detail: `Task added — ${args.title.trim()}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "exact",
        linkId: taskId,
      });
    }
    return { taskId };
  },
});

/** Edit title/kind/priority/due date/assignee. Requires task.manage. */
export const editTask = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    kind: v.optional(v.union(...TASK_KINDS.map((k) => v.literal(k)))),
    priority: v.optional(v.union(...TASK_PRIORITIES.map((p) => v.literal(p)))),
    dueDate: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== ac.org._id) throw new Error("Task not found.");
    if (task.matterId !== undefined) {
      await requireMatter(ctx, ac, task.matterId);
    }

    const patch: Partial<Doc<"tasks">> = {};
    if (args.title !== undefined) {
      if (!args.title.trim()) throw new Error("Title cannot be empty.");
      patch.title = args.title.trim();
    }
    if (args.kind !== undefined) patch.kind = args.kind;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueDate !== undefined) {
      patch.dueAt = args.dueDate ? endOfDayIST(args.dueDate) : undefined;
    }
    if (args.assigneeId !== undefined) {
      const m = await loadAssignee(ctx, ac.org._id, args.assigneeId);
      assertActiveMember(m);
      patch.assigneeId = args.assigneeId;
    }
    await ctx.db.patch(args.taskId, patch);

    if (task.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: task.matterId,
        kind: "task",
        detail: `Task updated — ${patch.title ?? task.title}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "exact",
      });
    }
  },
});

/**
 * Move a task between statuses. Completing a filing/service/delivery/
 * collection task records completion evidence; reopening clears it.
 */
export const setDeskTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: taskStatusValidator,
    completionNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== ac.org._id) throw new Error("Task not found.");
    const allowed =
      task.matterId !== undefined
        ? await canSeeTask(ctx, ac, task)
        : task.assigneeId === ac.user._id ||
          task.createdById === ac.user._id ||
          can(ac, "task.manage");
    if (!allowed) throw new Error("You do not have access to this task.");
    assertCanProgress(ac, task);

    if (args.status === "done") {
      const needsEvidence =
        task.kind === "filing" ||
        task.kind === "service" ||
        task.kind === "delivery" ||
        task.kind === "collection";
      const hasNote = !!args.completionNote?.trim();
      const hasFiles = (task.attachments ?? []).length > 0;
      const hasAck = (task.acknowledgements ?? []).length > 0;
      if (needsEvidence && !hasNote && !hasFiles && !hasAck) {
        throw new Error(
          `Add a completion note or attach proof before completing this ${task.kind} task.`,
        );
      }
      await ctx.db.patch(args.taskId, {
        status: "done",
        completionNote: args.completionNote?.trim() || task.completionNote,
        completedAt: Date.now(),
        completedById: ac.user._id,
      });
    } else {
      await ctx.db.patch(args.taskId, {
        status: args.status,
        completionNote: args.status === "pending" ? undefined : task.completionNote,
        completedAt: undefined,
        completedById: undefined,
      });
    }

    if (task.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: task.matterId,
        kind: "task",
        detail: `Task ${args.status === "done" ? "completed" : "reopened"} — ${task.title}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "exact",
      });
    }
  },
});

/** Comment on a task (visibility + own-or-manage). */
export const addDeskTaskComment = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    if (!args.body.trim() || args.body.length > MAX_TEXT) {
      throw new Error("Write a comment first.");
    }
    const task = await ctx.db.get(args.taskId);
    if (!task || !(await canSeeTask(ctx, ac, task))) {
      throw new Error("You do not have access to this task.");
    }
    assertCanProgress(ac, task);
    await ctx.db.patch(args.taskId, {
      comments: [
        ...(task.comments ?? []),
        { authorId: ac.user._id, body: args.body.trim(), at: Date.now() },
      ],
    });
  },
});

/** Attach a completion-evidence file to a task. */
export const attachToTask = mutation({
  args: {
    taskId: v.id("tasks"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task || !(await canSeeTask(ctx, ac, task))) {
      throw new Error("You do not have access to this task.");
    }
    assertCanProgress(ac, task);
    if (!args.name.trim()) throw new Error("The file needs a name.");
    const docs = task.attachments ?? [];
    if (docs.length >= 8) {
      throw new Error("Up to eight evidence files per task.");
    }
    await ctx.db.patch(args.taskId, {
      attachments: [
        ...docs,
        { name: args.name.trim(), storageId: args.storageId, at: Date.now() },
      ],
    });
  },
});

/** Upload URL for task evidence files. */
export const generateTaskUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAccess(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Download URL for a task evidence file (visibility enforced). */
export const getTaskFileUrl = query({
  args: { taskId: v.id("tasks"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const ac = await getAccessContext(ctx);
    if (!ac) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task || !(await canSeeTask(ctx, ac, task))) return null;
    if (!(task.attachments ?? []).some((a) => a.storageId === args.storageId)) {
      return null;
    }
    return await ctx.storage.getUrl(args.storageId);
  },
});

// ---------------------------------------------------------------------
// Deadline mutations
// ---------------------------------------------------------------------

/**
 * Record a deadline. The due date is entered by a responsible human —
 * the system never computes limitation periods or other legally
 * significant dates.
 */
export const createDeadline = mutation({
  args: {
    matterId: v.optional(v.id("matters")),
    title: v.string(),
    category: v.union(...DEADLINE_CATEGORIES.map((c) => v.literal(c))),
    dueDate: v.string(), // YYYY-MM-DD
    responsibleId: v.optional(v.id("users")),
    reminderDaysBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    if (!args.title.trim()) throw new Error("Give the deadline a title.");
    const dueAt = endOfDayIST(args.dueDate);
    if (args.matterId !== undefined) {
      await requireMatter(ctx, ac, args.matterId);
    }
    if (args.responsibleId !== undefined) {
      const m = await loadAssignee(ctx, ac.org._id, args.responsibleId);
      assertActiveMember(m);
    }

    const reminderAt =
      args.reminderDaysBefore !== undefined && args.reminderDaysBefore > 0
        ? dueAt - args.reminderDaysBefore * DAY_MS
        : undefined;

    const deadlineId = await ctx.db.insert("deadlines", {
      orgId: ac.org._id,
      matterId: args.matterId,
      title: args.title.trim(),
      category: args.category,
      dueAt,
      status: "open",
      responsibleId: args.responsibleId,
      createdById: ac.user._id,
      reminderAt,
      history: [
        {
          at: Date.now(),
          byId: ac.user._id,
          text: `Recorded — category ${args.category}, due ${args.dueDate}${reminderAt ? `, reminder ${args.reminderDaysBefore} day(s) before` : ""}.`,
        },
      ],
      createdAt: Date.now(),
    });

    if (args.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: args.matterId,
        kind: "deadline",
        detail: `Deadline recorded — ${args.title.trim()} (due ${args.dueDate}).`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "day",
        linkId: deadlineId,
      });
    }
    return { deadlineId };
  },
});

/** Edit due date / responsible / reminder — every change is audited. */
export const editDeadline = mutation({
  args: {
    deadlineId: v.id("deadlines"),
    title: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    responsibleId: v.optional(v.id("users")),
    reminderDaysBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const d = await ctx.db.get(args.deadlineId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Deadline not found.");
    if (d.matterId !== undefined) {
      await requireMatter(ctx, ac, d.matterId);
    }

    const changes: string[] = [];
    const patch: Partial<Doc<"deadlines">> = {};
    if (args.title !== undefined && args.title.trim()) {
      patch.title = args.title.trim();
      changes.push("title updated");
    }
    if (args.dueDate !== undefined) {
      const dueAt = endOfDayIST(args.dueDate);
      patch.dueAt = dueAt;
      patch.reminderAt =
        args.reminderDaysBefore !== undefined && args.reminderDaysBefore > 0
          ? dueAt - args.reminderDaysBefore * DAY_MS
          : d.reminderAt;
      changes.push(`due date set to ${args.dueDate}`);
    } else if (args.reminderDaysBefore !== undefined) {
      patch.reminderAt =
        args.reminderDaysBefore > 0
          ? d.dueAt - args.reminderDaysBefore * DAY_MS
          : undefined;
      changes.push(
        args.reminderDaysBefore > 0
          ? `reminder set ${args.reminderDaysBefore} day(s) before`
          : "reminder removed",
      );
    }
    if (args.responsibleId !== undefined) {
      const m = await loadAssignee(ctx, ac.org._id, args.responsibleId);
      assertActiveMember(m);
      patch.responsibleId = args.responsibleId;
      const u = await ctx.db.get(args.responsibleId);
      changes.push(`responsible set to ${u?.name ?? "member"}`);
    }

    await ctx.db.patch(args.deadlineId, {
      ...patch,
      history: [
        ...(d.history ?? []),
        { at: Date.now(), byId: ac.user._id, text: changes.join("; ") || "edited" },
      ],
    });

    if (d.matterId !== undefined && changes.length > 0) {
      await ctx.db.insert("matterEvents", {
        matterId: d.matterId,
        kind: "deadline",
        detail: `Deadline updated — ${patch.title ?? d.title}: ${changes.join("; ")}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "day",
      });
    }
  },
});

/** Complete a deadline (with note) — completion is audited. */
export const completeDeadline = mutation({
  args: { deadlineId: v.id("deadlines"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    const d = await ctx.db.get(args.deadlineId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Deadline not found.");
    if (d.matterId !== undefined) {
      await requireMatter(ctx, ac, d.matterId);
    } else if (
      !can(ac, "task.manage") &&
      d.responsibleId !== ac.user._id &&
      d.createdById !== ac.user._id
    ) {
      throw new Error("You can complete only deadlines you are responsible for.");
    }
    if (d.status === "completed") throw new Error("Already completed.");

    await ctx.db.patch(args.deadlineId, {
      status: "completed",
      completionNote: args.note?.trim() || undefined,
      completedAt: Date.now(),
      completedById: ac.user._id,
      history: [
        ...(d.history ?? []),
        {
          at: Date.now(),
          byId: ac.user._id,
          text: args.note?.trim()
            ? `Completed — ${args.note.trim()}`
            : "Completed.",
        },
      ],
    });

    if (d.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: d.matterId,
        kind: "deadline",
        detail: `Deadline completed — ${d.title}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "day",
      });
    }
  },
});

/** Reopen a completed deadline — audited. */
export const reopenDeadline = mutation({
  args: { deadlineId: v.id("deadlines"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const d = await ctx.db.get(args.deadlineId);
    if (!d || d.orgId !== ac.org._id) throw new Error("Deadline not found.");
    if (d.matterId !== undefined) {
      await requireMatter(ctx, ac, d.matterId);
    }

    await ctx.db.patch(args.deadlineId, {
      status: "open",
      completionNote: undefined,
      completedAt: undefined,
      completedById: undefined,
      history: [
        ...(d.history ?? []),
        {
          at: Date.now(),
          byId: ac.user._id,
          text: `Reopened${args.reason?.trim() ? ` — ${args.reason.trim()}` : "."}`,
        },
      ],
    });

    if (d.matterId !== undefined) {
      await ctx.db.insert("matterEvents", {
        matterId: d.matterId,
        kind: "deadline",
        detail: `Deadline reopened — ${d.title}.`,
        createdAt: Date.now(),
        authorId: ac.user._id,
        occurredAt: Date.now(),
        datePrecision: "day",
      });
    }
  },
});

// ---------------------------------------------------------------------
// Playbook mutations
// ---------------------------------------------------------------------

type StageInput = {
  name: string;
  tasks: {
    title: string;
    kind: (typeof TASK_KINDS)[number];
    daysFromStart?: number;
  }[];
  requiredDocuments: string[];
};

const stagesValidator = v.array(
  v.object({
    name: v.string(),
    tasks: v.array(
      v.object({
        title: v.string(),
        kind: v.union(...TASK_KINDS.map((k) => v.literal(k))),
        daysFromStart: v.optional(v.number()),
      }),
    ),
    requiredDocuments: v.array(v.string()),
  }),
);

function assertStages(stages: StageInput[]) {
  if (stages.length === 0) throw new Error("Add at least one stage.");
  for (const s of stages) {
    if (!s.name.trim()) throw new Error("Every stage needs a name.");
    for (const t of s.tasks) {
      if (!t.title.trim()) {
        throw new Error(`A task in stage “${s.name}” is missing its title.`);
      }
    }
  }
}

/** Create a playbook template. */
export const createPlaybook = mutation({
  args: {
    name: v.string(),
    matterType: v.string(),
    description: v.optional(v.string()),
    stages: stagesValidator,
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    if (!args.name.trim()) throw new Error("Name the playbook.");
    if (!args.matterType.trim()) {
      throw new Error("Say which matter type the playbook is for.");
    }
    assertStages(args.stages);

    const playbookId = await ctx.db.insert("playbooks", {
      orgId: ac.org._id,
      name: args.name.trim(),
      matterType: args.matterType.trim(),
      description: args.description?.trim() || undefined,
      currentVersion: 1,
      createdById: ac.user._id,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("playbookVersions", {
      playbookId,
      version: 1,
      stages: args.stages,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    return { playbookId };
  },
});

/** Save a new version of a playbook — history is preserved. */
export const updatePlaybook = mutation({
  args: {
    playbookId: v.id("playbooks"),
    name: v.optional(v.string()),
    matterType: v.optional(v.string()),
    description: v.optional(v.string()),
    stages: stagesValidator,
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    const p = await ctx.db.get(args.playbookId);
    if (!p || p.orgId !== ac.org._id) throw new Error("Playbook not found.");
    assertStages(args.stages);

    const nextVersion = p.currentVersion + 1;
    await ctx.db.patch(args.playbookId, {
      name: args.name?.trim() || p.name,
      matterType: args.matterType?.trim() || p.matterType,
      description: args.description?.trim() || p.description,
      currentVersion: nextVersion,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("playbookVersions", {
      playbookId: p._id,
      version: nextVersion,
      stages: args.stages,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
  },
});

/**
 * Apply a playbook to a matter. Tasks and deadlines are created as
 * copies from the template — the matter's own records are never
 * relinked to the template. Dates the chamber confirms in the dialog
 * become deadlines; anything not confirmed is skipped. The system
 * performs no legal-deadline calculation of its own.
 */
export const applyPlaybook = mutation({
  args: {
    playbookId: v.id("playbooks"),
    matterId: v.id("matters"),
    startOn: v.string(), // YYYY-MM-DD — the confirmed start date
    /** One confirmation per template deadline, index-aligned with collected dates. */
    deadlineTitles: v.array(v.string()),
    deadlineDates: v.array(v.string()), // YYYY-MM-DD, same length
    deadlineCategories: v.array(
      v.union(...DEADLINE_CATEGORIES.map((c) => v.literal(c))),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "task.manage");
    await requireMatter(ctx, ac, args.matterId);
    const p = await ctx.db.get(args.playbookId);
    if (!p || p.orgId !== ac.org._id) throw new Error("Playbook not found.");
    const version = await ctx.db
      .query("playbookVersions")
      .withIndex("by_playbook", (q) => q.eq("playbookId", p._id))
      .collect();
    const current = version.find((x) => x.version === p.currentVersion);
    if (!current) throw new Error("That playbook has no usable version.");

    if (
      args.deadlineTitles.length !== args.deadlineDates.length ||
      args.deadlineTitles.length !== args.deadlineCategories.length
    ) {
      throw new Error("Deadline confirmations are incomplete.");
    }
    for (const date of args.deadlineDates) {
      if (date) endOfDayIST(date); // validates format
    }

    const startMs = endOfDayIST(args.startOn) - 23 * 60 * 60 * 1000 + 1; // local start of day
    const createdTaskIds: Id<"tasks">[] = [];
    const createdDeadlineIds: Id<"deadlines">[] = [];

    for (const stage of current.stages) {
      for (const t of stage.tasks) {
        const dueAt =
          t.daysFromStart !== undefined
            ? startMs + t.daysFromStart * DAY_MS
            : undefined;
        const taskId = await ctx.db.insert("tasks", {
          matterId: args.matterId,
          orgId: ac.org._id,
          title: `${stage.name} — ${t.title.trim()}`,
          kind: t.kind,
          priority: "normal",
          dueAt,
          status: "pending",
          assigneeId: ac.user._id,
          createdById: ac.user._id,
          createdAt: Date.now(),
        });
        createdTaskIds.push(taskId);
      }
    }

    // Only human-confirmed dates become deadlines.
    for (let i = 0; i < args.deadlineTitles.length; i++) {
      const title = args.deadlineTitles[i]!.trim();
      const date = args.deadlineDates[i]!.trim();
      const category = args.deadlineCategories[i]!;
      if (!title || !date) continue;
      const deadlineId = await ctx.db.insert("deadlines", {
        orgId: ac.org._id,
        matterId: args.matterId,
        title,
        category,
        dueAt: endOfDayIST(date),
        status: "open",
        responsibleId: ac.user._id,
        createdById: ac.user._id,
        history: [
          {
            at: Date.now(),
            byId: ac.user._id,
            text: `Recorded on applying playbook “${p.name}” v${p.currentVersion}.`,
          },
        ],
        createdAt: Date.now(),
      });
      createdDeadlineIds.push(deadlineId);
    }

    await ctx.db.insert("playbookRuns", {
      playbookId: p._id,
      playbookVersion: p.currentVersion,
      matterId: args.matterId,
      appliedById: ac.user._id,
      appliedAt: Date.now(),
      createdTaskIds,
      createdDeadlineIds,
    });

    await ctx.db.insert("matterEvents", {
      matterId: args.matterId,
      kind: "note",
      detail: `Playbook “${p.name}” (v${p.currentVersion}) applied — ${createdTaskIds.length} task(s), ${createdDeadlineIds.length} deadline(s) created.`,
      createdAt: Date.now(),
      authorId: ac.user._id,
      occurredAt: Date.now(),
      datePrecision: "exact",
    });

    return { taskCount: createdTaskIds.length, deadlineCount: createdDeadlineIds.length };
  },
});
