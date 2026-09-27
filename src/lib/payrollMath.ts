/**
 * Payroll math — pure helpers shared by hr.ts (server) and the UI.
 *
 * Conventions (matching the codebase): money is integer paise; periods
 * are IST "YYYY-MM" strings; component arrays are small ordered lists;
 * NO statutory rates appear in this file — percentages arrive as basis
 * points from the org's own verified statutorySettings specs, and
 * computations only apply what those frozen specs say.
 *
 * Nothing touches Convex or I/O, so the unit suite exercises exactly
 * what the server runs.
 */

export type SalaryComponentLine = {
  component: string;
  amountPaise: number;
  type: "earning" | "deduction";
};

export type PayslipEarning = { component: string; amountPaise: number };
export type PayslipDeduction = { component: string; amountPaise: number };

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Calendar days in an IST "YYYY-MM" month. */
export function daysInPeriod(period: string): number {
  if (!PERIOD_RE.test(period))
    throw new Error("Period must be YYYY-MM.");
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** "2026-09" → "2026-09-01" (period start as an IST date string). */
export function periodStart(period: string): string {
  if (!PERIOD_RE.test(period)) throw new Error("Period must be YYYY-MM.");
  return `${period}-01`;
}

/** "2026-09" → "2026-09-30" (period end as an IST date string). */
export function periodEnd(period: string): string {
  if (!PERIOD_RE.test(period)) throw new Error("Period must be YYYY-MM.");
  return `${period}-${String(daysInPeriod(period)).padStart(2, "0")}`;
}

/**
 * Zero-drift proration: scale every component to the paid fraction of
 * the month. The first line absorbs the floor-division deficit so the
 * sum equals `grossPaidPaise` exactly (integer paise, never drifting).
 * Refuses an empty component list.
 */
export function prorateComponents(
  lines: PayslipEarning[],
  grossPaidPaise: number,
): PayslipEarning[] {
  if (!Number.isInteger(grossPaidPaise) || grossPaidPaise < 0)
    throw new Error("Paid amount must be a whole number of paise.");
  if (lines.length === 0)
    throw new Error("Proration needs at least one earning component.");
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (grossPaidPaise > total)
    throw new Error(
      `Paid amount ${grossPaidPaise}ₚ exceeds the monthly gross ${total}ₚ.`,
    );
  if (total === 0) return lines.map((l) => ({ ...l, amountPaise: 0 }));
  const scaled = lines.map((l) => ({
    ...l,
    amountPaise: Math.floor((l.amountPaise * grossPaidPaise) / total),
  }));
  let deficit = grossPaidPaise - scaled.reduce((s, l) => s + l.amountPaise, 0);
  for (const line of scaled) {
    if (deficit === 0) break;
    line.amountPaise += 1;
    deficit -= 1;
  }
  return scaled;
}

/**
 * LOP deduction for the period: gross × lopDays / calendarDays, floored
 * to whole paise (the employer's loss is rounded down; the employee is
 * never over-deducted by rounding).
 */
export function lopDeductionPaise(
  grossPaise: number,
  lopDays: number,
  calendarDays: number,
): number {
  if (!Number.isInteger(grossPaise) || grossPaise < 0)
    throw new Error("Gross must be a whole number of paise.");
  if (!Number.isFinite(lopDays) || lopDays < 0)
    throw new Error("LOP days must be non-negative.");
  if (!Number.isInteger(calendarDays) || calendarDays <= 0)
    throw new Error("Calendar days must be positive.");
  if (lopDays > calendarDays)
    throw new Error("LOP days cannot exceed the calendar days of the period.");
  return Math.floor((grossPaise * lopDays) / calendarDays);
}

export type StatutoryVersionRef = {
  kind: "pf" | "esi" | "pt" | "tds" | "lwf" | "gratuity";
  version: number;
  effectiveFrom: string;
  effectiveTo?: string;
  spec: unknown;
};

export type EmployeePayInput = {
  employeeId: string;
  /** Effective-dated component rows, newest effectiveFrom first. */
  structures: {
    effectiveFrom: string;
    monthlyPaise: SalaryComponentLine[];
  }[];
  dateOfJoining: string;
  dateOfLeaving?: string;
  /** Defaults to 0 when absent (e.g. preview-only call sites). */
  lopDays?: number;
  unpaidLeaveDays?: number;
};

/**
 * Structural pre-checks for one employee. Returns the frozen structure
 * or an explicit reason string — the run builder never invents a value
 * for a missing piece.
 */
export function structureForPeriod(
  employee: EmployeePayInput,
  period: string,
): { ok: true; structure: SalaryComponentLine[] } | { ok: false; reason: string } {
  const from = periodStart(period);
  if (employee.dateOfJoining > periodEnd(period))
    return { ok: false, reason: "not_joined_yet" };
  if (employee.dateOfLeaving && employee.dateOfLeaving < from)
    return { ok: false, reason: "left_before_period" };
  const applicable = employee.structures
    .filter((s) => s.effectiveFrom <= from)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!applicable)
    return { ok: false, reason: "no_salary_structure" };
  if (applicable.monthlyPaise.length === 0)
    return { ok: false, reason: "empty_salary_structure" };
  return { ok: true, structure: applicable.monthlyPaise };
}

