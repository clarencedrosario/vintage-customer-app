import { describe, expect, it } from "vitest";
import {
  countBillableSeats,
  invitationBlocker,
  invitationStatus,
  invitationTokenHash,
  invitedEmailMatches,
  seatAvailable,
} from "./invitationFlow";

// ---------------------------------------------------------------------
// Invitation lifecycle (milestone 1 acceptance: invitation / activation /
// expiry / revocation) — pins the exact rules the server enforces in
// convex/invitations.ts through these pure functions.
// ---------------------------------------------------------------------

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function row(overrides: {
  usedAt?: number;
  revokedAt?: number;
  expiresAt?: number;
  createdAt?: number;
  email?: string;
} = {}) {
  return {
    usedAt: undefined,
    revokedAt: undefined,
    expiresAt: NOW + 7 * DAY,
    createdAt: NOW - DAY,
    email: "client@example.in",
    ...overrides,
  };
}

describe("invitationTokenHash", () => {
  it("hashes deterministically and differs across salts and tokens", () => {
    const a = invitationTokenHash("salt1", "token-abc");
    const b = invitationTokenHash("salt1", "token-abc");
    const otherSalt = invitationTokenHash("salt2", "token-abc");
    const otherToken = invitationTokenHash("salt1", "token-xyz");

    expect(a).toBe(b);
    expect(a).not.toBe(otherSalt);
    expect(a).not.toBe(otherToken);
  });

  it("matches an independent SHA-256 of 'salt:raw' (64 hex chars)", () => {
    // SHA-256("abc:def456") via node:crypto, cross-checking crypto.ts.
    expect(invitationTokenHash("abc", "def456")).toBe(
      "2091fb95d09e0903a16d104adaddeea4a4368bc130c1070fa476688ae0e83a10",
    );
  });
});

describe("invitationStatus (register derivation)", () => {
  it("reports pending for a live, unused invitation", () => {
    expect(invitationStatus(row(), NOW)).toBe("pending");
  });

  it("reports accepted once used, even after expiry passes", () => {
    expect(invitationStatus(row({ usedAt: NOW }), NOW)).toBe("accepted");
    expect(
      invitationStatus(row({ usedAt: NOW, expiresAt: NOW - DAY }), NOW),
    ).toBe("accepted");
  });

  it("reports revoked with top precedence, even over accepted", () => {
    expect(invitationStatus(row({ revokedAt: NOW }), NOW)).toBe("revoked");
    expect(
      invitationStatus(row({ revokedAt: NOW, usedAt: NOW }), NOW),
    ).toBe("revoked");
  });

  it("reports expired only past the expiry instant", () => {
    const expiring = row({ expiresAt: NOW + 1000 });
    expect(invitationStatus(expiring, NOW)).toBe("pending");
    expect(invitationStatus(expiring, NOW + 1001)).toBe("expired");
    // Boundary: exactly at expiry it is still pending (server uses >).
    expect(invitationStatus(expiring, NOW + 1000)).toBe("pending");
  });
});

describe("invitationBlocker (acceptance gating precedence)", () => {
  it("blocks unknown tokens", () => {
    expect(invitationBlocker(null, NOW)).toBe("not_valid");
    expect(invitationBlocker(undefined, NOW)).toBe("not_valid");
  });

  it("blocks already-used and revoked invitations before expiry", () => {
    const base = row({ expiresAt: NOW - DAY });
    expect(invitationBlocker({ ...base, usedAt: NOW }, NOW)).toBe(
      "already_used",
    );
    expect(invitationBlocker({ ...base, revokedAt: NOW }, NOW)).toBe("revoked");
  });

  it("blocks expired invitations and reports no blocker for a valid one", () => {
    expect(invitationBlocker(row({ expiresAt: NOW - 1 }), NOW)).toBe("expired");
    expect(
      invitationBlocker(
        { usedAt: undefined, revokedAt: undefined, expiresAt: NOW + DAY, email: "c@x.in" },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("invitedEmailMatches", () => {
  it("matches case-insensitively and trims whitespace", () => {
    expect(invitedEmailMatches("Client@Example.in", "  client@example.in ")).toBe(
      true,
    );
  });

  it("rejects a different email or a missing verified email", () => {
    expect(invitedEmailMatches("client@example.in", "other@example.in")).toBe(
      false,
    );
    expect(invitedEmailMatches("client@example.in", null)).toBe(false);
    expect(invitedEmailMatches("client@example.in", undefined)).toBe(false);
  });
});

describe("seat counting (section 24)", () => {
  const members = [
    { status: "active" },
    { status: "active", seatExempt: true },
    { status: "active", seatExempt: false },
    { status: "suspended" },
    { status: "invited" },
  ];

  it("counts only active, non-exempt memberships as billable", () => {
    expect(countBillableSeats(members)).toBe(2);
  });

  it("seatAvailable honors the limit, exemptions and unlimited plans", () => {
    expect(seatAvailable(2, members, false)).toBe(false); // full
    expect(seatAvailable(3, members, false)).toBe(true); // one free
    expect(seatAvailable(2, members, true)).toBe(true); // exempt invitee passes
    expect(seatAvailable(null, members, false)).toBe(true); // no cap
  });
});
