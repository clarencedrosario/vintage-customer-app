// ---------------------------------------------------------------------
// Layer 1 — Data isolation (pure policy).
//
// Pure functions live here so the enforcement rules are unit-tested
// without a deployment; `src/convex/middleware/security.ts` binds them
// to the platform middleware mechanism (customQuery / customMutation)
// for every wrapped endpoint.
//
// Tenant identity is ALWAYS resolved server-side from the verified auth
// session (active membership) — never from a browser-supplied
// organization_id, tenantId or orgId field. Client-supplied identity
// fields are stripped before the handler runs: a caller who names
// another tenant in the payload gains nothing, because the handler
// receives only the server-resolved id.
// ---------------------------------------------------------------------

export const TENANT_IDENTITY_FIELDS = [
  "tenantId",
  "organization_id",
  "orgId",
] as const;

export type IdentityLike = {
  userId: string;
  organizationId: string | null | undefined;
};

export type TenantContext = {
  userId: string;
  organizationId: string;
};

export type TenantVerdict =
  | {
      allowed: true;
      tenant: TenantContext;
      sanitizedArgs: Record<string, unknown>;
    }
  | { allowed: false; reason: string };

/**
 * Resolve the request's tenant from the verified session identity and
 * strip every client-supplied identity field from the payload. The
 * returned `sanitizedArgs` are what the handler actually receives —
 * the validated-args equivalent of overwriting `req.query.tenantId` /
 * `req.body.organization_id` in an Express pipeline.
 */
export function resolveTenant(
  identity: IdentityLike | null | undefined,
  args: Record<string, unknown>,
): TenantVerdict {
  if (!identity) {
    return { allowed: false, reason: "Sign in to continue." };
  }
  if (!identity.organizationId) {
    return {
      allowed: false,
      reason: "Select an organization before accessing firm data.",
    };
  }

  const sanitizedArgs: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if ((TENANT_IDENTITY_FIELDS as readonly string[]).includes(key)) continue;
    sanitizedArgs[key] = args[key];
  }

  return {
    allowed: true,
    tenant: { userId: identity.userId, organizationId: identity.organizationId },
    sanitizedArgs,
  };
}

/**
 * Defense-in-depth for handler-side reads: does a fetched row belong to
 * the resolved tenant? Handlers never trust a bare record id from the
 * browser — the row's own orgId must match the session tenant.
 */
export function rowBelongsToTenant(
  row: { orgId?: string } | null | undefined,
  tenant: TenantContext,
): boolean {
  return !!row && row.orgId === tenant.organizationId;
}
