// ---------------------------------------------------------------------
// Layer 1 — Data isolation middleware.
//
// `enforceTenantIsolation` is this project's middleware function for
// backend data functions (Convex queries/mutations — the HTTP surface is
// the generated API, not an Express pipeline). Call it at the top of a
// handler; it intercepts the request before any data access:
//
//   1. Identity is resolved server-side from the verified auth session
//      via getAccessContext — the active membership determines
//      `organizationId`. What the browser claims is irrelevant.
//   2. Client-supplied identity fields (`tenantId`, `organization_id`,
//      `orgId`) are stripped from the incoming args (they are also never
//      declared in the args validators — Convex rejects undeclared
//      fields — this is defense-in-depth and documents the guarantee).
//   3. The server-resolved tenant is returned for the handler to scope
//      every read/write — the equivalent of appending
//      `req.query.tenantId` (GET) / `req.body.organization_id`
//      (mutations) in the requested design.
//
// Unauthenticated or org-less callers are refused before the handler.
// Pure decision rules live in src/lib/tenantIsolation.ts (unit-tested).
// ---------------------------------------------------------------------

import type { QueryCtx, MutationCtx } from "../_generated/server";
import { getAccessContext } from "../access";
import {
  TENANT_IDENTITY_FIELDS,
  resolveTenant,
} from "../../lib/tenantIsolation";
import type { TenantContext } from "../../lib/tenantIsolation";

export type TenantRequest = Record<string, unknown>;

/**
 * Intercepts an incoming backend request: resolves the logged-in user's
 * `organization_id` from the auth session and returns it as the request
 * tenant. Throws cleanly (no partial writes) for anonymous callers and
 * for signed-in users with no active organization.
 */
export async function enforceTenantIsolation(
  ctx: QueryCtx | MutationCtx,
  args: TenantRequest = {},
): Promise<TenantContext> {
  const ac = await getAccessContext(ctx);
  const verdict = resolveTenant(
    ac ? { userId: ac.user._id, organizationId: ac.org._id } : null,
    args,
  );
  if (!verdict.allowed) throw new Error(verdict.reason);
  return verdict.tenant;
}

export { TENANT_IDENTITY_FIELDS, resolveTenant };
export type { TenantContext };
