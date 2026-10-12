import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { portalHome } from "@/lib/postAuthDestination";

/**
 * Route guard. Authorization is resolved server-side in `orgs.resolve`:
 * active memberships first (all org roles except support staff open the
 * console), legacy portal roles as fallback. Clicking a card never
 * grants privileges.
 */
export function RequireAuth({
  children,
  portal,
  platform,
}: {
  children: ReactNode;
  portal?: "client" | "staff" | "lawyer" | "firm";
  /** Console routes that admit CJ GLOBAL internal accounts (platform
   *  owner / workforce). The actual operator authorization still happens
   *  server-side (platform.amIPlatformAdmin / workforce.myPlatformIdentity
   *  + capability gates); this guard only decides WHICH portal resolves. */
  platform?: boolean;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  const twoFactor = useQuery(api.twofactor.sessionSatisfied);
  const resolved = useQuery(api.orgs.resolve);
  const platformIdentity = useQuery(api.workforce.myPlatformIdentity);
  const platformIdentityResolved = platformIdentity !== undefined;
  const isPlatformIdentity =
    platformIdentity !== undefined &&
    platformIdentity !== null &&
    (platformIdentity.isPlatformAdmin ||
      platformIdentity.platformRole !== null);

  if (isLoading || resolved === undefined || (platform && !platformIdentityResolved)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  // Two-factor gate: console routes require the session challenge.
  const consolePortal = !portal || portal === "firm";
  if (
    twoFactor !== undefined &&
    twoFactor.needed &&
    !twoFactor.satisfied &&
    consolePortal
  ) {
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  const mine = resolved.portal; // "client" | "staff" | "firm" | null
  // Shared with SessionGate's Continue resolution: a platform identity
  // with no memberships row homes at /owner (never /login); other
  // portal-less accounts land on the account hub (/settings).
  const home = portalHome(mine, isPlatformIdentity);

  if (portal) {
    // Portal routes authorize server-side from memberships.
    const wanted = portal === "client" ? "client" : portal === "staff" ? "staff" : "firm";
    if (mine !== wanted) {
      return <Navigate to={mine ? home : "/login"} replace />;
    }
  } else if (platform && isPlatformIdentity) {
    // Platform console routes admit CJ GLOBAL internal accounts once
    // authentication passes; the page itself enforces the real operator
    // authorization (and the internal MFA challenge) server-side.
  } else if (mine !== "firm") {
    // Console routes: clients and staff go to their own portals.
    return <Navigate to={home} replace />;
  }

  return children;
}
