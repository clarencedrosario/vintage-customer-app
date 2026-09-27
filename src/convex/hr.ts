import { v } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  requireAccess,
  requireCapability,
  type AccessContext,
} from "./access";
import { canViewSalaryRecord } from "./accessPolicy";
import { logUserAction } from "./auditLogger";
import {
  decrementBalance,
  leaveApplicationError,
  unpaidDaysFor,
  type LeaveBalance,
} from "../lib/hrLeave";

// ===============================================================
// HR prerequisites (Feature 8). Tables live in schemaExtras.hrTables;
// payroll builds on these in the next slice. Rules enforced here:
// - Salary and statutory-ID fields are stripped from every read unless
//   canViewSalaryRecord grants it (org match + hr.view_salary or self
//   via hr.view_own). Role is never a bypass. Pre-onboarding rows with
//   no linked user are only visible with hr.view_salary.
// - Leave approvals need hr.approve; balances go through the pure,
//   unit-tested hrLeave helpers and can never go negative. Unpaid
//   excess is frozen onto the approval as LOP days for payroll.
// - statutorySettings rows are effective-dated and versioned. Specs
//   are validated per kind for internal consistency — but contain NO
//   rates invented by this codebase; operators enter verified values,
//   and payroll (later slice) refuses to run while required kinds are
//   absent.
// ===============================================================

type EmployeeDoc = Doc<"employees">;

// ---------------------------------------------------------------------
// Employee reads with salary stripping
// ---------------------------------------------------------------------

/**
 * Strip sensitive fields unless the viewer is permitted. Rows with no
 * linked user can never be "own" records — only an hr.view_salary
 * holder may see their compensation fields.
 */
function stripEmployee(
  ac: AccessContext,
  e: EmployeeDoc,
): EmployeeDoc & { salaryVisible: boolean } {
  const visible = e.userId
    ? canViewSalaryRecord(ac, e.orgId, e.userId)
    : can(ac, "hr.view_salary");
  if (visible) return { ...e, salaryVisible: true };
  return {
    ...e,
    monthlyGrossPaise: undefined,
    pan: undefined,
    uan: undefined,
    esiNumber: undefined,
    bankAccountLast4: undefined,
    bankIfsc: undefined,
    salaryVisible: false,
  };
}

/** All employees for the org. Sensitive fields stripped per record. */
export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
      .map((e) => stripEmployee(ac, e));
  },
});

/** One employee. Salary fields stripped unless permitted. */
export const getEmployee = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    const e = await ctx.db.get(args.employeeId);
    if (!e || e.orgId !== ac.org._id)
      throw new Error("Employee not found.");
    return stripEmployee(ac, e);
  },
});

// ---------------------------------------------------------------------
// Employee / department writes (hr.manage)
// ---------------------------------------------------------------------

