// ===============================================================
// Feature 2 — Hearing outcome → proposal workflow (pure logic).
//
// EXTENDS outcomeFlow.ts (v1 suggestions, still used) rather than
// replacing it: a recorded hearing outcome now generates a full set of
// REVIEWABLE proposals — chronology event, tasks, deadlines, client
// update, next hearing and a Hearing Pack checklist flag. Nothing is
// created automatically: every proposal is stored as a pending row and
// an authorized lawyer approves, edits or rejects each one individually
// or in bulk. Rejected rows are kept for audit.
//
// All functions here are pure so generation, deadline calculation,
// duplicate keys and ids are unit-tested without a deployment.
// ===============================================================

export type OutcomeStatus = "held" | "adjourned";

export type Attendance = "appeared" | "represented" | "adjourned_absent";

/** Categories match DEADLINE_CATEGORIES in the schema exactly. */
export type DeadlineCategory =
  | "limitation"
  | "filing"
  | "compliance"
  | "court_order"
  | "custom";

export type ProposedKind =
  | "chronology"
  | "task"
  | "deadline"
  | "client_update"
  | "next_hearing"
  | "hearing_pack";

export type ProposalStatus = "pending" | "approved" | "rejected";

export type ProposedItem = {
  /** Stable key — also the idempotency key on the server side. */
  key: string;
  kind: ProposedKind;
  title: string;
  /** JSON payload for the server to materialize on approval. */
  payload: Record<string, unknown>;
};

export type DeadlineRule = {
  /** Source line for the audit trail: the sentence in the order. */
  source: string;
  /** Human-readable calculation rule, shown next to the deadline. */
  rule: string;
  /** IST YYYY-MM-DD the directive implies. */
  date: string;
  category: DeadlineCategory;
  title: string;
};

export type OutcomeCapture = {
  hearingId: string;
  hearingTitle: string;
  matterId: string;
  orgTimezone?: string;
  status: OutcomeStatus;
  outcomeText: string;
  attendance?: Attendance;
  appearances?: string;
  directions?: string[];
  nextAction?: string;
  nextHearing?: { title: string; atIso: string; purpose?: string };
  /** Deadlines with their source + calculation rule from the court. */
  deadlines?: DeadlineRule[];
  internalNotes?: string;
  clientSummary?: string;
  requiredDocuments?: string[];
  /** Open/refresh the next Hearing Pack after approval. */
  updateNextPack?: boolean;
  /** IST day the hearing took place (YYYY-MM-DD). */
  hearingDateIN?: string;
};

// ---------------------------------------------------------------
// Duplicate keys — stable, so a retry cannot double-generate
// ---------------------------------------------------------------

/**
 * Stable per-outcome key. The same hearing always produces the same
 * keys; the server stores them once and skips repeats.
 */
