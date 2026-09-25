// =====================================================================
// FEATURE 5 — Deadline rules engine: pure calculation core.
//
// Everything here is a decision/computation function over plain data —
// no Convex context, no I/O — so the unit suite exercises the exact
// logic the server runs. Calendar maths is civil-Asia/Kolkata
// (UTC+5:30, no DST): "a day" is a local civil day, and a deadline set
// on date D expires at the END of D, never before.
// =====================================================================

export type CountType = "calendar_days" | "working_days";
export type TriggerDayTreatment = "excluded" | "included";
export type WeekendRule = "sat_sun" | "sun_only";
export type HolidayRule = "skip" | "count";
export type Direction = "after" | "before";
export type Criticality = "critical" | "normal";

/** The frozen specification of one rule version. */
export type DeadlineRuleSpec = {
  name: string;
  jurisdiction?: string;
  authority?: string;
  practiceArea?: string;
  triggerEvent: string;
  countType: CountType;
  count: number;
  triggerDayTreatment: TriggerDayTreatment;
  weekendRule: WeekendRule;
  holidayRule: HolidayRule;
  direction: Direction;
  criticality: Criticality;
  reminderDaysBefore?: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

/** Holidays visible to a calculation (org-wide + court-specific). */
export type HolidayMap = Map<string, string[]>; // date -> holiday names

export type BreakdownLine =
  | { step: "trigger"; text: string }
  | { step: "mode"; text: string }
  | { step: "skip"; text: string }
  | { step: "land"; text: string }
  | { step: "result"; text: string };

export type CalculationResult = {
  dueDate: string; // YYYY-MM-DD
  breakdown: string[];
  calcRule: string;
};

// --------------------------------------------------------------- dates

/** Parse "YYYY-MM-DD" into a UTC-noon timestamp (stable across TZs). */
export function parseDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Invalid date "${date}" (expected YYYY-MM-DD).`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(ms)) throw new Error(`Invalid date "${date}".`);
  return ms;
}

/** Format a UTC-noon timestamp back to "YYYY-MM-DD". */
export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Day of week for a "YYYY-MM-DD" (0 = Sunday … 6 = Saturday). */
export function dayOfWeek(date: string): number {
  return new Date(parseDate(date)).getUTCDay();
}

export function isWeekend(date: string, rule: WeekendRule): boolean {
  const dow = dayOfWeek(date);
  return rule === "sat_sun" ? dow === 0 || dow === 6 : dow === 0;
}

export function isHoliday(date: string, holidays: HolidayMap): boolean {
  return holidays.has(date);
}

/** Is the rule in force on the given date? */
export function isRuleEffective(
  spec: DeadlineRuleSpec,
  onDate: string,
): boolean {
  if (onDate < spec.effectiveFrom) return false;
  if (spec.effectiveTo && onDate > spec.effectiveTo) return false;
  return true;
}

/**
 * Which rule version applies for a trigger on `triggerDate`? Rules are
 * scored by specificity (authority > practiceArea > jurisdiction); the
 * most specific effective rule wins, and among equals the latest
 * effectiveFrom wins. Version choice is frozen at generation time —
 * never recomputed when the catalogue changes.
 */
export function selectRule<T extends { spec: DeadlineRuleSpec; version: number }>(
  candidates: T[],
  args: {
    triggerDate: string;
    triggerEvent: string;
    jurisdiction?: string;
    authority?: string;
    practiceArea?: string;
  },
): T | null {
  const eligible = candidates.filter(
    (c) =>
      c.spec.triggerEvent === args.triggerEvent &&
      isRuleEffective(c.spec, args.triggerDate),
  );
  if (eligible.length === 0) return null;
  const score = (c: T): number => {
    const s = c.spec;
    let n = 0;
    if (s.authority) {
      if (!args.authority || s.authority.toLowerCase() !== args.authority.toLowerCase()) {
        return -1;
      }
      n += 4;
    }
    if (s.practiceArea) {
      if (
        !args.practiceArea ||
        s.practiceArea.toLowerCase() !== args.practiceArea.toLowerCase()
      ) {
        return -1;
      }
      n += 2;
    }
    if (s.jurisdiction) {
      if (
        !args.jurisdiction ||
        s.jurisdiction.toLowerCase() !== args.jurisdiction.toLowerCase()
      ) {
        return -1;
      }
      n += 1;
    }
    return n;
  };
  const scored = eligible
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || (a.c.spec.effectiveFrom < b.c.spec.effectiveFrom ? 1 : -1) || b.c.version - a.c.version);
  return scored[0]?.c ?? null;
}

// -------------------------------------------------------- calculation

/**
 * Core engine. `direction: "after"` counts forward from the trigger
 * date; `"before"` counts backward (deliverables due before a hearing,
 * for example). Working-day counting skips weekends and (when
 * holidayRule is "skip") court holidays; calendar-day counting counts
 * every civil day but still lands on the next working day when the
 * result would fall on a weekend/holiday that is configured to be
 * skipped — the landing step is always visible in the breakdown.
 */
export function calculateDeadline(
  spec: DeadlineRuleSpec,
  triggerDate: string,
  holidays: HolidayMap,
): CalculationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(triggerDate)) {
    throw new Error("Trigger date must be YYYY-MM-DD.");
  }
  if (!Number.isInteger(spec.count) || spec.count <= 0) {
    throw new Error("Rule count must be a positive whole number of days.");
  }

  const breakdown: string[] = [];
  const parts: string[] = [];
  parts.push(`${spec.count} ${spec.countType === "working_days" ? "working" : "calendar"} days`);
  parts.push(spec.direction === "after" ? "after" : "before");
  parts.push(`trigger ${triggerDate}`);
  const calcRule =
    `${spec.name}: ${parts.join(" ")}` +
    ` (trigger day ${spec.triggerDayTreatment}, weekends ${spec.weekendRule === "sat_sun" ? "Sat+Sun" : "Sun"}, holidays ${spec.holidayRule})`;

  breakdown.push(`Trigger: ${triggerDate}${spec.triggerDayTreatment === "excluded" ? " (excluded from the count)" : " (counted as day 1)"}`);
  breakdown.push(
    `Rule: ${spec.count} ${spec.countType === "working_days" ? "working" : "calendar"} day(s) ${spec.direction} the trigger; weekends: ${spec.weekendRule === "sat_sun" ? "Saturday & Sunday" : "Sunday only"}; holidays: ${spec.holidayRule === "skip" ? "skipped" : "counted"}.`,
  );

  const step =
    spec.direction === "after" ? 1 : -1;
  let cursor = parseDate(triggerDate);
  const isWorkingDay = (d: string): boolean =>
    !isWeekend(d, spec.weekendRule) &&
    !(spec.holidayRule === "skip" && isHoliday(d, holidays));

  if (spec.countType === "calendar_days") {
    const offset =
      spec.triggerDayTreatment === "included" ? spec.count - 1 : spec.count;
    cursor += step * offset * 86400000;
    breakdown.push(
      `Count: ${spec.count} calendar day(s) ${spec.direction} → ${formatDate(cursor)}`,
    );
  } else {
    let counted = 0;
    if (spec.triggerDayTreatment === "included" && isWorkingDay(triggerDate)) {
      counted = 1;
      breakdown.push(`Trigger day ${triggerDate} counts as working day 1.`);
    }
    let guard = 0;
    while (counted < spec.count) {
      cursor += step * 86400000;
      guard += 1;
      if (guard > 10000) throw new Error("Deadline calculation did not converge.");
      const d = formatDate(cursor);
      const weekend = isWeekend(d, spec.weekendRule);
      const holiday = isHoliday(d, holidays);
      if (weekend || (holiday && spec.holidayRule === "skip")) {
        breakdown.push(
          `Skip ${d}${weekend ? " (weekend)" : " (court holiday)"} — not a working day.`,
        );
        continue;
      }
      counted += 1;
    }
    breakdown.push(`Counted ${spec.count} working day(s) → ${formatDate(cursor)}`);
  }

  // Landing: never let the result fall on a non-working day when the
  // rule says those days are skipped.
  if (spec.holidayRule === "skip" || spec.countType === "working_days") {
    let landed = formatDate(cursor);
    let moved = false;
    let guard = 0;
    while (
      (isWeekend(landed, spec.weekendRule) || isHoliday(landed, holidays)) &&
      spec.holidayRule === "skip"
    ) {
      cursor += step * 86400000;
      landed = formatDate(cursor);
      moved = true;
      guard += 1;
      if (guard > 100) break;
    }
    if (moved) {
      breakdown.push(
        `Landing adjusted ${step > 0 ? "forward" : "backward"} to ${landed} (result fell on a non-working day).`,
      );
    }
    if (moved || spec.countType === "working_days") {
      breakdown.push(`Lands on ${landed} — a working day.`);
    }
  }

  const dueDate = formatDate(cursor);
  breakdown.push(`Due date: ${dueDate}.`);
  return { dueDate, breakdown, calcRule };
}

// ------------------------------------------------------------- dedupe

/**
 * Deterministic per rule+version+trigger. Two submissions for the same
 * rule version and source record produce the same key, so a retry can
 * never double-generate; a NEW rule version or a genuinely new source
 * record legitimately produces a new deadline.
 */
export function dedupeKey(args: {
  ruleId: string;
  ruleVersion: number;
  triggerEvent: string;
  triggerRef: string;
}): string {
  return `f5:${args.ruleId}:v${args.ruleVersion}:${args.triggerEvent}:${args.triggerRef}`;
}

/** Human sentence describing the source of the trigger date. */
export function sourceSentence(args: {
  sourceLabel: string;
  sourceDate: string;
  detail?: string;
}): string {
  return `Source: ${args.sourceLabel} dated ${args.sourceDate}${args.detail ? ` — ${args.detail}` : ""}`;
}

// ----------------------------------------------------- escalation math

/** Days remaining until the due date (negative = overdue). */
export function daysUntil(dueDate: string, today: string): number {
  return Math.round((parseDate(dueDate) - parseDate(today)) / 86400000);
}

/**
 * Critical deadline escalation ladder for the pure layer: unacknowledged
 * critical deadlines escalate as they approach their date.
 */
export function escalationTier(
  args: { criticality: Criticality; acknowledged: boolean; dueDate: string; today: string },
): "none" | "info" | "warn" | "urgent" {
  const d = daysUntil(args.dueDate, args.today);
  if (d < 0) return "urgent";
  if (args.criticality !== "critical") return d <= 2 ? "warn" : "info";
  if (!args.acknowledged) return d <= 1 ? "urgent" : d <= 3 ? "warn" : "info";
  return d <= 1 ? "warn" : "info";
}
