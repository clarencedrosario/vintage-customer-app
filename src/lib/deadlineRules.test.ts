import { describe, expect, it } from "vitest";
import {
  calculateDeadline,
  dedupeKey,
  daysUntil,
  escalationTier,
  isRuleEffective,
  parseDate,
  selectRule,
  sourceSentence,
  type DeadlineRuleSpec,
  type HolidayMap,
} from "./deadlineRules";

const base: DeadlineRuleSpec = {
  name: "Written statement",
  triggerEvent: "order_passed",
  countType: "calendar_days",
  count: 30,
  triggerDayTreatment: "excluded",
  weekendRule: "sat_sun",
  holidayRule: "count",
  direction: "after",
  criticality: "normal",
  effectiveFrom: "2020-01-01",
};

function rule(overrides: Partial<DeadlineRuleSpec>): DeadlineRuleSpec {
  return { ...base, ...overrides };
}

// 2026-03-02 is a Monday; 2026-03-07 Sat, 2026-03-08 Sun.
describe("calendar-day counting", () => {
  it("counts calendar days after the trigger, trigger excluded", () => {
    const r = calculateDeadline(rule({}), "2026-03-02", new Map());
    expect(r.dueDate).toBe("2026-04-01"); // Mar 2 + 30 = Apr 1
    expect(r.breakdown.some((b) => b.includes("calendar day"))).toBe(true);
    expect(r.breakdown.at(-1)).toContain("2026-04-01");
  });

  it("treats the trigger day as day 1 when included", () => {
    const r = calculateDeadline(
      rule({ triggerDayTreatment: "included", count: 30 }),
      "2026-03-02",
      new Map(),
    );
    // Day 1 = Mar 2 → day 30 = Mar 31.
    expect(r.dueDate).toBe("2026-03-31");
  });

  it("lands forward over a weekend when holidays are skipped", () => {
    const r = calculateDeadline(
      rule({ count: 3, holidayRule: "skip" }),
      "2026-03-04", // Wed
      new Map(),
    );
    // Wed 4 + 3 = Sat 7 → landed forward to Mon 9.
    expect(r.dueDate).toBe("2026-03-09");
    expect(r.breakdown.some((b) => b.includes("Landing adjusted"))).toBe(true);
  });

  it("keeps a weekend result when the rule counts holidays/weekends", () => {
    const r = calculateDeadline(rule({ count: 3, holidayRule: "count" }), "2026-03-05", new Map());
    // Thu 5 + 3 = Sun 8.
    expect(r.dueDate).toBe("2026-03-08");
  });
});

describe("working-day counting", () => {
  it("skips weekends", () => {
    const r = calculateDeadline(
      rule({ countType: "working_days", count: 5, holidayRule: "skip" }),
      "2026-03-02", // Mon
      new Map(),
    );
    // Mon 2 → Tue3 Wed4 Thu5 Fri6 Mon9 = 5 working days.
    expect(r.dueDate).toBe("2026-03-09");
  });

  it("skips configured court holidays", () => {
    const holidays: HolidayMap = new Map([["2026-03-05", ["Holi"]]]);
    const r = calculateDeadline(
      rule({ countType: "working_days", count: 5, holidayRule: "skip" }),
      "2026-03-02", // Mon
      holidays,
    );
    // Tue3 Wed4 (skip Thu5) Fri6 Mon9 Tue10.
    expect(r.dueDate).toBe("2026-03-10");
    expect(r.breakdown.some((b) => b.includes("court holiday"))).toBe(true);
  });

  it("counts holidays when holidayRule is count", () => {
    const holidays: HolidayMap = new Map([["2026-03-05", ["Holi"]]]);
    const r = calculateDeadline(
      rule({ countType: "working_days", count: 5, holidayRule: "count" }),
      "2026-03-02",
      holidays,
    );
    expect(r.dueDate).toBe("2026-03-09");
  });

  it("supports sun_only weekends", () => {
    const r = calculateDeadline(
      rule({ countType: "working_days", count: 5, weekendRule: "sun_only", holidayRule: "skip" }),
      "2026-03-02", // Mon
      new Map(),
    );
    // Mon2 Tue3 Wed4 Thu5 Fri6 Sat7 = 5 working days (Saturday counts).
    expect(r.dueDate).toBe("2026-03-07");
  });

  it("counts working days backward before a trigger", () => {
    const r = calculateDeadline(
      rule({ countType: "working_days", count: 3, direction: "before", holidayRule: "skip" }),
      "2026-03-09", // Mon
      new Map(),
    );
    // Sun8 skipped, Sat7 skipped (sat_sun), Fri6=1 Thu5=2 Wed4=3.
    expect(r.dueDate).toBe("2026-03-04");
  });
});

