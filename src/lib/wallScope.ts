// =====================================================================
// §32 PHASE 7 — LEGAL HOLDS & ETHICAL WALLS.
// Pure helper: membership + wall-active evaluation, unit-exercised via
// the convex-test fixtures (no Convex imports here).
// =====================================================================

/** Who a wall may target — resolved from the user's active membership. */
export type WallScope =
  | { kind: "user"; userId: string }
  | { kind: "role"; orgRole: string }
  | { kind: "all" };

export type WallMembersInfo = {
  orgRole: string;
  status: string;
  userId: string;
};

export type WallActiveInfo = {
  scope: WallScope;
  startsAt: number;
  endsAt: number | null;
  matterIds: string[] | null; // null = every matter in the org
  liftedAt: number | null;
};

/** Is the wall currently in force? */
export function isWallActive(
  w: { startsAt: number; endsAt: number | null; liftedAt: number | null },
  now: number,
): boolean {
  if (w.liftedAt !== null) return false;
  if (w.startsAt > now) return false;
  return w.endsAt === null || w.endsAt > now;
}

/**
 * Does this membership fall inside the wall's scope? An out-of-scope
 * member keeps normal access — walls are precise, not blanket gag orders
 * the org cannot reason about.
 */
export function isMemberInScope(
  scope: WallScope,
  member: { orgRole: string; status: string; userId: string },
): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "role") return member.orgRole === scope.orgRole;
  return member.userId === scope.userId;
}

/** Does the wall cover this matter? */
export function wallCoversMatter(
  w: { matterIds: string[] | null },
  matterId: string,
): boolean {
  return w.matterIds === null || w.matterIds.includes(matterId);
}