/**
 * Per-employee statutory computation from the FROZEN spec versions the
 * run selected. Applies exactly what each present spec says:
 *  - pf: employee % of PF wages (min(gross, wageCeiling)), employer % +
 *    EDLI % recorded separately.
 *  - esi: employee % + employer % of ESI wages (min(gross, ceiling)).
 *  - pt: slab tax from stateSlabs (highest slab whose incomeAbove ≤ gross).
 *  - lwf: fixed employee/employer contributions.
 * Kinds absent from `versions` contribute nothing — the run gate has
 * already surfaced which kinds the org chose not to configure, and no
 * rate is ever invented here.
 */
export function statutoryForEmployee(
  grossPaidPaise: number,
  versions: StatutoryVersionRef[],
): {
  pf: { employeePaise: number; employerPaise: number; edliPaise: number } | null;
  esi: { employeePaise: number; employerPaise: number } | null;
  pt: { employeePaise: number } | null;
  lwf: { employeePaise: number; employerPaise: number } | null;
} {
  const wagesCapped = (gross: number, ceiling: unknown): number => {
    const c =
      typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling > 0
        ? ceiling
        : Infinity;
    return Math.min(gross, c);
  };
  const bps = (wages: number, rate: unknown): number => {
    const r =
      typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 0;
    return Math.floor((wages * r) / 10000);
  };

  const pf = versions.find((v) => v.kind === "pf");
  const esi = versions.find((v) => v.kind === "esi");
  const pt = versions.find((v) => v.kind === "pt");
  const lwf = versions.find((v) => v.kind === "lwf");

  let pfOut:
    | { employeePaise: number; employerPaise: number; edliPaise: number }
    | null = null;
  if (pf && typeof pf.spec === "object" && pf.spec !== null) {
    const s = pf.spec as Record<string, unknown>;
    const wages = wagesCapped(grossPaidPaise, s.wageCeilingPaise);
    pfOut = {
      employeePaise: bps(wages, s.employeeRateBps),
      employerPaise: bps(wages, s.employerRateBps),
      edliPaise: bps(wages, s.employerRateEdliBps),
    };
  }

  let esiOut: { employeePaise: number; employerPaise: number } | null = null;
  if (esi && typeof esi.spec === "object" && esi.spec !== null) {
    const s = esi.spec as Record<string, unknown>;
    const wages = wagesCapped(grossPaidPaise, s.wageCeilingPaise);
    esiOut = {
      employeePaise: bps(wages, s.employeeRateBps),
      employerPaise: bps(wages, s.employerRateBps),
    };
  }

  let ptOut: { employeePaise: number } | null = null;
  if (pt && typeof pt.spec === "object" && pt.spec !== null) {
    const s = pt.spec as Record<string, unknown>;
    if (Array.isArray(s.stateSlabs) && s.stateSlabs.length > 0) {
      const slabs = (s.stateSlabs as unknown[])
        .map((sl) =>
          typeof sl === "object" && sl !== null
            ? (sl as { incomeAbovePaise?: unknown; taxPaise?: unknown })
            : null,
        )
        .filter(
          (sl): sl is { incomeAbovePaise: number; taxPaise: number } =>
            sl !== null &&
            typeof sl.incomeAbovePaise === "number" &&
            Number.isFinite(sl.incomeAbovePaise) &&
            typeof sl.taxPaise === "number",
        )
        .map((sl) => ({ above: sl.incomeAbovePaise, tax: sl.taxPaise }))
        .sort((a, b) => a.above - b.above);
      const applicable = [...slabs]
        .reverse()
        .find((sl) => grossPaidPaise >= sl.above);
      ptOut = { employeePaise: Math.max(applicable ? applicable.tax : 0, 0) };
    }
  }

  let lwfOut: { employeePaise: number; employerPaise: number } | null = null;
  if (lwf && typeof lwf.spec === "object" && lwf.spec !== null) {
    const s = lwf.spec as Record<string, unknown>;
    const emp =
      typeof s.employeeContributionPaise === "number" &&
      Number.isFinite(s.employeeContributionPaise) &&
      s.employeeContributionPaise > 0
        ? s.employeeContributionPaise
        : 0;
    const er =
      typeof s.employerContributionPaise === "number" &&
      Number.isFinite(s.employerContributionPaise) &&
      s.employerContributionPaise > 0
        ? s.employerContributionPaise
        : 0;
    lwfOut = { employeePaise: emp, employerPaise: er };
  }

  return { pf: pfOut, esi: esiOut, pt: ptOut, lwf: lwfOut };
}

