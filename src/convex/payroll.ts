import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  can,
  requireAccess,
  requireCapability,
  type AccessContext,
} from "./access";
import { canViewSalaryRecord } from "./accessPolicy";
import { logUserAction } from "./auditLogger";
import { journalValidationError, journalDedupeKey } from "../lib/accounting";
import {
  bankFileForRun,
  computeEmployeePayslip,
  payrollExpensePaise,
  payrollJournalPlan,
  runTotals,
  statutoryForEmployee,
  type EmployeeComputation,
  type PayslipDeduction,
  type PayslipEarning,
  type SalaryComponentLine,
  type StatutoryVersionRef,
} from "../lib/payrollMath";

// ===============================================================
// Payroll (Feature 9). Rules enforced here, building on the HR
// prerequisites module:
// - Salary structures are effective-dated rows; history is never
//   overwritten. Component amounts are integer paise. Reads of
//   compensation-bearing rows are gated by canViewSalaryRecord.
// - A run is created per (org, period) — the by_org_period index plus
//   an explicit existence check prevents duplicates. It freezes the
//   exact statutorySetting versions it used; later config edits never
//   alter a past run.
// - The state machine is draft → in_review → approved → finalized
//   (+ reversed). approve needs payroll.approve, finalize needs
//   finance.manage; the same actor may hold both, but the states are
//   still sequential and audited.
// - Bank-file generation and payment marking are deliberately separate
//   mutations: producing a transfer file is never "money moved".
// - Finalization posts a balanced journal or posts nothing — unmapped
//   statutory deductions refuse the run instead of being dropped.
// - Reversal is audited and mirrors the posted journal; finalized
//   runs are otherwise immutable.
// - NO statutory rates appear in this file. Everything is applied from
//   the org's own frozen specs; missing configuration surfaces as an
//   explicit refusal, never a default.
// ===============================================================

const PAYABLE_CODES = {
  pf: "2310",
  esi: "2311",
  pt: "2320",
  lwf: "2321",
  tds: "2300",
} as const;

const SALARY_EXPENSE_CODE = "5010"; // Salaries & Wages (seeded COA)
const BANK_CODE = "1000"; // Bank — Operating (seeded COA)

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type RunRow = Doc<"payrollRuns">;
type PayslipRow = Doc<"payslips">;

async function runForOrg(
  ctx: MutationCtx | QueryCtx,
  runId: Id<"payrollRuns">,
  orgId: Id<"organizations">,
): Promise<RunRow> {
  const run = await ctx.db.get(runId);
  if (!run || run.orgId !== orgId) throw new Error("Payroll run not found.");
  return run;
}

function assertTransition(run: RunRow, from: RunRow["status"], action: string) {
  if (run.status !== from)
    throw new Error(
      `Cannot ${action}: run is ${run.status}, expected ${from}.`,
    );
}

/** Salary-structure component validation. */
function validateComponents(
  monthlyPaise: unknown,
): string | null {
  if (!Array.isArray(monthlyPaise) || monthlyPaise.length === 0)
    return "A salary structure needs at least one component.";
  let earnings = 0;
  let deductions = 0;
  for (const c of monthlyPaise as unknown[]) {
    if (typeof c !== "object" || c === null)
      return "Each component must be an object.";
    const comp = c as Record<string, unknown>;
    if (typeof comp.component !== "string" || !comp.component.trim())
      return "Each component needs a name.";
    const amount = comp.amountPaise;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0)
      return "Component amounts must be whole non-negative paise.";
    if (comp.type !== "earning" && comp.type !== "deduction")
      return "Component type must be earning or deduction.";
    if (comp.type === "earning") earnings += amount;
    else deductions += amount;
  }
  if (earnings <= 0) return "A salary structure needs at least one earning.";
  if (deductions > earnings)
    return "Fixed deductions cannot exceed monthly earnings.";
  return null;
}

/**
 * Strip compensation-bearing fields unless the viewer is permitted —
 * mirrors hr.ts's stripEmployee for structure/payslip rows.
 */
function stripStructure(
  ac: AccessContext,
  row: Doc<"salaryStructures">,
  employee: Doc<"employees"> | null,
): Doc<"salaryStructures"> & { salaryVisible: boolean } {
  const visible = employee?.userId
    ? canViewSalaryRecord(ac, row.orgId, employee.userId)
    : can(ac, "hr.view_salary");
  if (visible) return { ...row, salaryVisible: true };
  return { ...row, monthlyPaise: [], salaryVisible: false };
}

