// =====================================================================
// Post-authentication destination resolution for SIGNED-IN sessions.
//
// Regression context (12 Oct 2026): the signed-in gate at /login
// ("You are already signed in") linked Continue to /login when the
// account had no resolved portal (e.g. CJ GLOBAL platform identities,
// who hold no memberships row). Clicking Continue looped back to /issue
// the same gate — a dead end. The same /login fallback lived inside
// RequireAuth's `home`, so guard bounces could also dead-end there.
//
// Policy:
//   1. A SAFE internal returnTo is honored verbatim — this preserves
//      /owner as the destination when a signed-in platform identity
//      requests it (the auth bounce carries the intended path).
//   2. /login itself is never a destination: a returnTo of "/login"
//      (crafted or copy-pasted) falls through to the portal home.
//   3. Otherwise, the portal decides: client → /portal, staff → /staff,
//      firm → /dashboard; a platform identity with no memberships row
//      belongs at its console (/owner); any other authenticated account
//      goes to the account hub (/settings), which serves organisation
//      creation/invitation instead of looping back to /login.
//
// Redirect-safety rules mirror safeInternalPath() in appLinks: relative,
// same-origin paths only, backslashes treated as hostile (browsers
// normalize them to slashes in URLs).
// =====================================================================

/**
 * Home route for a resolved portal. `portal` is the value of
 * `orgs.resolve().portal`; a null portal means no active membership.
 */
export function portalHome(
  portal: string | null,
  isPlatformIdentity: boolean,
): string {
  if (portal === "client") return "/portal";
  if (portal === "staff") return "/staff";
  if (portal === "firm") return "/dashboard";
  // No memberships row: platform identities belong at their console;
  // everyone else lands on the account hub (never /login).
  return isPlatformIdentity ? "/owner" : "/settings";
}

function isSafeInternalPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    // Never loop back to the auth route itself.
    value !== "/login" &&
    !value.startsWith("/login?")
  );
}

/**
 * Where should a signed-in session continue to?
 *
 * @param returnTo            `?returnTo=` carried by the auth bounce.
 * @param portal              resolved portal from the server ("client" |
 *                            "staff" | "firm" | null).
 * @param isPlatformIdentity  live workspace identity (`workforce
 *                            .myPlatformIdentity`): platform admin or an
 *                            active workforce role.
 */
export function postAuthDestination(
  returnTo: string | null | undefined,
  portal: string | null,
  isPlatformIdentity: boolean,
): string {
  // returnTo wins whenever it is a plain internal path (open-redirect
  // safe) and not the auth route itself.
  if (returnTo && isSafeInternalPath(returnTo)) {
    return returnTo;
  }
  return portalHome(portal, isPlatformIdentity);
}
