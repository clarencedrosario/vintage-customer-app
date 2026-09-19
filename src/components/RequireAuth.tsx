import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Route guard. Authorization is resolved server-side in `orgs.resolve`:
 * active memberships first (all org roles except support staff open the
 * console), legacy portal roles as fallback. Clicking a card never
 * grants privileges.
 */
export function RequireAuth({
  children,
  portal,
}: {
  children: ReactNode;
  portal?: "client" | "staff" | "lawyer" | "firm";
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();
  const twoFactor = useQuery(api.twofactor.sessionSatisfied);
  const resolved = useQuery(api.orgs.resolve);

  if (isLoading || resolved === undefined) {
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
  const home =
    mine === "client" ? "/portal" : mine === "staff" ? "/staff" : mine === "firm" ? "/dashboard" : "/login";

  if (portal) {
    // Portal routes authorize server-side from memberships.
    const wanted = portal === "client" ? "client" : portal === "staff" ? "staff" : "firm";
    if (mine !== wanted) {
      return <Navigate to={mine ? home : "/login"} replace />;
    }
  } else if (mine !== "firm") {
    // Console routes: clients and staff go to their own portals.
    return <Navigate to={home} replace />;
  }

  return children;
}
