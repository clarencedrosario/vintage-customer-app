import { describe, expect, it } from "vitest";
import {
  bankFileForRun,
  computeEmployeePayslip,
  daysInPeriod,
  lopDeductionPaise,
  payrollExpensePaise,
  payrollJournalPlan,
  periodEnd,
  periodStart,
  prorateComponents,
  runTotals,
  statutoryForEmployee,
  structureForPeriod,
  type EmployeeComputation,
} from "./payrollMath";

describe("payroll period bounds", () => {
  it("counts calendar days including leap Februaries", () => {
    expect(daysInPeriod("2026-09")).toBe(30);
    expect(daysInPeriod("2026-02")).toBe(28);
    expect(daysInPeriod("2024-02")).toBe(29);
  });

  it("rejects malformed periods", () => {
    expect(() => daysInPeriod("2026-13")).toThrow();
    expect(() => daysInPeriod("2026-9")).toThrow();
    expect(() => periodStart("Sept-26")).toThrow();
    expect(periodStart("2026-09")).toBe("2026-09-01");
    expect(periodEnd("2026-09")).toBe("2026-09-30");
  });
});

describe("prorateComponents", () => {
  it("scales exactly with zero drift", () => {
    const out = prorateComponents(
      [
        { component: "Basic", amountPaise: 3_000_00 },
        { component: "HRA", amountPaise: 1_500_00 },
      ],
      2_000_00,
    );
    const total = out.reduce((s, l) => s + l.amountPaise, 0);
    expect(total).toBe(2_000_00);
  });

  it("absorbs floor deficit on the first line", () => {
    const out = prorateComponents(
      [{ component: "A", amountPaise: 100 }, { component: "B", amountPaise: 100 }],
      1,
    );
    expect(out[0]!.amountPaise + out[1]!.amountPaise).toBe(1);
  });

  it("refuses an empty list and over-target amounts", () => {
    expect(() => prorateComponents([], 100)).toThrow();
    expect(() =>
      prorateComponents([{ component: "A", amountPaise: 50 }], 100),
    ).toThrow();
  });
});

describe("lopDeductionPaise", () => {
  it("floors the employee-favourable rounding", () => {
    // 10,000.01ₚ gross, 1 LOP day of 30 → 333.33ₚ
    expect(lopDeductionPaise(10_000_01, 1, 30)).toBe(333_33);
  });

  it("validates bounds", () => {
    expect(() => lopDeductionPaise(100, 31, 30)).toThrow();
    expect(() => lopDeductionPaise(-1, 1, 30)).toThrow();
  });
});

describe("structureForPeriod", () => {
  const base = {
    employeeId: "e1",
    dateOfJoining: "2024-01-01",
    lopDays: 0,
    unpaidLeaveDays: 0,
  };

  it("selects the newest structure effective on or before the period", () => {
    const sel = structureForPeriod(
      {
        ...base,
        structures: [
          { effectiveFrom: "2026-04-01", monthlyPaise: [{ component: "Basic", amountPaise: 100, type: "earning" }] },
          { effectiveFrom: "2025-04-01", monthlyPaise: [{ component: "Basic", amountPaise: 80, type: "earning" }] },
        ],
      },
      "2026-09",
    );
    expect(sel.ok && sel.structure[0]!.amountPaise).toBe(100);
  });

  it("reports honest reasons instead of inventing values", () => {
    const none = structureForPeriod({ ...base, structures: [] }, "2026-09");
    expect(!none.ok && none.reason).toBe("no_salary_structure");
    const future = structureForPeriod(
      { ...base, structures: [{ effectiveFrom: "2026-10-01", monthlyPaise: [{ component: "B", amountPaise: 1, type: "earning" }] }] },
      "2026-09",
    );
    expect(!future.ok && future.reason).toBe("no_salary_structure");
    const joiner = structureForPeriod(
      { ...base, dateOfJoining: "2026-10-05", structures: [{ effectiveFrom: "2026-01-01", monthlyPaise: [{ component: "B", amountPaise: 1, type: "earning" }] }] },
      "2026-09",
    );
    expect(!joiner.ok && joiner.reason).toBe("not_joined_yet");
    const leaver = structureForPeriod(
      { ...base, dateOfLeaving: "2026-08-31", structures: [{ effectiveFrom: "2026-01-01", monthlyPaise: [{ component: "B", amountPaise: 1, type: "earning" }] }] },
      "2026-09",
    );
    expect(!leaver.ok && leaver.reason).toBe("left_before_period");
    const empty = structureForPeriod(
      { ...base, structures: [{ effectiveFrom: "2026-01-01", monthlyPaise: [] }] },
      "2026-09",
    );
    expect(!empty.ok && empty.reason).toBe("empty_salary_structure");
  });
});

