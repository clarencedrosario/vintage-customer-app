import { describe, expect, it } from "vitest";
import { canTransitionTicket, canSeeTicket } from "./platformOps";
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_KINDS,
} from "./schemaExtras";
import {
  isHandoffOpen,
  isHandoffHighPriority,
  mergeHandoffSnapshotChange,
  rebuildHandoffRow,
  handoffCountersMatch,
  type HandoffTicketSnapshot,
  type HandoffViewRow,
} from "./handoffView";

describe("ticket status transitions", () => {
  it("open can move to in_progress, resolved, or closed", () => {
    expect(canTransitionTicket("open", "in_progress")).toBe(true);
    expect(canTransitionTicket("open", "resolved")).toBe(true);
    expect(canTransitionTicket("open", "closed")).toBe(true);
  });

  it("in_progress can resolve, close, or fall back to open", () => {
    expect(canTransitionTicket("in_progress", "resolved")).toBe(true);
    expect(canTransitionTicket("in_progress", "closed")).toBe(true);
    expect(canTransitionTicket("in_progress", "open")).toBe(true);
  });

  it("resolved and closed may be reopened only to open", () => {
    expect(canTransitionTicket("resolved", "open")).toBe(true);
    expect(canTransitionTicket("closed", "open")).toBe(true);
    expect(canTransitionTicket("resolved", "in_progress")).toBe(false);
    expect(canTransitionTicket("closed", "in_progress")).toBe(false);
    expect(canTransitionTicket("closed", "resolved")).toBe(false);
  });

  it("closed is terminal except for reopen", () => {
    expect(canTransitionTicket("closed", "closed")).toBe(false);
    expect(canTransitionTicket("closed", "open")).toBe(true);
  });

  it("covers exactly the four shipped statuses", () => {
    expect(TICKET_STATUSES).toEqual([
      "open",
      "in_progress",
      "resolved",
      "closed",
    ]);
  });
});

describe("ticket visibility (submitter + platform operator only)", () => {
  const ticket = (over: Partial<Parameters<typeof canSeeTicket>[1]> = {}) =>
    ({
      _id: "t1" as never,
      submittedById: "cust1" as never,
      isPlatformAdmin: undefined,
      ...over,
    }) as unknown as Parameters<typeof canSeeTicket>[1];

  it("submitter can always see their own ticket", () => {
    expect(
      canSeeTicket(
        { _id: "cust1" as never, isPlatformAdmin: undefined },
        ticket(),
      ),
    ).toBe(true);
  });

  it("another customer cannot see someone else's ticket", () => {
    expect(
      canSeeTicket(
        { _id: "cust2" as never, isPlatformAdmin: undefined },
        ticket(),
      ),
    ).toBe(false);
  });

  it("a platform operator can see any ticket", () => {
    expect(
      canSeeTicket(
        { _id: "op1" as never, isPlatformAdmin: true },
        ticket(),
      ),
    ).toBe(true);
  });

  it("a chamber owner WITHOUT the platform flag cannot see foreign tickets", () => {
    // The platform gate is users.isPlatformAdmin — a chamber-level owner
    // role grants nothing over another customer's ticket.
    expect(
      canSeeTicket(
        { _id: "ownerX" as never, isPlatformAdmin: false },
        ticket(),
      ),
    ).toBe(false);
  });
});

describe("escalation constants", () => {
  it("ships exactly the five ticket kinds with ai_escalation included", () => {
    expect(TICKET_KINDS).toContain("ai_escalation");
    expect(TICKET_KINDS).toHaveLength(5);
  });

  it("priorities are the four-level ladder", () => {
    expect(TICKET_PRIORITIES).toEqual(["low", "normal", "high", "urgent"]);
  });
});

// ---------------------------------------------------------------------
// AI-handoff materialized view — pure delta rules
// ---------------------------------------------------------------------

const ORG = "org1";

const snapshot = (over: Partial<HandoffTicketSnapshot> = {}): HandoffTicketSnapshot => ({
  kind: "ai_escalation",
  orgId: ORG,
  status: "open",
  priority: "high",
  assignedToId: null,
  ...over,
});