describe("direction before", () => {
  it("counts calendar days backward", () => {
    const r = calculateDeadline(
      rule({ count: 10, direction: "before" }),
      "2026-03-20",
      new Map(),
    );
    expect(r.dueDate).toBe("2026-03-10");
  });
});

describe("rule selection and versions", () => {
  const mk = (spec: DeadlineRuleSpec, version = 1) => ({ spec, version });

  it("prefers the most specific effective rule", () => {
    const general = mk(rule({}));
    const specific = mk(
      rule({ authority: "Delhi High Court" }),
      1,
    );
    const picked = selectRule([general, specific], {
      triggerDate: "2026-03-02",
      triggerEvent: "order_passed",
      authority: "Delhi High Court",
    });
    expect(picked?.spec.authority).toBe("Delhi High Court");
  });

  it("ignores rules whose scope does not match", () => {
    const scoped = mk(rule({ authority: "Bombay High Court" }));
    const picked = selectRule([scoped], {
      triggerDate: "2026-03-02",
      triggerEvent: "order_passed",
      authority: "Delhi High Court",
    });
    expect(picked).toBeNull();
  });

  it("respects effective windows (no retroactive version change)", () => {
    const v1 = mk(rule({ effectiveFrom: "2020-01-01", effectiveTo: "2025-12-31" }), 1);
    const v2 = mk(rule({ effectiveFrom: "2026-01-01", count: 45 }), 2);
    expect(selectRule([v1, v2], { triggerDate: "2025-06-01", triggerEvent: "order_passed" })?.version).toBe(1);
    expect(selectRule([v1, v2], { triggerDate: "2026-06-01", triggerEvent: "order_passed" })?.version).toBe(2);
  });

  it("returns null when no rule matches the trigger event", () => {
    expect(
      selectRule([mk(rule({}))], { triggerDate: "2026-03-02", triggerEvent: "hearing_adjourned" }),
    ).toBeNull();
  });

  it("isRuleEffective honours both bounds", () => {
    expect(isRuleEffective(base, "2026-03-02")).toBe(true);
    expect(isRuleEffective(rule({ effectiveTo: "2025-12-31" }), "2026-03-02")).toBe(false);
  });
});

describe("duplicate prevention", () => {
  it("builds a deterministic key per rule+version+trigger", () => {
    const a = dedupeKey({ ruleId: "r1", ruleVersion: 3, triggerEvent: "order_passed", triggerRef: "order:abc" });
    const b = dedupeKey({ ruleId: "r1", ruleVersion: 3, triggerEvent: "order_passed", triggerRef: "order:abc" });
    const c = dedupeKey({ ruleId: "r1", ruleVersion: 4, triggerEvent: "order_passed", triggerRef: "order:abc" });
    const d = dedupeKey({ ruleId: "r1", ruleVersion: 3, triggerEvent: "order_passed", triggerRef: "order:def" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe("source sentence and escalation", () => {
  it("renders the source sentence with date and detail", () => {
    expect(sourceSentence({ sourceLabel: "Order in CS/12/2026", sourceDate: "2026-03-02", detail: "para 4" })).toBe(
      "Source: Order in CS/12/2026 dated 2026-03-02 — para 4",
    );
  });

  it("escalates unacknowledged critical deadlines", () => {
    expect(escalationTier({ criticality: "critical", acknowledged: false, dueDate: "2026-03-10", today: "2026-03-10" })).toBe("urgent");
    expect(escalationTier({ criticality: "critical", acknowledged: false, dueDate: "2026-03-12", today: "2026-03-10" })).toBe("warn");
    expect(escalationTier({ criticality: "critical", acknowledged: true, dueDate: "2026-03-11", today: "2026-03-10" })).toBe("warn");
    expect(escalationTier({ criticality: "normal", acknowledged: false, dueDate: "2026-03-20", today: "2026-03-10" })).toBe("info");
    expect(escalationTier({ criticality: "critical", acknowledged: false, dueDate: "2026-03-05", today: "2026-03-10" })).toBe("urgent");
  });

  it("computes day deltas", () => {
    expect(daysUntil("2026-03-12", "2026-03-10")).toBe(2);
    expect(daysUntil("2026-03-10", "2026-03-10")).toBe(0);
    expect(daysUntil("2026-03-08", "2026-03-10")).toBe(-2);
  });

  it("rejects malformed input", () => {
    expect(() => calculateDeadline(rule({ count: 0 }), "2026-03-02", new Map())).toThrow();
    expect(() => parseDate("02-03-2026")).toThrow();
  });
});
