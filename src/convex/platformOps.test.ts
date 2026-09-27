import { describe, expect, it } from "vitest";
import { canTransitionTicket, canSeeTicket } from "./platformOps";
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_KINDS,
} from "./schemaExtras";

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