describe("statutoryForEmployee — frozen specs only", () => {
  it("returns nulls when the org configured nothing", () => {
    const out = statutoryForEmployee(1_000_00, []);
    expect(out.pf).toBeNull();
    expect(out.esi).toBeNull();
    expect(out.pt).toBeNull();
    expect(out.lwf).toBeNull();
  });

  it("applies PF capped at the wage ceiling", () => {
    const out = statutoryForEmployee(5_000_00, [
      {
        kind: "pf",
        version: 1,
        effectiveFrom: "2026-01-01",
        spec: { wageCeilingPaise: 1_500_00, employeeRateBps: 1200, employerRateBps: 1300, employerRateEdliBps: 50 },
      },
    ]);
    // wages = min(5000₹, 1500₹) = 1500₹ → employee 12% = 180₹ = 18000ₚ
    expect(out.pf?.employeePaise).toBe(18_000);
    expect(out.pf?.employerPaise).toBe(19_500);
    expect(out.pf?.edliPaise).toBe(750);
  });

  it("applies PT from the highest applicable slab", () => {
    const out = statutoryForEmployee(2_500_00, [
      {
        kind: "pt",
        version: 3,
        effectiveFrom: "2026-01-01",
        spec: {
          stateCode: "KA",
          stateSlabs: [
            { incomeAbovePaise: 0, taxPaise: 0 },
            { incomeAbovePaise: 1_200_00, taxPaise: 20_000 },
            { incomeAbovePaise: 2_500_00, taxPaise: 20_000 },
          ],
        },
      },
    ]);
    expect(out.pt?.employeePaise).toBe(20_000);
  });

  it("applies LWF fixed contributions verbatim", () => {
    const out = statutoryForEmployee(1_000_00, [
      { kind: "lwf", version: 1, effectiveFrom: "2026-01-01", spec: { stateCode: "MH", employeeContributionPaise: 1200, employerContributionPaise: 3600 } },
    ]);
    expect(out.lwf?.employeePaise).toBe(1200);
    expect(out.lwf?.employerPaise).toBe(3600);
  });
});

describe("computeEmployeePayslip", () => {
  const structure = [
    { component: "Basic", amountPaise: 4_000_00, type: "earning" as const },
    { component: "HRA", amountPaise: 2_000_00, type: "earning" as const },
    { component: "Prof tax", amountPaise: 2_000, type: "deduction" as const },
  ];
  const base = {
    employeeId: "e1",
    dateOfJoining: "2024-01-01",
    structures: [{ effectiveFrom: "2026-01-01", monthlyPaise: structure }],
  };

  it("pays full month with no LOP; fixed deductions ride along", () => {
    const c = computeEmployeePayslip(base, "2026-09", [], {});
    expect(c.grossPaise).toBe(6_000_00);
    expect(c.netPaise).toBe(6_000_00 - 2_000);
    expect(c.lopDays).toBe(0);
  });

  it("prorates LOP months across components with exact paise", () => {
    const withLop = { ...base, lopDays: 3 };
    const c = computeEmployeePayslip(withLop, "2026-09", [], {});
    // gross = 6,000₹ − floor(6,000₹×3/30) = 6,000₹ − 600₹ = 5,400₹
    expect(c.grossPaise).toBe(5_400_00);
    const total = c.earnings.reduce((s, e) => s + e.amountPaise, 0);
    expect(total).toBe(5_400_00);
  });

  it("treats unpaid leave days as LOP for pay", () => {
    const c = computeEmployeePayslip({ ...base, unpaidLeaveDays: 30 }, "2026-09", [], {});
    expect(c.grossPaise).toBe(0);
    expect(c.netPaise).toBe(0);
  });

  it("clamps net at zero when deductions exceed prorated gross", () => {
    const heavy = [
      { component: "Basic", amountPaise: 1_000, type: "earning" as const },
      { component: "Advance recovery", amountPaise: 50_000, type: "deduction" as const },
    ];
    const c = computeEmployeePayslip(
      { ...base, structures: [{ effectiveFrom: "2026-01-01", monthlyPaise: heavy }] },
      "2026-09",
      [],
      {},
    );
    expect(c.netPaise).toBe(0);
  });

  it("throws the tagged reason when no structure applies", () => {
    expect(() =>
      computeEmployeePayslip({ ...base, structures: [] }, "2026-09", [], {}),
    ).toThrow("payroll:no_salary_structure:e1");
  });
});