function stripPayslip(
  ac: AccessContext,
  row: PayslipRow,
  employee: Doc<"employees"> | null,
): PayslipRow & { salaryVisible: boolean } {
  const visible = employee?.userId
    ? canViewSalaryRecord(ac, row.orgId, employee.userId)
    : can(ac, "hr.view_salary");
  if (visible) return { ...row, salaryVisible: true };
  return {
    ...row,
    earningsPaise: [],
    deductionsPaise: [],
    grossPaise: 0,
    netPaise: 0,
    salaryVisible: false,
  };
}

/** Resolve each required statutory kind to its frozen version row. */
async function freezeStatutoryVersions(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  kinds: readonly Doc<"statutorySettings">["kind"][],
): Promise<{
  versions: { id: Id<"statutorySettings">; ref: StatutoryVersionRef }[];
  missing: string[];
}> {
  const rows = await ctx.db
    .query("statutorySettings")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  const today = new Date().toISOString().slice(0, 10);
  const versions: { id: Id<"statutorySettings">; ref: StatutoryVersionRef }[] = [];
  const missing: string[] = [];
  for (const kind of kinds) {
    const effective = rows
      .filter(
        (r) =>
          r.kind === kind &&
          r.effectiveFrom <= today &&
          (r.effectiveTo === undefined || r.effectiveTo >= today),
      )
      .sort((a, b) => b.version - a.version)[0];
    if (!effective) {
      missing.push(kind);
      continue;
    }
    versions.push({
      id: effective._id,
      ref: {
        kind,
        version: effective.version,
        effectiveFrom: effective.effectiveFrom,
        effectiveTo: effective.effectiveTo,
        spec: effective.spec,
      },
    });
  }
  return { versions, missing };
}

/**
 * Compose every active employee's payslip for the period. LOP days
 * come from attendance rows (absent/half-day) recorded for the
 * period's calendar days — attendance is the single source of truth.
 */
