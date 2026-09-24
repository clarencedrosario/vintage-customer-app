// ---------------------------------------------------------------------
// Pure invitation lifecycle — no Convex context, no I/O.
//
// Same pattern as accessPolicy.ts / outcomeFlow.ts: the server functions
// in convex/invitations.ts delegate here so the acceptance rules are
// unit-tested without a live deployment. Token hashing (SHA-256 with a
// per-invite salt) and the status register derivation are also pure and
// tested from here via crypto.ts.
// ---------------------------------------------------------------------

// Relative import: the Convex bundler does not apply the Vite "@" alias,
// and this module is imported from convex/invitations.ts.
import { sha256Hex } from "../convex/crypto";

// ---------------------------------------------------------------
// Token hashing (mirrors convex/invitations.ts)
// ---------------------------------------------------------------

/** Invitations are hashed with a per-invite salt. */
export function invitationTokenHash(salt: string, raw: string): string {
  return sha256Hex(`${salt}:${raw}`);
}

/** Per-invite salt generator (same shape as the server used before). */
export function freshInviteSalt(now = Date.now()): string {
  return now.toString(36) + Math.floor(Math.random() * 1e9).toString(36);
}

// ---------------------------------------------------------------
// Invitation status register
// ---------------------------------------------------------------

export type InvitationRowLike = {
  revokedAt?: number | null;
  usedAt?: number | null;
  expiresAt: number;
  createdAt: number;
};

export type InvitationStatus =
  | "revoked"
  | "accepted"
  | "expired"
  | "pending";

/**
 * Status shown in the invitation register. Precedence mirrors what
 * `accept` enforces: revocation and use are permanent; expiry is
 * evaluated against the register's render time (Date.now() on the
 * server), not a stale timestamp.
 */
export function invitationStatus(
  row: InvitationRowLike,
  now: number,
): InvitationStatus {
  if (row.revokedAt) return "revoked";
  if (row.usedAt) return "accepted";
  if (now > row.expiresAt) return "expired";
  return "pending";
}

// ---------------------------------------------------------------
// Acceptance validation
// ---------------------------------------------------------------

export type InviteLike = {
  usedAt?: number | null;
  revokedAt?: number | null;
  expiresAt: number;
  email: string;
};

/**
 * Canonical reason an invitation cannot be accepted, or null when the
 * invitation itself is acceptable. The server applies the same checks in
 * the same order; this function exists so the rules are pinned by tests.
 */
export function invitationBlocker(
  invite: InviteLike | null | undefined,
  now: number,
): "not_valid" | "already_used" | "revoked" | "expired" | null {
  if (!invite) return "not_valid";
  if (invite.usedAt) return "already_used";
  if (invite.revokedAt) return "revoked";
  if (now > invite.expiresAt) return "expired";
  return null;
}

/**
 * An invitation may only be accepted by the invited email, compared
 * case-insensitively after trimming (emails are stored normalized).
 */
export function invitedEmailMatches(
  inviteEmail: string,
  userEmail: string | null | undefined,
): boolean {
  if (!userEmail) return false;
  return userEmail.trim().toLowerCase() === inviteEmail.trim().toLowerCase();
}

// ---------------------------------------------------------------
// Seat counting (section 24)
// ---------------------------------------------------------------

export type MemberLike = {
  status: string;
  seatExempt?: boolean | null;
};

/**
 * Billable members are active seats not explicitly exempt. Seat-exempt
 * memberships (owner/administrator acting as firm administrators) never
 * count toward the plan limit.
 */
export function countBillableSeats(members: MemberLike[]): number {
  return members.filter(
    (m) => m.status === "active" && m.seatExempt !== true,
  ).length;
}

/**
 * Can an invitee join when the plan caps seats? Exempt invitees always
 * pass; otherwise the org must have a free billable seat.
 */
export function seatAvailable(
  seatLimit: number | null,
  members: MemberLike[],
  incomingIsExempt: boolean,
): boolean {
  if (incomingIsExempt) return true;
  if (seatLimit === null) return true;
  return countBillableSeats(members) < seatLimit;
}