describe("runTotals", () => {
  it("sums each figure directly from rows", () => {
    const rows: EmployeeComputation[] = [
      {
        employeeId: "e1",
        earnings: [{ component: "Basic", amountPaise: 1_000_00 }],
        deductions: [{ component: "PT", amountPaise: 2_000 }],
        grossPaise: 1_000_00,
        netPaise: 98_000,
        lopDays: 0,
        unpaidLeaveDays: 0,
      },
      {
        employeeId: "e2",
        earnings: [{ component: "Basic", amountPaise: 500_00 }],
        deductions: [{ component: "PT", amountPaise: 2_000 }],
        grossPaise: 500_00,
        netPaise: 48_000,
        lopDays: 0,
        unpaidLeaveDays: 0,
      },
    ];
    expect(runTotals(rows)).toEqual({
      grossPaise: 1_500_00,
      deductionsPaise: 4_000,
      netPaise: 1_46_000,
    });
  });
});

describe("bankFileForRun", () => {
  it("is plain text with a total line and marks nothing paid", () => {
    const file = bankFileForRun(
      [
        { employeeCode: "ADV-001", name: "A B", accountLast4: "1234", ifsc: "HDFC0001", netPaise: 98_000 },
        { employeeCode: "ADV-002", name: "C D", netPaise: 48_000 },
      ],
      "2026-09",
    );
    const lines = file.split("\n");
    expect(lines[0]).toBe("ADVOKATE-PAYROLL,2026-09,2");
    expect(lines[1]).toContain("ADV-001");
    expect(lines[lines.length - 1]).toBe("TOTAL,,146000");
  });
});

describe("payrollJournalPlan", () => {
  it("balances net + mapped payables against the expense debit", () => {
    const { plan, unmappedPaise } = payrollJournalPlan(
      1_000_00, // gross
      98_000, // net = gross − all mapped deductions (1800 + 200)
      0,
      [
        { label: "PF (employee)", amountPaise: 18_00, code: "2310" },
        { label: "Professional Tax", amountPaise: 2_00, code: "2320" },
      ],
      "5010",
      "1000",
    );
    expect(unmappedPaise).toBe(0);
    const dr = plan.debits.reduce((s, l) => s + l.amountPaise, 0);
    const cr = plan.credits.reduce((s, l) => s + l.amountPaise, 0);
    expect(dr).toBe(cr);
    expect(dr).toBe(1_000_00);
    expect(plan.credits.find((c) => c.code === "1000")?.amountPaise).toBe(98_000);
  });

  it("reports unmapped deductions instead of dropping them", () => {
    const { unmappedPaise } = payrollJournalPlan(
      1_000_00,
      98_000,
      0,
      [{ label: "Unmapped levy", amountPaise: 2_000 }],
      "5010",
      "1000",
    );
    expect(unmappedPaise).toBe(2_000);
  });

  it("expense check matches gross + employer additions", () => {
    expect(payrollExpensePaise(1_000_00, 19_50)).toBe(1_019_50);
    expect(() => payrollExpensePaise(-1, 0)).toThrow();
  });
});