async function computeRun(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  period: string,
  versions: { id: Id<"statutorySettings">; ref: StatutoryVersionRef }[],
): Promise<{
  rows: (EmployeeComputation & { employeeCode: string; name: string })[];
  skipped: { employeeId: string; code: string; reason: string }[];
}> {
  const employees = (
    await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  const periodPrefix = `${period}-`;
  const attendance = await ctx.db
    .query("attendance")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", periodPrefix))
    .collect();
  const inPeriod = attendance.filter((a) => a.date.startsWith(periodPrefix));

  const rows: (EmployeeComputation & { employeeCode: string; name: string })[] = [];
  const skipped: { employeeId: string; code: string; reason: string }[] = [];

  for (const e of employees) {
    if (
      e.status === "offboarded" ||
      e.status === "rejected_offer" ||
      e.status === "suspended"
    ) {
      skipped.push({ employeeId: e._id, code: e.employeeCode, reason: e.status });
      continue;
    }
    const structures = (
      await ctx.db
        .query("salaryStructures")
        .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
        .collect()
    ).map((s) => ({ effectiveFrom: s.effectiveFrom, monthlyPaise: s.monthlyPaise }));

    // LOP from attendance: absent = 1 day, half_day = 0.5.
    let lopDays = 0;
    for (const a of inPeriod) {
      if (a.employeeId !== e._id) continue;
      if (a.status === "absent") lopDays += 1;
      else if (a.status === "half_day") lopDays += 0.5;
    }
    // Approved-but-unpaid leave inside the period also costs pay.
    const leaveRows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
      .collect();
    let unpaidLeaveDays = 0;
    for (const l of leaveRows) {
      if (l.status !== "approved" && l.status !== "taken") continue;
      if (!(l.unpaidDays && l.unpaidDays > 0)) continue;
      if (l.startDate.startsWith(periodPrefix) || l.endDate.startsWith(periodPrefix))
        unpaidLeaveDays += l.unpaidDays;
    }

    try {
      const c = computeEmployeePayslip(
        {
          employeeId: e._id,
          structures,
          dateOfJoining: e.dateOfJoining,
          dateOfLeaving: e.dateOfLeaving,
          lopDays,
          unpaidLeaveDays,
        },
        period,
        versions.map((v) => v.ref),
        { userId: e.userId },
      );
      rows.push({
        ...c,
        employeeCode: e.employeeCode,
        name: `${e.firstName} ${e.lastName}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      skipped.push({ employeeId: e._id, code: e.employeeCode, reason: msg });
    }
  }
  return { rows, skipped };
}

/** Sum employer statutory additions across the run's frozen versions. */
function employerAdditionsPaise(
  rows: EmployeeComputation[],
  versions: StatutoryVersionRef[],
): { total: number; byKind: Record<string, number> } {
  const gross = rows.reduce((s, r) => s + r.grossPaise, 0);
  const stat = statutoryForEmployee(gross, versions);
  const byKind: Record<string, number> = {};
  let total = 0;
  if (stat.pf) {
    const add = stat.pf.employerPaise + stat.pf.edliPaise;
    if (add > 0) {
      byKind.pf = add;
      total += add;
    }
  }
  if (stat.esi) {
    if (stat.esi.employerPaise > 0) {
      byKind.esi = stat.esi.employerPaise;
      total += stat.esi.employerPaise;
    }
  }
  if (stat.lwf) {
    if (stat.lwf.employerPaise > 0) {
      byKind.lwf = stat.lwf.employerPaise;
      total += stat.lwf.employerPaise;
    }
  }
  return { total, byKind };
}

/**
 * Map a payslip deduction label to the statutory kind it represents,
 * for payable-account mapping and employer-addition matching.
 */
function deductionKind(label: string): "pf" | "esi" | "pt" | "lwf" | "tds" | null {
  const l = label.toLowerCase();
  if (l.includes("pf")) return "pf";
  if (l.includes("esi")) return "esi";
  if (l.includes("professional tax") || l === "pt") return "pt";
  if (l.includes("lwf")) return "lwf";
  if (l.includes("tds")) return "tds";
  return null;
}

/**
 * Build the balanced journal plan for a run. Refuses (returns an
 * error string) when any statutory deduction or employer addition is
 * unmapped — a payable without an account code cannot be posted, and
 * dropping it would understate real liabilities.
 */
function planForRun(
  rows: EmployeeComputation[],
  versions: StatutoryVersionRef[],
): { plan: ReturnType<typeof payrollJournalPlan>["plan"]; error?: string } {
  const gross = rows.reduce((s, r) => s + r.grossPaise, 0);
  const net = rows.reduce((s, r) => s + r.netPaise, 0);

  // Sum withheld employee deductions per kind; non-statutory labels
  // ride on the salary expense directly (they are already inside
  // gross − net arithmetic).
  const withheld = new Map<string, number>();
  for (const r of rows) {
    for (const d of r.deductions) {
      if (deductionKind(d.component)) {
        withheld.set(d.component, (withheld.get(d.component) ?? 0) + d.amountPaise);
      }
    }
  }

  const additions = employerAdditionsPaise(rows, versions);
  const payableLines: Parameters<typeof payrollJournalPlan>[3] = [];
  for (const [label, amount] of withheld) {
    const kind = deductionKind(label);
    const code = kind ? PAYABLE_CODES[kind] : undefined;
    payableLines.push({ label, amountPaise: amount, code });
  }

  const plan = payrollJournalPlan(
    gross,
    net,
    additions.total,
    payableLines,
    SALARY_EXPENSE_CODE,
    BANK_CODE,
  );
  if (plan.unmappedPaise > 0)
    return {
      plan: plan.plan,
      error: `Refusing to post: statutory payable(s) totalling ${plan.unmappedPaise}ₚ have no account mapping (expected codes ${Object.values(PAYABLE_CODES).join(", ")}). Configure the chart before finalizing.`,
    };

  // The debit must equal gross + employer additions exactly; any
  // mismatch means deductions were dropped somewhere — refuse.
  const expected = payrollExpensePaise(gross, additions.total);
  const debit = plan.plan.debits.reduce((s, l) => s + l.amountPaise, 0);
  if (debit !== expected)
    return {
      plan: plan.plan,
      error: `Journal would not balance: debit ${debit}ₚ ≠ expense ${expected}ₚ. Run refused.`,
    };

  return { plan: plan.plan };
}

// ---------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------

export const saveSalaryStructure = mutation({
  args: {
    employeeId: v.id("employees"),
    effectiveFrom: v.string(),
    monthlyPaise: v.array(
      v.object({
        component: v.string(),
        amountPaise: v.number(),
        type: v.union(v.literal("earning"), v.literal("deduction")),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveFrom))
      throw new Error("effectiveFrom must be YYYY-MM-DD.");
    const problem = validateComponents(args.monthlyPaise);
    if (problem) throw new Error(problem);
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.orgId !== ac.org._id)
      throw new Error("Employee not found.");

    // New structure = new row; existing rows are never edited.
    const id = await ctx.db.insert("salaryStructures", {
      orgId: ac.org._id,
      employeeId: args.employeeId,
      effectiveFrom: args.effectiveFrom,
      monthlyPaise: args.monthlyPaise,
      note: args.note?.trim().slice(0, 200) || undefined,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.structure_saved",
      resourceId: id,
    });
    return id;
  },
});

/** Structure history for one employee (newest first), salary-gated. */
export const listSalaryStructures = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "hr.view_own");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.orgId !== ac.org._id)
      throw new Error("Employee not found.");
    const rows = await ctx.db
      .query("salaryStructures")
      .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
      .collect();
    return rows
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
      .map((r) => stripStructure(ac, r, employee));
  },
});

// ---------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------

export const createRun = mutation({
  args: {
    period: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    if (!PERIOD_RE.test(args.period))
      throw new Error("Period must be YYYY-MM.");

    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_org_period", (q) =>
        q.eq("orgId", ac.org._id).eq("period", args.period),
      )
      .first();
    if (existing)
      throw new Error(
        `A payroll run for ${args.period} already exists (${existing.status}). Reuse or reverse it — duplicate runs are refused.`,
      );

    const kinds = ["pf", "esi", "pt", "tds", "lwf", "gratuity"] as const;
    const { versions, missing } = await freezeStatutoryVersions(ctx, ac.org._id, kinds);
    if (missing.length > 0)
      throw new Error(
        `Payroll cannot run: statutory setting(s) not configured for this period: ${missing.join(", ")}. Enter verified values first — none ship with the product.`,
      );

    const { rows, skipped } = await computeRun(
      ctx,
      ac.org._id,
      args.period,
      versions,
    );
    if (rows.length === 0)
      throw new Error(
        "No payroll rows could be computed: every employee was skipped or has no applicable salary structure. Fix structures before running.",
      );

    const totals = runTotals(rows);
    const runId = await ctx.db.insert("payrollRuns", {
      orgId: ac.org._id,
      period: args.period,
      status: "draft",
      grossPaise: totals.grossPaise,
      deductionsPaise: totals.deductionsPaise,
      netPaise: totals.netPaise,
      statutoryVersionIds: versions.map((v) => v.id),
      notes: args.notes?.trim().slice(0, 300) || undefined,
      createdById: ac.user._id,
      createdAt: Date.now(),
    });
    for (const r of rows) {
      await ctx.db.insert("payslips", {
        orgId: ac.org._id,
        runId,
        employeeId: r.employeeId as Id<"employees">,
        userId: r.userId as Id<"users"> | undefined,
        period: args.period,
        status: "preview",
        earningsPaise: r.earnings,
        deductionsPaise: r.deductions,
        grossPaise: r.grossPaise,
        netPaise: r.netPaise,
        lopDays: r.lopDays,
        unpaidLeaveDays: r.unpaidLeaveDays,
        createdAt: Date.now(),
      });
    }
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.run_created",
      resourceId: runId,
    });
    return {
      runId,
      totals,
      skipped,
      statutoryVersionIds: versions.map((v) => v.id),
    };
  },
});

/** One run with its payslips (salary-gated per row). */
export const getRun = query({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    const slips = (
      await ctx.db
        .query("payslips")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect()
    ).sort((a, b) => a.period.localeCompare(b.period));
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const byId = new Map(employees.map((e) => [e._id, e]));
    return {
      run,
      payslips: slips.map((s) =>
        stripPayslip(ac, s, byId.get(s.employeeId) ?? null),
      ),
    };
  },
});

export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    return await ctx.db
      .query("payrollRuns")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
  },
});

export const submitForReview = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    assertTransition(run, "draft", "submit for review");
    await ctx.db.patch(run._id, { status: "in_review" });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.run_submitted",
      resourceId: run._id,
    });
  },
});

export const approveRun = mutation({
  args: { runId: v.id("payrollRuns"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.approve");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    assertTransition(run, "in_review", "approve");
    await ctx.db.patch(run._id, {
      status: "approved",
      notes: args.note?.trim().slice(0, 300) || run.notes,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.run_approved",
      resourceId: run._id,
    });
  },
});

/**
 * Finalize: freezes payslip rows to `final` and posts the balanced
 * payroll journal (dedupe-keyed). Refuses while any statutory payable
 * is unmapped — nothing is dropped silently.
 */
export const finalizeRun = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    assertTransition(run, "approved", "finalize");
    if (!run.statutoryVersionIds || run.statutoryVersionIds.length === 0)
      throw new Error("Run has no frozen statutory versions — cannot finalize.");

    const slips = await ctx.db
      .query("payslips")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const versions: StatutoryVersionRef[] = [];
    for (const id of run.statutoryVersionIds) {
      const row = await ctx.db.get(id);
      if (!row) throw new Error("A frozen statutory setting row is missing.");
      versions.push({
        kind: row.kind,
        version: row.version,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        spec: row.spec,
      });
    }
    const comps: EmployeeComputation[] = slips.map((s) => ({
      employeeId: s.employeeId,
      earnings: s.earningsPaise,
      deductions: s.deductionsPaise,
      grossPaise: s.grossPaise,
      netPaise: s.netPaise,
      lopDays: s.lopDays ?? 0,
      unpaidLeaveDays: s.unpaidLeaveDays ?? 0,
    }));

    const { plan, error } = planForRun(comps, versions);
    if (error) throw new Error(error);

    // Resolve codes to org accounts; a missing seeded account is an
    // honest refusal — no guessed postings.
    const codeToId = new Map<string, Id<"accounts">>();
    for (const code of [
      SALARY_EXPENSE_CODE,
      BANK_CODE,
      ...plan.credits.map((c) => c.code),
    ]) {
      if (codeToId.has(code)) continue;
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
        .collect()
        .then((rows) => rows.find((r) => r.code === code && r.active));
      if (!acc)
        throw new Error(
          `Account ${code} is missing or inactive. Seed the chart of accounts before finalizing payroll.`,
        );
      codeToId.set(code, acc._id);
    }

    const dedupeKey = journalDedupeKey("payroll", run._id, "finalized");
    const dupe = await ctx.db
      .query("journalEntries")
      .withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey))
      .first();
    let journalEntryId = dupe?._id;
    if (!dupe) {
      const entryDate = new Date().toISOString().slice(0, 10);
      const balance = journalValidationError({
        debits: plan.debits.map((d) => ({
          accountId: codeToId.get(d.code)!,
          amountPaise: d.amountPaise,
        })),
        credits: plan.credits.map((c) => ({
          accountId: codeToId.get(c.code)!,
          amountPaise: c.amountPaise,
        })),
      });
      if (balance) throw new Error(balance);

      journalEntryId = await ctx.db.insert("journalEntries", {
        orgId: ac.org._id,
        entryDate,
        memo: `Payroll ${run.period} — ${comps.length} payslip(s)`,
        status: "posted",
        source: "payroll",
        sourceId: run._id,
        debits: plan.debits.map((d) => ({
          accountId: codeToId.get(d.code)!,
          amountPaise: d.amountPaise,
        })),
        credits: plan.credits.map((c) => ({
          accountId: codeToId.get(c.code)!,
          amountPaise: c.amountPaise,
        })),
        dedupeKey,
        createdById: ac.user._id,
        createdAt: Date.now(),
      });
    }

    for (const s of slips) {
      if (s.status !== "final") await ctx.db.patch(s._id, { status: "final" });
    }
    await ctx.db.patch(run._id, {
      status: "finalized",
      journalEntryId,
      finalizedAt: Date.now(),
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.run_finalized",
      resourceId: run._id,
    });
    return { journalEntryId };
  },
});

/**
 * Generate the bank transfer file. Deliberately separate from marking
 * payments: a produced file is not money moved. Requires hr.view_salary
 * — the file carries masked account details.
 */
export const generateBankFile = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    if (!can(ac, "hr.view_salary"))
      throw new Error("Bank-file generation needs hr.view_salary.");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    if (run.status !== "finalized" && run.status !== "approved")
      throw new Error(
        `Bank files are generated for approved or finalized runs only (run is ${run.status}).`,
      );
    if (run.bankFileContent)
      throw new Error("A bank file already exists for this run.");

    const slips = await ctx.db
      .query("payslips")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_org", (q) => q.eq("orgId", ac.org._id))
      .collect();
    const byId = new Map(employees.map((e) => [e._id, e]));
    const rows = slips
      .map((s) => {
        const e = byId.get(s.employeeId);
        return {
          employeeCode: e?.employeeCode ?? "UNKNOWN",
          name: e ? `${e.firstName} ${e.lastName}` : "Unknown",
          accountLast4: e?.bankAccountLast4,
          ifsc: e?.bankIfsc,
          netPaise: s.netPaise,
        };
      })
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

    const content = bankFileForRun(rows, run.period);
    await ctx.db.patch(run._id, {
      bankFileContent: content,
      bankFileGeneratedAt: Date.now(),
      bankFileGeneratedById: ac.user._id,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.bank_file_generated",
      resourceId: run._id,
    });
    return content;
  },
});

/**
 * Mark the run's payments as made AFTER the bank has been instructed.
 * Separate from generateBankFile by design.
 */
export const markPaymentsMade = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "payroll.run");
    const run = await runForOrg(ctx, args.runId, ac.org._id);
    if (run.status !== "finalized")
      throw new Error("Only finalized runs can be marked paid.");
    if (!run.bankFileContent)
      throw new Error(
        "Generate the bank file before marking payments — the file is the record of what was instructed.",
      );
    if (run.paymentsMarkedAt)
      throw new Error("Payments were already marked for this run.");
    await ctx.db.patch(run._id, {
      paymentsMarkedAt: Date.now(),
      paymentsMarkedById: ac.user._id,
    });
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.payments_marked",
      resourceId: run._id,
    });
  },
});

/**
 * Internal reversal core (no auth context — the caller must have
 * resolved the org). Shared by the operator mutation and future
 * scheduled corrections; checks the run belongs to the given org.
 */
export const reverseRunInternal = internalMutation({
  args: {
    runId: v.id("payrollRuns"),
    orgId: v.id("organizations"),
    reason: v.string(),
    actorId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Id<"journalEntries">> => {
    const run = await runForOrg(ctx, args.runId, args.orgId);
    if (run.status !== "finalized")
      throw new Error(
        run.status === "reversed"
          ? "This run is already reversed."
          : `Only finalized runs can be reversed (run is ${run.status}).`,
      );
    if (!run.journalEntryId) throw new Error("Run has no journal to reverse.");
    const journal = await ctx.db.get(run.journalEntryId);
    if (!journal) throw new Error("Run journal is missing.");
    if (journal.status === "reversed")
      throw new Error("The run's journal is already reversed.");

    const reversalId = await ctx.db.insert("journalEntries", {
      orgId: args.orgId,
      entryDate: new Date().toISOString().slice(0, 10),
      memo: `Reversal of payroll ${run.period}: ${args.reason.slice(0, 240)}`.slice(0, 300),
      status: "posted",
      source: "payroll",
      sourceId: run._id,
      debits: journal.credits,
      credits: journal.debits,
      reversalOfId: journal._id,
      createdById: args.actorId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(journal._id, { status: "reversed" });
    await ctx.db.patch(run._id, {
      status: "reversed",
      reversalEntryId: reversalId,
    });
    return reversalId;
  },
});

export const reverseRunByOperator = mutation({
  args: { runId: v.id("payrollRuns"), reason: v.string() },
  handler: async (ctx, args): Promise<Id<"journalEntries">> => {
    const ac = await requireAccess(ctx);
    requireCapability(ac, "finance.manage");
    const reason = args.reason.trim();
    if (reason.length < 3)
      throw new Error("A reversal reason is required (at least 3 characters).");
    const reversalId: Id<"journalEntries"> = await ctx.runMutation(
      internal.payroll.reverseRunInternal,
      {
        runId: args.runId,
        orgId: ac.org._id,
        reason,
        actorId: ac.user._id,
      },
    );
    await logUserAction(ctx, {
      userId: ac.user._id,
      organizationId: ac.org._id,
      actionType: "payroll.run_reversed",
      resourceId: args.runId,
    });
    return reversalId;
  },
});

// ---------------------------------------------------------------------
// Internal bridge used by tests/tools — kept honest and small.
// ---------------------------------------------------------------------

export const recomputeTotalsInternal = internalMutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, args) => {
    const slips = await ctx.db
      .query("payslips")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const comps: EmployeeComputation[] = slips.map((s) => ({
      employeeId: s.employeeId,
      earnings: s.earningsPaise,
      deductions: s.deductionsPaise,
      grossPaise: s.grossPaise,
      netPaise: s.netPaise,
      lopDays: s.lopDays ?? 0,
      unpaidLeaveDays: s.unpaidLeaveDays ?? 0,
    }));
    const totals = runTotals(comps);
    await ctx.db.patch(args.runId, totals);
    return totals;
  },
});