export type EmployeeComputation = {
  employeeId: string;
  userId?: string;
  earnings: PayslipEarning[];
  deductions: PayslipDeduction[];
  grossPaise: number;
  netPaise: number;
  lopDays: number;
  unpaidLeaveDays: number;
};

/**
 * One employee's period computation: prorated earnings for
 * joining/leaving months, LOP deduction, then the org's frozen
 * statutory contributions as deductions. Net is clamped at ≥ 0 and the
 * totals re-summed (never trusted from intermediate math).
 */
export function computeEmployeePayslip(
  employee: EmployeePayInput,
  period: string,
  versions: StatutoryVersionRef[],
  meta: { userId?: string },
): EmployeeComputation {
  const sel = structureForPeriod(employee, period);
  if (!sel.ok) throw new Error(`payroll:${sel.reason}:${employee.employeeId}`);
  const calendarDays = daysInPeriod(period);

  const grossMonthly = sel.structure
    .filter((c) => c.type === "earning")
    .reduce((s, c) => s + c.amountPaise, 0);
  const fixedDeductions = sel.structure
    .filter((c) => c.type === "deduction")
    .map((c) => ({ component: c.component, amountPaise: c.amountPaise }));

  // Prorate earnings when LOP shortens the paid month (join/leave
  // proration is expressed through the same LOP-day mechanism the
  // operator records — attendance is the source of truth). Fixed
  // deductions stay at their configured amounts: statutory levies like
  // PT are fixed per month, and recoveries are contractual — neither
  // scales up or down with attendance.
  const lop =
    Number.isFinite(employee.lopDays) && employee.lopDays! > 0
      ? employee.lopDays!
      : 0;
  const unpaid =
    Number.isFinite(employee.unpaidLeaveDays) && employee.unpaidLeaveDays! > 0
      ? employee.unpaidLeaveDays!
      : 0;
  const effectiveLopDays = Math.min(lop + unpaid, calendarDays);
  const grossPaid =
    effectiveLopDays === 0
      ? grossMonthly
      : grossMonthly -
        lopDeductionPaise(grossMonthly, effectiveLopDays, calendarDays);
  const earnings = prorateComponents(
    sel.structure
      .filter((c) => c.type === "earning")
      .map((c) => ({ component: c.component, amountPaise: c.amountPaise })),
    grossPaid,
  );

  const stat = statutoryForEmployee(grossPaid, versions);
  const deductions: PayslipDeduction[] = [...fixedDeductions];
  if (stat.pf && stat.pf.employeePaise > 0)
    deductions.push({ component: "PF (employee)", amountPaise: stat.pf.employeePaise });
  if (stat.esi && stat.esi.employeePaise > 0)
    deductions.push({ component: "ESI (employee)", amountPaise: stat.esi.employeePaise });
  if (stat.pt && stat.pt.employeePaise > 0)
    deductions.push({ component: "Professional Tax", amountPaise: stat.pt.employeePaise });
  if (stat.lwf && stat.lwf.employeePaise > 0)
    deductions.push({ component: "LWF (employee)", amountPaise: stat.lwf.employeePaise });

  const totalDeductions = deductions.reduce((s, d) => s + d.amountPaise, 0);
  const netPaise = Math.max(grossPaid - totalDeductions, 0);

  return {
    employeeId: employee.employeeId,
    userId: meta.userId,
    earnings,
    deductions,
    grossPaise: grossPaid,
    netPaise,
    lopDays: effectiveLopDays,
    unpaidLeaveDays: unpaid,
  };
}

/**
 * Run totals across payslips: gross (paid), deductions, net. Each total
 * is summed directly from the rows — never derived from other totals.
 */
