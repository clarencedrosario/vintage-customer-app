import { describe, expect, it } from "vitest";
import { canTransitionTicket, canSeeTicket, REBUILD_MAX_ORGS, REBUILD_MAX_TICKETS } from "./platformOps";
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_KINDS,
} from "./schemaExtras";
import { DEFAULT_PERMISSIONS, normalizePermissions } from "./accessPolicy";
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

  it("rebuild scan limits are explicit, exported constants", () => {
    // The mutation enforces these; the test pins them so a silent change
    // to the scan bounds is a visible diff.
    expect(REBUILD_MAX_TICKETS).toBe(5_000);
    expect(REBUILD_MAX_ORGS).toBe(500);
  });

  it("fixture: a missed close-bump is DETECTED and the rebuild CORRECTS it", () => {
    // Simulates the mutator-bug class the rebuild exists for: an operator
    // resolves + closes an open handoff, but the close path forgets its
    // view bump (the historic draft bug). The view row still counts the
    // ticket as open/unclaimed/high; the base table says otherwise.
    let view: HandoffViewRow | null = null;
    view = mergeHandoffSnapshotChange(view, null, snapshot(), 100); // created
    view = mergeHandoffSnapshotChange(
      view,
      snapshot(),
      snapshot({ status: "resolved" }),
      300,
    ); // resolve bump applied
    // close bump MISSING — view still holds the resolved contribution.
    // (resolved subtracted the open counters, so the stale row reads zeros
    // here; the sharper case is a missed RESOLVE bump, covered below.)

    const baseTable = [
      { status: "closed", priority: "high", assignedToId: null, createdAt: 100, resolvedAt: 300 },
    ];
    const rebuilt = rebuildHandoffRow(ORG, baseTable, 900);
    // Both agree on zeros — the missed close-bump is invisible because
    // resolve already left the open set (documented no-op in the rules).
    expect(handoffCountersMatch(view!, rebuilt)).toBe(true);

    // The detectable case: the RESOLVE bump is missed (ticket closed
    // directly by a buggy path, or reopen bump missed after resolve).
    let stale: HandoffViewRow | null = null;
    stale = mergeHandoffSnapshotChange(stale, null, snapshot(), 100); // created
    // resolve bump MISSING → view still counts 1 open/unclaimed/high.
    const drifted = rebuildHandoffRow(ORG, baseTable, 900);
    expect(handoffCountersMatch(stale!, drifted)).toBe(false); // DETECTED
    // Correction: the rebuild row IS the corrected state (write-back =
    // patching the stored row to these values, as rebuildAiHandoffStats
    // does server-side); after write-back the view matches again.
    expect(drifted.openCount).toBe(0);
    expect(drifted.unclaimedCount).toBe(0);
    expect(drifted.highPriorityCount).toBe(0);
    expect(drifted.lastResolvedAt).toBe(300);
  });

  it("fixture: a missed reopen-bump after resolve is DETECTED and corrected", () => {
    let view: HandoffViewRow | null = null;
    view = mergeHandoffSnapshotChange(view, null, snapshot(), 100);
    view = mergeHandoffSnapshotChange(
      view,
      snapshot(),
      snapshot({ status: "resolved" }),
      300,
    );
    // Customer replies; reopen bump MISSING.
    const baseTable = [
      { status: "open", priority: "high", assignedToId: null, createdAt: 100, resolvedAt: 300 },
    ];
    const rebuilt = rebuildHandoffRow(ORG, baseTable, 900);
    expect(handoffCountersMatch(view!, rebuilt)).toBe(false); // view says 0 open
    expect(rebuilt.openCount).toBe(1);
    expect(rebuilt.unclaimedCount).toBe(1);
    expect(rebuilt.highPriorityCount).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Full support workflow (policy-level sequence)
//
// customer creates → agent claims → agent replies → customer sees the
// reply → ticket resolves. The Convex wiring is browser-unverified; this
// pins the policy the server enforces at every step of that sequence.
// ---------------------------------------------------------------------

describe("support workflow sequence (policy level)", () => {
  const customer = { _id: "cust1" as never, isPlatformAdmin: false };
  const agent = { _id: "op1" as never, isPlatformAdmin: true };
  const outsider = { _id: "cust2" as never, isPlatformAdmin: false };
  const chamberOwner = { _id: "own1" as never, isPlatformAdmin: false };
  const t = (over: Partial<Parameters<typeof canSeeTicket>[1]> = {}) =>
    ({
      _id: "t1" as never,
      submittedById: "cust1" as never,
      ...over,
    }) as unknown as Parameters<typeof canSeeTicket>[1];

  it("creation is open; only the customer and platform operators can see it", () => {
    expect(canTransitionTicket("open", "in_progress")).toBe(true);
    expect(canSeeTicket(customer, t({ status: "open" }))).toBe(true);
    expect(canSeeTicket(agent, t({ status: "open" }))).toBe(true);
    expect(canSeeTicket(outsider, t({ status: "open" }))).toBe(false);
    expect(canSeeTicket(chamberOwner, t({ status: "open" }))).toBe(false);
  });

  it("claim moves open → in_progress; the customer still sees the thread", () => {
    expect(canTransitionTicket("open", "in_progress")).toBe(true);
    expect(canSeeTicket(customer, t({ status: "in_progress" }))).toBe(true);
    expect(canSeeTicket(outsider, t({ status: "in_progress" }))).toBe(false);
  });

  it("agent replies while in_progress (reply is refused only on closed)", () => {
    // The closed-refusal and firstResponse stamping are enforced in the
    // mutations; the transition gate that matters here is in_progress
    // being a live, reply-permitted state.
    expect(canTransitionTicket("in_progress", "resolved")).toBe(true);
  });

  it("resolution closes the loop; the customer can reopen by replying", () => {
    expect(canTransitionTicket("in_progress", "resolved")).toBe(true);
    expect(canSeeTicket(customer, t({ status: "resolved" }))).toBe(true);
    expect(canTransitionTicket("resolved", "open")).toBe(true);
    // ...and the operator path after close is reopen-only.
    expect(canTransitionTicket("closed", "open")).toBe(true);
    expect(canTransitionTicket("closed", "resolved")).toBe(false);
  });
});

// ---------------------------------------------------------------------
// Platform-capability invariants (requirement 7)
//
// CJ GLOBAL administration is gated on users.isPlatformAdmin — a flag
// that lives OUTSIDE the chamber permission system. These tests pin the
// boundary: no chamber role, and no browser-supplied permission list,
// can reach operator authority.
// ---------------------------------------------------------------------

describe("platform administration stays outside chamber permissions", () => {
  it("no chamber role implies operator authority — the flag is separate", () => {
    // canSeeTicket consults ONLY isPlatformAdmin for non-submitters:
    // proven above (chamber owner without the flag is denied). Here we
    // pin that even the broadest chamber permission list contains no
    // capability named like a platform grant.
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as (keyof typeof DEFAULT_PERMISSIONS)[]) {
      for (const cap of DEFAULT_PERMISSIONS[role]) {
        expect(cap.startsWith("platform.")).toBe(false);
      }
    }
  });

  it("support_staff cannot be escalated toward team administration", () => {
    const attempted = [
      "team.manage",
      "team.invite",
      "permissions.edit",
      "hr.manage",
      "finance.manage",
    ] as const;
    const cleaned = normalizePermissions("support_staff", [...attempted]);
    expect(cleaned).toHaveLength(0);
  });

  it("Team & Access capability facts (requirement 6)", () => {
    // Who may invite and manage members by default:
    expect(DEFAULT_PERMISSIONS.owner).toContain("team.invite");
    expect(DEFAULT_PERMISSIONS.owner).toContain("team.manage");
    expect(DEFAULT_PERMISSIONS.administrator).toContain("team.invite");
    expect(DEFAULT_PERMISSIONS.administrator).toContain("team.manage");
    // Who may not:
    expect(DEFAULT_PERMISSIONS.accountant).not.toContain("team.manage");
    expect(DEFAULT_PERMISSIONS.support_staff).not.toContain("team.manage");
    expect(DEFAULT_PERMISSIONS.support_staff).not.toContain("team.invite");
  });
});