const emptyRow = (at = 0): HandoffViewRow => ({
  orgId: ORG,
  openCount: 0,
  unclaimedCount: 0,
  highPriorityCount: 0,
  lastHandoffAt: null,
  lastResolvedAt: null,
  updatedAt: at,
});

describe("handoff view — snapshot deltas", () => {
  it("open statuses mirror the operator queue (open + in_progress)", () => {
    expect(isHandoffOpen("open")).toBe(true);
    expect(isHandoffOpen("in_progress")).toBe(true);
    expect(isHandoffOpen("resolved")).toBe(false);
    expect(isHandoffOpen("closed")).toBe(false);
  });

  it("high priority means high or urgent only", () => {
    expect(isHandoffHighPriority("high")).toBe(true);
    expect(isHandoffHighPriority("urgent")).toBe(true);
    expect(isHandoffHighPriority("normal")).toBe(false);
    expect(isHandoffHighPriority("low")).toBe(false);
  });

  it("creation bumps open, unclaimed and high counters from zero", () => {
    const next = mergeHandoffSnapshotChange(null, null, snapshot(), 100);
    expect(next.openCount).toBe(1);
    expect(next.unclaimedCount).toBe(1);
    expect(next.highPriorityCount).toBe(1);
    expect(next.lastHandoffAt).toBe(100);
  });

  it("a claimed (assigned) creation counts open but not unclaimed", () => {
    const next = mergeHandoffSnapshotChange(
      null,
      null,
      snapshot({ assignedToId: "op1" }),
      100,
    );
    expect(next.openCount).toBe(1);
    expect(next.unclaimedCount).toBe(0);
    expect(next.highPriorityCount).toBe(1);
  });

  it("claim moves unclaimed without touching open", () => {
    const created = mergeHandoffSnapshotChange(null, null, snapshot(), 100);
    const claimed = mergeHandoffSnapshotChange(
      created,
      snapshot(),
      snapshot({ status: "in_progress", assignedToId: "op1" }),
      200,
    );
    expect(claimed.openCount).toBe(1);
    expect(claimed.unclaimedCount).toBe(0);
    expect(claimed.highPriorityCount).toBe(1);
    // lastHandoffAt is creation-only and never moves on transitions.
    expect(claimed.lastHandoffAt).toBe(100);
  });

  it("priority change on a live ticket moves only the high counter", () => {
    const created = mergeHandoffSnapshotChange(
      null,
      null,
      snapshot({ priority: "normal" }),
      100,
    );
    expect(created.highPriorityCount).toBe(0);
    const raised = mergeHandoffSnapshotChange(
      created,
      snapshot({ priority: "normal" }),
      snapshot({ priority: "urgent" }),
      150,
    );
    expect(raised.openCount).toBe(1);
    expect(raised.unclaimedCount).toBe(1);
    expect(raised.highPriorityCount).toBe(1);
  });

  it("resolution decrements every counter the open ticket held", () => {
    const created = mergeHandoffSnapshotChange(null, null, snapshot(), 100);
    const resolved = mergeHandoffSnapshotChange(
      created,
      snapshot(),
      snapshot({ status: "resolved" }),
      300,
    );
    expect(resolved.openCount).toBe(0);
    expect(resolved.unclaimedCount).toBe(0);
    expect(resolved.highPriorityCount).toBe(0);
    expect(resolved.lastResolvedAt).toBe(300);
  });

  it("resolved→closed is a counter no-op with no new resolution stamp", () => {
    const created = mergeHandoffSnapshotChange(null, null, snapshot(), 100);
    const resolved = mergeHandoffSnapshotChange(
      created,
      snapshot(),
      snapshot({ status: "resolved" }),
      300,
    );
    const closed = mergeHandoffSnapshotChange(
      resolved,
      snapshot({ status: "resolved" }),
      snapshot({ status: "closed" }),
      400,
    );
    expect(closed.openCount).toBe(0);
    expect(closed.unclaimedCount).toBe(0);
    expect(closed.highPriorityCount).toBe(0);
    expect(closed.lastResolvedAt).toBe(300); // unchanged
  });

  it("reopen re-enters the open counters from resolved", () => {
    const created = mergeHandoffSnapshotChange(null, null, snapshot(), 100);
    const resolved = mergeHandoffSnapshotChange(
      created,
      snapshot(),
      snapshot({ status: "resolved" }),
      300,
    );
    const reopened = mergeHandoffSnapshotChange(
      resolved,
      snapshot({ status: "resolved" }),
      snapshot({ status: "open" }),
      500,
    );
    expect(reopened.openCount).toBe(1);
    expect(reopened.unclaimedCount).toBe(1);
    expect(reopened.highPriorityCount).toBe(1);
  });

  it("timestamps are forward-only against out-of-order writes", () => {
    const row = emptyRow(0);
    const late = mergeHandoffSnapshotChange(row, null, snapshot(), 50);
    expect(late.lastHandoffAt).toBe(50);
    const earlier = mergeHandoffSnapshotChange(late, null, snapshot(), 10);
    expect(earlier.lastHandoffAt).toBe(50); // not moved backwards
  });

  it("counters never go negative on a buggy replay", () => {
    const row = emptyRow();
    const next = mergeHandoffSnapshotChange(
      row,
      snapshot(), // "before" claims an open ticket that is not counted
      snapshot({ status: "resolved" }),
      100,
    );
    expect(next.openCount).toBe(0);
    expect(next.unclaimedCount).toBe(0);
    expect(next.highPriorityCount).toBe(0);
  });

  it("rebuild matches the delta-maintained row for a mixed history", () => {
    // Two live (one claimed urgent, one unclaimed normal), one resolved,
    // one closed — built purely by deltas.
    let row: HandoffViewRow | null = null;
    row = mergeHandoffSnapshotChange(row, null, snapshot({ priority: "urgent" }), 100);
    row = mergeHandoffSnapshotChange(row, null, snapshot({ priority: "normal" }), 200);
    row = mergeHandoffSnapshotChange(
      row,
      snapshot({ priority: "urgent" }),
      snapshot({ status: "in_progress", assignedToId: "op1", priority: "urgent" }),
      300,
    );
    row = mergeHandoffSnapshotChange(row, null, snapshot({ priority: "normal" }), 400);
    row = mergeHandoffSnapshotChange(
      row,
      snapshot({ priority: "normal" }),
      snapshot({ status: "resolved", priority: "normal" }),
      500,
    );
    row = mergeHandoffSnapshotChange(
      row,
      snapshot({ status: "resolved", priority: "normal" }),
      snapshot({ status: "closed", priority: "normal" }),
      600,
    );

    const rebuilt = rebuildHandoffRow(
      ORG,
      [
        { status: "in_progress", priority: "urgent", assignedToId: "op1", createdAt: 100, resolvedAt: null },
        { status: "open", priority: "normal", assignedToId: null, createdAt: 200, resolvedAt: null },
        { status: "resolved", priority: "normal", assignedToId: null, createdAt: 400, resolvedAt: 500 },
        { status: "closed", priority: "normal", assignedToId: null, createdAt: 400, resolvedAt: null },
      ],
      700,
    );
    expect(handoffCountersMatch(row, rebuilt)).toBe(true);
    expect(rebuilt.openCount).toBe(2);
    expect(rebuilt.unclaimedCount).toBe(1);
    expect(rebuilt.highPriorityCount).toBe(1);
    expect(rebuilt.lastHandoffAt).toBe(400);
    expect(rebuilt.lastResolvedAt).toBe(500);
  });

  it("drift check fails when any counter diverges", () => {
    const rebuilt = rebuildHandoffRow(
      ORG,
      [{ status: "open", priority: "high", assignedToId: null, createdAt: 100 }],
      200,
    );
    expect(handoffCountersMatch(rebuilt, rebuilt)).toBe(true);
    expect(handoffCountersMatch({ ...rebuilt, openCount: 2 }, rebuilt)).toBe(false);
    expect(handoffCountersMatch({ ...rebuilt, unclaimedCount: 9 }, rebuilt)).toBe(false);
    expect(handoffCountersMatch({ ...rebuilt, highPriorityCount: 3 }, rebuilt)).toBe(false);
  });
});