export function proposalKey(
  hearingId: string,
  kind: ProposedKind,
  label: string,
): string {
  return `${hearingId}:${kind}:${slug(label)}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------
// Deadline calculation rules — always paired with a source
// ---------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * IST day-end (UTC ms) for a YYYY-MM-DD — a deadline "due today" is not
 * overdue until the IST day closes. Single definition point; the
 * deadline-severity utility in documentManager.ts uses the same rule.
 */
export function istDayEndUtcMs(dateIN: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIN.trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], 18, 59, 59, 999);
  return Number.isNaN(utc) ? null : utc;
}

export function istTodayIN(now: number = Date.now()): string {
  const p = new Date(now + 330 * 60 * 1000).toISOString();
  return `${p.slice(0, 4)}-${p.slice(5, 7)}-${p.slice(8, 10)}`;
}

export function addDaysIN(dateIN: string, days: number): string | null {
  if (istDayEndUtcMs(dateIN) === null) return null;
  // Shift the calendar date, then re-anchor to +05:30 so the result is
  // the same wall-clock date in IST.
  const shifted = new Date(
    Date.UTC(+dateIN.slice(0, 4), +dateIN.slice(5, 7) - 1, +dateIN.slice(8, 10)) +
      days * DAY_MS +
      330 * 60 * 1000,
  );
  const iso = shifted.toISOString();
  return `${iso.slice(0, 4)}-${iso.slice(5, 7)}-${iso.slice(8, 10)}`;
}

/** A directive like "within 30 days" captured against the hearing date. */
export function directiveToDeadline(
  source: string,
  category: DeadlineCategory,
  days: number,
  hearingDateIN: string,
  title: string,
): DeadlineRule | null {
  const clean = source.trim();
  if (!clean || !Number.isFinite(days) || days <= 0) return null;
  const date = addDaysIN(hearingDateIN, days);
  if (!date) return null;
  return {
    source: clean.slice(0, 300),
    rule: `${days} day${days === 1 ? "" : "s"} from the hearing date (${hearingDateIN}), counted in IST`,
    date,
    category,
    title: title.trim().slice(0, 200),
  };
}

// ---------------------------------------------------------------
// Proposal generation
// ---------------------------------------------------------------

function chronoKey(hearingId: string) {
  return proposalKey(hearingId, "chronology", "outcome");
}
export { chronoKey };

function attLine(a: Attendance | undefined): string | null {
  if (a === "appeared") return "Counsel appeared.";
  if (a === "represented") return "Matter represented by counsel.";
  if (a === "adjourned_absent") return "Adjourned; neither side appeared.";
  return null;
}

/**
 * Build the full proposal set for a captured outcome. Deterministic:
 * identical captures yield identical keys and payloads, so server-side
 * dedupe by key is exact. Critical deadlines are ALWAYS proposed —
 * approval is explicit at review time.
 */
export function buildOutcomeProposals(
  c: OutcomeCapture,
  now: number = Date.now(),
): ProposedItem[] {
  const items: ProposedItem[] = [];
  const when = c.hearingDateIN ?? istTodayIN(now);

  // 1. Chronology event (internal).
  const parts = [
    attLine(c.attendance),
    c.appearances?.trim() ? `Appearances: ${c.appearances.trim()}` : null,
    c.outcomeText.trim(),
    c.directions && c.directions.length
      ? `Directions: ${c.directions.map((d) => d.trim()).filter(Boolean).join("; ")}`
      : null,
    c.nextAction?.trim() ? `Next action: ${c.nextAction.trim()}` : null,
  ].filter(Boolean) as string[];
  items.push({
    key: chronoKey(c.hearingId),
    kind: "chronology",
    title: `Hearing ${c.status} — ${c.hearingTitle}`.slice(0, 200),
    payload: {
      matterId: c.matterId,
      detail: parts.join(" ").slice(0, 4000),
      occurredAt: istDayEndUtcMs(when) ?? now,
      datePrecision: "day",
      sourceRef: `Hearing: ${c.hearingTitle}`,
      linkKind: "hearing",
      linkId: c.hearingId,
      visibility: "internal",
    },
  });

  // 2. Tasks — directions first (one each), then the next action.
  const directions = (c.directions ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 12);
  for (const d of directions) {
    items.push({
      key: proposalKey(c.hearingId, "task", `direction:${d}`),
      kind: "task",
      title: d.slice(0, 200),
      payload: {
        matterId: c.matterId,
        title: d.slice(0, 200),
        kind: "filing",
        priority: "high",
      },
    });
  }
  if (c.nextAction?.trim()) {
    const t = c.nextAction.trim();
    items.push({
      key: proposalKey(c.hearingId, "task", `action:${t}`),
      kind: "task",
      title: t.slice(0, 200),
      payload: {
        matterId: c.matterId,
        title: t.slice(0, 200),
        kind: /file|submit|affidavit/i.test(t) ? "filing" : "general",
        priority: "high",
      },
    });
  }

  // 3. Deadlines — proposals only; explicit lawyer approval required,
  //    and the server never overwrites an existing deadline.
  for (const d of c.deadlines ?? []) {
    if (!d.date || !d.title.trim()) continue;
    items.push({
      key: proposalKey(c.hearingId, "deadline", `${d.category}:${d.title}`),
      kind: "deadline",
      title: d.title.slice(0, 200),
      payload: {
        matterId: c.matterId,
        title: d.title.slice(0, 200),
        category: d.category,
        dueAt: istDayEndUtcMs(d.date),
        source: d.source,
        rule: d.rule,
      },
    });
  }

  // 4. Client update (draft; reaches the client only after approval).
  const summary = (c.clientSummary?.trim() || c.outcomeText.trim()).slice(0, 4000);
  const hearingWord = c.status === "adjourned" ? "adjourned" : "held";
  items.push({
    key: proposalKey(c.hearingId, "client_update", "update"),
    kind: "client_update",
    title: `Client update — ${c.hearingTitle}`.slice(0, 200),
    payload: {
      matterId: c.matterId,
      title: `Client update — ${c.hearingTitle}`.slice(0, 200),
      body: [
        `Update on your matter — ${formatINDate(when)}.`,
        "",
        `The hearing was ${hearingWord}.`,
        summary,
        c.nextHearing?.title?.trim()
          ? `The next hearing (${c.nextHearing.title.trim()}) is scheduled; you will be informed of the date.`
          : "",
        "",
        "If you have any questions, please reach out to our office.",
      ]
        .filter((l) => l !== "")
        .join("\n"),
    },
  });

  // 5. Next hearing.
  if (c.nextHearing?.title?.trim() && c.nextHearing.atIso) {
    const at = Date.parse(c.nextHearing.atIso);
    if (Number.isFinite(at)) {
      items.push({
        key: proposalKey(c.hearingId, "next_hearing", c.nextHearing.title),
        kind: "next_hearing",
        title: c.nextHearing.title.trim().slice(0, 200),
        payload: {
          matterId: c.matterId,
          title: c.nextHearing.title.trim(),
          at,
          purpose: c.nextHearing.purpose?.trim() || undefined,
        },
      });
    }
  }

  // 6. Hearing Pack checklist refresh (proposed, not automatic).
  if (c.updateNextPack) {
    items.push({
      key: proposalKey(c.hearingId, "hearing_pack", "refresh"),
      kind: "hearing_pack",
      title: "Refresh the next Hearing Pack checklist",
      payload: { matterId: c.matterId, note: "Open the pack builder preselected." },
    });
  }

  return items;
}

function formatINDate(dateIN: string): string {
  const ms = istDayEndUtcMs(dateIN);
  if (ms === null) return dateIN;
  return new Date(ms).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