export function runTotals(rows: EmployeeComputation[]): {
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
} {
  let gross = 0;
  let ded = 0;
  let net = 0;
  for (const r of rows) {
    gross += r.grossPaise;
    ded += r.deductions.reduce((s, d) => s + d.amountPaise, 0);
    net += r.netPaise;
  }
  return { grossPaise: gross, deductionsPaise: ded, netPaise: net };
}

/**
 * Plain-text bank transfer file: one line per employee with code, name,
 * account last-4, IFSC and the exact paise amount. Deliberately NOT a
 * real bank format — generating this marks nothing as paid; marking
 * payments is a separate, explicit action.
 */
export function bankFileForRun(
  rows: { employeeCode: string; name: string; accountLast4?: string; ifsc?: string; netPaise: number }[],
  period: string,
): string {
  const header = `ADVOKATE-PAYROLL,${period},${rows.length}`;
  const lines = rows.map(
    (r) =>
      `${r.employeeCode},${r.name},${r.accountLast4 ?? "XXXX"},${r.ifsc ?? "XXXX"},${r.netPaise}`,
  );
  const total = rows.reduce((s, r) => s + r.netPaise, 0);
  return [header, ...lines, `TOTAL,,${total}`].join("\n");
}

/**
 * Balanced payroll journal plan. The identity it enforces:
 *
 *   Dr  Salary expense            = gross paid + employer statutory additions
 *   Cr  Bank                      = net transferred
 *   Cr  Payables (one line per    = withheld employee deductions + employer
 *       deduction label, mapped     contributions for that label
 *       to an account code)
 *
 * The caller supplies every deduction label already summed across
 * payslips, each with the payable account code it must credit (or no
 * code). Amounts without a code are reported as `unmappedPaise` — the
 * run must NOT be posted while anything is unmapped, because posting
 * would drop real liabilities to keep the entry balanced.
 */
export type PayrollPayableLine = {
  label: string;
  amountPaise: number;
  code?: string;
};

export type PayrollJournalPlan = {
  debits: { code: string; amountPaise: number }[];
  credits: { code: string; amountPaise: number }[];
};

export function payrollJournalPlan(
  grossPaise: number,
  netPaise: number,
  employerAdditionsPaise: number,
  payableLines: PayrollPayableLine[],
  salaryExpenseCode: string,
  bankCode: string,
): { plan: PayrollJournalPlan; unmappedPaise: number } {
  if (!Number.isInteger(grossPaise) || grossPaise < 0)
    throw new Error("Gross must be a whole number of paise.");
  if (!Number.isInteger(netPaise) || netPaise < 0)
    throw new Error("Net must be a whole number of paise.");
  if (netPaise > grossPaise)
    throw new Error("Net cannot exceed gross.");

  let unmapped = 0;
  const credits: { code: string; amountPaise: number }[] = [];
  let mappedTotal = 0;
  for (const line of payableLines) {
    if (!Number.isInteger(line.amountPaise) || line.amountPaise < 0)
      throw new Error(`Payable ${line.label} has an invalid amount.`);
    if (line.amountPaise === 0) continue;
    if (!line.code) {
      unmapped += line.amountPaise;
      continue;
    }
    credits.push({ code: line.code, amountPaise: line.amountPaise });
    mappedTotal += line.amountPaise;
  }

  // Deductions the org has not mapped cannot be silently dropped — the
  // caller refuses to finalize while unmappedPaise > 0.
  const expense = netPaise + mappedTotal;
  void employerAdditionsPaise; // sanity input; see payrollExpensePaise

  return {
    plan: {
      debits: [{ code: salaryExpenseCode, amountPaise: expense }],
      credits: [...credits, { code: bankCode, amountPaise: netPaise }],
    },
    unmappedPaise: unmapped,
  };
}

/**
 * The expense the journal must debit for the run: gross paid + employer
 * statutory additions. The caller checks the plan's debit equals this
 * figure before posting and refuses the run when it does not — that
 * mismatch means deductions or employer lines were dropped somewhere.
 */
export function payrollExpensePaise(
  grossPaise: number,
  employerAdditionsPaise: number,
): number {
  if (!Number.isInteger(grossPaise) || grossPaise < 0)
    throw new Error("Gross must be a whole number of paise.");
  if (!Number.isInteger(employerAdditionsPaise) || employerAdditionsPaise < 0)
    throw new Error("Employer additions must be a whole number of paise.");
  return grossPaise + employerAdditionsPaise;
}