export const upsertEmployee = mutation({
  args: {
    employeeId: v.optional(v.id("employees")),
    employeeCode: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    workEmail: v.optional(v.string()),
    workPhone: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    branch: v.optional(v.string()),
    designation: v.string(),
    employmentType: v.union(
      v.literal("partner"),
      v.literal("permanent"),
      v.literal("contract"),
      v.literal("intern"),
      v.literal("consultant"),
      v.literal("support"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("probation"),
      v.literal("notice_period"),
      v.literal("suspended"),
      v.literal("resigned"),
      v.literal("offboarded"),
      v.literal("rejected_offer"),
    ),
    dateOfJoining: v.string(), // YYYY-MM-DD
    probationEndDate: v.optional(v.string()),
    dateOfLeaving: v.optional(v.string()),
    reportingManagerId: v.optional(v.id("users")),
    monthlyGrossPaise: v.optional(v.number()),
    pan: v.optional(v.string()),
    uan: v.optional(v.string()),
    esiNumber: v.optional(v.string()),
    bankAccountLast4: v.optional(v.string()),
    bankIfsc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.manage");

    const code = args.employeeCode.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,16}$/.test(code))
      throw new Error("Employee code must be 2–16 letters/digits/dashes.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dateOfJoining))
      throw new Error("Date of joining must be YYYY-MM-DD.");
    if (
      args.monthlyGrossPaise !== undefined &&
      (!Number.isInteger(args.monthlyGrossPaise) || args.monthlyGrossPaise < 0)
    )
      throw new Error("Monthly gross must be a whole number of paise.");
    if (args.bankAccountLast4 && !/^\d{4}$/.test(args.bankAccountLast4))
      throw new Error("Bank account must be the LAST 4 digits only.");
    if (args.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(args.pan.trim().toUpperCase()))
      throw new Error("PAN must look like ABCDE1234F (or be left blank).");

    const all = await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    if (all.some((r) => r.employeeCode === code && r._id !== args.employeeId))
      throw new Error(`Employee code ${code} is already in use.`);

    const fields = {
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      workEmail: args.workEmail?.trim() || undefined,
      workPhone: args.workPhone?.trim() || undefined,
      departmentId: args.departmentId,
      branch: args.branch?.trim() || undefined,
      designation: args.designation.trim(),
      employmentType: args.employmentType,
      status: args.status,
      dateOfJoining: args.dateOfJoining,
      probationEndDate: args.probationEndDate,
      dateOfLeaving: args.dateOfLeaving,
      reportingManagerId: args.reportingManagerId,
      monthlyGrossPaise: args.monthlyGrossPaise,
      pan: args.pan?.trim().toUpperCase() || undefined,
      uan: args.uan?.trim() || undefined,
      esiNumber: args.esiNumber?.trim() || undefined,
      bankAccountLast4: args.bankAccountLast4,
      bankIfsc: args.bankIfsc?.trim().toUpperCase() || undefined,
    };
    const now = Date.now();

    if (args.employeeId) {
      const existing = await ctx.db.get(args.employeeId);
      if (!existing || existing.orgId !== ac.org._id)
        throw new Error("Employee not found.");
      await ctx.db.patch(args.employeeId, {
        ...fields,
        employeeCode: code,
        updatedAt: now,
      });
      await logUserAction(ctx, {
        userId: ac.user._id,
        organizationId: ac.org._id,
        actionType: "hr.employee_updated",
        resourceId: args.employeeId,
      });
      return args.employeeId;
    }

    const id = await ctx.db.insert("employees", {
      orgId: ac.org._id,
      userId: undefined, // linked later via invite/onboarding
      employeeCode: code,
      ...fields,
      createdById: ac.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.employee_created",
      resourceId: id,
    });
    return id;
  },
});

/** Link a login account to an employee record (hr.manage). */
export const linkEmployeeUser = mutation({
  args: {
    employeeId: v.id("employees"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.manage");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.orgId !== ac.org._id)
      throw new Error("Employee not found.");
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (rows.some((r) => r.orgId === ac.org._id && r._id !== args.employeeId))
      throw new Error("That user already has an employee record here.");
    await ctx.db.patch(args.employeeId, {
      userId: args.userId,
      updatedAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.employee_user_linked",
      resourceId: args.employeeId,
    });
  },
});

export const addDepartment = mutation({
  args: { name: v.string(), headUserId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.manage");
    const name = args.name.trim();
    if (!name) throw new Error("Department name is required.");
    const existing = await ctx.db
      .query("departments")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Department "${name}" already exists.`);
    const id = await ctx.db.insert("departments", {
      orgId: ac.org._id,
      name,
      headUserId: args.headUserId,
      active: true,
      createdAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.department_added",
      resourceId: id,
    });
    return id;
  },
});

export const listDepartments = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    return await ctx.db
      .query("departments")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
  },
});

// ---------------------------------------------------------------------
// Leave profiles (org policy — NOT statutory rates)
// ---------------------------------------------------------------------

export const saveLeaveProfile = mutation({
  args: {
    profileId: v.optional(v.id("leaveProfiles")),
    name: v.string(),
    rules: v.array(
      v.object({
        leaveType: v.string(),
        accrual: v.union(
          v.literal("per_month"),
          v.literal("annual"),
          v.literal("fixed"),
        ),
        days: v.number(),
        carryForwardCap: v.optional(v.number()),
      }),
    ),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.manage");
    if (args.rules.length === 0)
      throw new Error("A leave profile needs at least one rule.");
    const seen = new Set<string>();
    for (const r of args.rules) {
      const t = r.leaveType.trim().toLowerCase();
      if (!t) throw new Error("Leave type is required.");
      if (seen.has(t)) throw new Error(`Duplicate leave type: ${t}.`);
      seen.add(t);
      if (!Number.isFinite(r.days) || r.days <= 0)
        throw new Error("Accrual days must be positive.");
    }
    const rules = args.rules.map((r) => ({
      ...r,
      leaveType: r.leaveType.trim().toLowerCase(),
    }));
    const now = Date.now();
    if (args.profileId) {
      const existing = await ctx.db.get(args.profileId);
      if (!existing || existing.orgId !== ac.org._id)
        throw new Error("Leave profile not found.");
      await ctx.db.patch(args.profileId, {
        name: args.name.trim(),
        rules,
        active: args.active,
      });
      await logUserAction(ctx, {
        userId: ac.user._id,
        organizationId: ac.org._id,
        actionType: "hr.leave_profile_updated",
        resourceId: args.profileId,
      });
      return args.profileId;
    }
    const id = await ctx.db.insert("leaveProfiles", {
      orgId: ac.org._id,
      name: args.name.trim(),
      rules,
      active: args.active,
      createdById: ac.user._id,
      createdAt: now,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.leave_profile_created",
      resourceId: id,
    });
    return id;
  },
});

export const listLeaveProfiles = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    return await ctx.db
      .query("leaveProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
  },
});

// ---------------------------------------------------------------------
// Leave: apply → decide (hr.approve) → taken (balance decrements)
// ---------------------------------------------------------------------

/** Find the employee row for a user in the org, if one exists. */
async function employeeForUser(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<EmployeeDoc | null> {
  const rows = await ctx.db
    .query("employees")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows.find((r) => r.orgId === orgId) ?? null;
}

export const applyLeave = mutation({
  args: {
    employeeId: v.optional(v.id("employees")), // hr.manage may file for others
    leaveType: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    days: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");

    let employee: EmployeeDoc | null;
    if (args.employeeId) {
      // Filing for someone else requires hr.manage.
      requireCapability(ac, "hr.manage");
      employee = await ctx.db.get(args.employeeId);
      if (!employee || employee.orgId !== ac.org._id)
        throw new Error("Employee not found.");
    } else {
      employee = await employeeForUser(ctx, ac.org._id, ac.user._id);
      if (!employee)
        throw new Error(
          "No employee record is linked to your account — ask HR to create one.",
        );
    }
    if (
      employee.status === "resigned" ||
      employee.status === "offboarded" ||
      employee.status === "rejected_offer"
    )
      throw new Error("Leave cannot be filed for a separated employee.");

    const leaveType = args.leaveType.trim().toLowerCase();
    const problem = leaveApplicationError({
      startDate: args.startDate,
      endDate: args.endDate,
      days: args.days,
    });
    if (problem) throw new Error(problem);

    const id = await ctx.db.insert("leaveRequests", {
      orgId: ac.org._id,
      employeeId: employee._id,
      applicantUserId: ac.user._id,
      leaveType,
      startDate: args.startDate,
      endDate: args.endDate,
      days: args.days,
      reason: args.reason?.trim() || undefined,
      status: "pending",
      createdAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.leave_applied",
      resourceId: id,
    });
    return id;
  },
});

/**
 * Approve or reject a pending request (hr.approve). On approval the
 * unpaid excess over the current balance is frozen onto the row as
 * `unpaidDays` (LOP for payroll); balances decrement only when the
 * leave is later marked taken.
 */
export const decideLeave = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.approve");

    const req = await ctx.db.get(args.leaveRequestId);
    if (!req || req.orgId !== ac.org._id)
      throw new Error("Leave request not found.");
    if (req.status !== "pending")
      throw new Error(
        `Only a pending request can be decided (this one is ${req.status}).`,
      );

    const decision = {
      decidedAt: Date.now(),
      decidedById: ac.user._id,
      decidedByName: ac.user.name ?? ac.user.email ?? "Member",
      decisionNote: args.note?.trim() || undefined,
    };

    if (!args.approve) {
      await ctx.db.patch(req._id, {
        status: "rejected",
        ...decision,
      });
      await logUserAction(ctx, {
        userId: ac.user._id,
        organizationId: ac.org._id,
        actionType: "hr.leave_rejected",
        resourceId: req._id,
      });
      return { status: "rejected" as const, unpaidDays: 0 };
    }

    const employee = await ctx.db.get(req.employeeId);
    if (!employee) throw new Error("The employee record no longer exists.");
    const unpaidDays = unpaidDaysFor(
      employee.leaveBalances,
      req.leaveType,
      req.days,
    );
    await ctx.db.patch(req._id, {
      status: "approved",
      unpaidDays,
      ...decision,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.leave_approved",
      resourceId: req._id,
    });
    return { status: "approved" as const, unpaidDays };
  },
});

/** Mark an approved leave as taken — the only path that touches balances. */
export const markLeaveTaken = mutation({
  args: { leaveRequestId: v.id("leaveRequests") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.approve");

    const req = await ctx.db.get(args.leaveRequestId);
    if (!req || req.orgId !== ac.org._id)
      throw new Error("Leave request not found.");
    if (req.status !== "approved")
      throw new Error("Only an approved leave can be marked taken.");

    const employee = await ctx.db.get(req.employeeId);
    if (!employee) throw new Error("The employee record no longer exists.");

    // The approval froze the LOP split; the balance only ever loses the
    // paid part, and the pure helper refuses to overdraw.
    const paidDays = req.days - (req.unpaidDays ?? 0);
    let balances: LeaveBalance[] = employee.leaveBalances ?? [];
    if (paidDays > 0) {
      balances = decrementBalance(balances, req.leaveType, paidDays, req.endDate);
    }

    await ctx.db.patch(employee._id, {
      leaveBalances: balances,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(req._id, { status: "taken" });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.leave_taken",
      resourceId: req._id,
    });
    return { paidDays, unpaidDays: req.unpaidDays ?? 0 };
  },
});

export const cancelLeave = mutation({
  args: {
    leaveRequestId: v.id("leaveRequests"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");

    const req = await ctx.db.get(args.leaveRequestId);
    if (!req || req.orgId !== ac.org._id)
      throw new Error("Leave request not found.");

    const isSelf = req.applicantUserId === ac.user._id;
    if (!isSelf) requireCapability(ac, "hr.approve");
    if (req.status === "taken")
      throw new Error(
        "A taken leave cannot be cancelled — raise a correction instead.",
      );
    if (req.status === "cancelled" || req.status === "rejected")
      throw new Error("This request is already closed.");

    await ctx.db.patch(req._id, {
      status: "cancelled",
      decidedAt: Date.now(),
      decidedById: ac.user._id,
      decidedByName: ac.user.name ?? ac.user.email ?? "Member",
      decisionNote: args.note?.trim() || undefined,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.leave_cancelled",
      resourceId: req._id,
    });
  },
});

export const listLeaveRequests = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("taken"),
        v.literal("rejected"),
        v.literal("cancelled"),
      ),
    ),
    mine: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const visible = args.mine
      ? rows.filter((r) => r.applicantUserId === ac.user._id)
      : rows;
    return visible
      .filter((r) => !args.status || r.status === args.status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200);
  },
});

// ---------------------------------------------------------------------
// Attendance (single source of truth for attendance-based LOP)
// ---------------------------------------------------------------------

export const markAttendance = mutation({
  args: {
    employeeId: v.id("employees"),
    date: v.string(), // YYYY-MM-DD
    status: v.union(
      v.literal("present"),
      v.literal("absent"),
      v.literal("half_day"),
      v.literal("leave"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.manage");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date))
      throw new Error("Date must be YYYY-MM-DD.");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.orgId !== ac.org._id)
      throw new Error("Employee not found.");

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_org_date", (q) =>
        q.eq("orgId", ac.org._id).eq("date", args.date),
      )
      .collect()
      .then((rows) => rows.find((r) => r.employeeId === args.employeeId));

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        note: args.note?.trim() || undefined,
        markedById: ac.user._id,
        updatedAt: now,
      });
      return existing._id;
    }
    const id = await ctx.db.insert("attendance", {
      orgId: ac.org._id,
      employeeId: args.employeeId,
      date: args.date,
      status: args.status,
      source: "manual",
      note: args.note?.trim() || undefined,
      markedById: ac.user._id,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const listAttendanceForDay = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date))
      throw new Error("Date must be YYYY-MM-DD.");
    return await ctx.db
      .query("attendance")
      .withIndex("by_org_date", (q) =>
        q.eq("orgId", ac.org._id).eq("date", args.date),
      )
      .collect();
  },
});

// ---------------------------------------------------------------------
// Statutory settings — effective-dated, versioned, spec-validated.
// NO rates ship in code: operators enter verified values per employer.
// ---------------------------------------------------------------------

/**
 * Per-kind spec validation. These checks enforce internal consistency
 * (types, bounds, layer ordering) — they never supply default values.
 * Each employer configures their own registrations, states and rates.
 */
export function validateStatutorySpec(
  kind: Doc<"statutorySettings">["kind"],
  spec: unknown,
): string | null {
  if (typeof spec !== "object" || spec === null)
    return "Statutory spec must be an object.";
  const s = spec as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const nonNeg = (x: unknown, label: string, max?: number): string | null => {
    const n = num(x);
    if (n === null || n < 0) return `${label} must be a non-negative number.`;
    if (max !== undefined && n > max)
      return `${label} must be at most ${max} bps.`;
    return null;
  };

  switch (kind) {
    case "pf": {
      const err0 = nonNeg(s.wageCeilingPaise, "PF: wageCeilingPaise");
      if (err0) return err0;
      const err1 = nonNeg(s.employeeRateBps, "PF: employeeRateBps", 10000);
      if (err1) return err1;
      const err2 = nonNeg(s.employerRateBps, "PF: employerRateBps", 20000);
      if (err2) return err2;
      const err3 =
        s.employerRateEdliBps !== undefined
          ? nonNeg(s.employerRateEdliBps, "PF: employerRateEdliBps", 10000)
          : null;
      if (err3) return err3;
      return null;
    }
    case "esi": {
      const err0 = nonNeg(s.wageCeilingPaise, "ESI: wageCeilingPaise");
      if (err0) return err0;
      const err1 = nonNeg(s.employeeRateBps, "ESI: employeeRateBps", 10000);
      if (err1) return err1;
      const err2 = nonNeg(s.employerRateBps, "ESI: employerRateBps", 20000);
      if (err2) return err2;
      return null;
    }
    case "pt": {
      if (typeof s.stateCode !== "string" || !s.stateCode.trim())
        return "PT: stateCode is required (PT is state-specific).";
      if (!Array.isArray(s.stateSlabs) || s.stateSlabs.length === 0)
        return "PT: stateSlabs must list at least one slab for the registered state.";
      for (const slab of s.stateSlabs as unknown[]) {
        if (typeof slab !== "object" || slab === null)
          return "PT: each slab must be an object.";
        const sl = slab as Record<string, unknown>;
        const above = num(sl.incomeAbovePaise);
        if (above === null) return "PT: each slab needs incomeAbovePaise.";
        const taxErr = nonNeg(sl.taxPaise, "PT: slab taxPaise");
        if (taxErr) return taxErr;
      }
      return null;
    }
    case "tds": {
      if (typeof s.section !== "string" || !s.section.trim())
        return "TDS: section is required (e.g. 194J / 192).";
      const rateErr = nonNeg(s.rateBps, "TDS: rateBps", 30000);
      if (rateErr) return rateErr;
      const thrErr =
        s.thresholdPaise !== undefined
          ? nonNeg(s.thresholdPaise, "TDS: thresholdPaise")
          : null;
      if (thrErr) return thrErr;
      return null;
    }
    case "lwf": {
      if (typeof s.stateCode !== "string" || !s.stateCode.trim())
        return "LWF: stateCode is required (LWF is state-specific).";
      const err1 = nonNeg(
        s.employeeContributionPaise,
        "LWF: employeeContributionPaise",
      );
      if (err1) return err1;
      const err2 = nonNeg(
        s.employerContributionPaise,
        "LWF: employerContributionPaise",
      );
      if (err2) return err2;
      return null;
    }
    case "gratuity": {
      const days = num(s.daysPerYear);
      if (days === null || days < 15)
        return "Gratuity: daysPerYear must be at least 15 (statutory minimum is 15).";
      const divisor = num(s.perDayBasisDivisor);
      if (divisor === null || divisor < 20)
        return "Gratuity: perDayBasisDivisor must be at least 20 (statutory basis is 26).";
      const yearsErr = nonNeg(s.eligibilityYears, "Gratuity: eligibilityYears");
      if (yearsErr) return yearsErr;
      return null;
    }
  }
}

export const saveStatutorySetting = mutation({
  args: {
    kind: v.union(
      v.literal("pf"),
      v.literal("esi"),
      v.literal("pt"),
      v.literal("tds"),
      v.literal("lwf"),
      v.literal("gratuity"),
    ),
    spec: v.any(),
    effectiveFrom: v.string(), // YYYY-MM-DD
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    // Configuring statutory values is a payroll/finance authority.
    requireCapability(ac, "payroll.run");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom))
      throw new Error("effectiveFrom must be YYYY-MM-DD.");

    const problem = validateStatutorySpec(args.kind, args.spec);
    if (problem) throw new Error(problem);

    // Versioned history: a new row supersedes (never edits) earlier ones.
    const prior = await ctx.db
      .query("statutorySettings")
      .withIndex("by_org_kind", (q) =>
        q.eq("orgId", ac.org._id).eq("kind", args.kind),
      )
      .collect();
    const openPrior = prior
      .filter((p) => p.effectiveTo === undefined)
      .sort((a, b) => b.version - a.version)[0];
    const version = (prior.reduce((m, p) => Math.max(m, p.version), 0) ?? 0) + 1;

    const id = await ctx.db.insert("statutorySettings", {
      orgId: ac.org._id,
      kind: args.kind,
      spec: args.spec,
      version,
      effectiveFrom: args.effectiveFrom,
      note: args.note?.trim() || undefined,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    if (openPrior) {
      // Close the superseded row the day before the new one begins.
      const [y, m, d] = args.effectiveFrom.split("-").map(Number);
      const prevDay = new Date(Date.UTC(y!, m! - 1, d!) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await ctx.db.patch(openPrior._id, { effectiveTo: prevDay });
    }
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "hr.statutory_saved",
      resourceId: id,
    });
    return id;
  },
});

/** Version history for statutory settings (optionally one kind). */
export const listStatutorySettings = query({
  args: {
    kind: v.optional(
      v.union(
        v.literal("pf"),
        v.literal("esi"),
        v.literal("pt"),
        v.literal("tds"),
        v.literal("lwf"),
        v.literal("gratuity"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    const rows = await ctx.db
      .query("statutorySettings")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return rows
      .filter((r) => !args.kind || r.kind === args.kind)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  },
});

/**
 * Prerequisite report for the payroll module: which statutory kinds the
 * org has configured (with currently-effective versions), and which are
 * missing. Payroll refuses to run while required kinds are missing —
 * nothing is invented. Visible to payroll.run or finance.view holders.
 */
export const payrollPrerequisites = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    if (!can(ac, "payroll.run") && !can(ac, "finance.view"))
      throw new Error(
        "Your role is not permitted to do this (payroll.run / finance.view).",
      );
    const rows = await ctx.db
      .query("statutorySettings")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const today = new Date().toISOString().slice(0, 10);
    const kinds = ["pf", "esi", "pt", "tds", "lwf", "gratuity"] as const;
    const statutory = kinds.map((k) => {
      const effective = rows
        .filter(
          (r) =>
            r.kind === k &&
            r.effectiveFrom <= today &&
            (r.effectiveTo === undefined || r.effectiveTo >= today),
        )
        .sort((a, b) => b.version - a.version)[0];
      return {
        kind: k,
        configured: effective !== undefined,
        currentVersion: effective?.version,
        effectiveFrom: effective?.effectiveFrom,
      };
    });
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    return {
      statutory,
      missingKinds: statutory.filter((c) => !c.configured).map((c) => c.kind),
      employeeCount: employees.length,
      // Salary structures per employee arrive with the payroll slice;
      // that slice owns extending this report.
      employeesWithoutStructures: null as number | null,
    };
  },
});
