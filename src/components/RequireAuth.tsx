import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/** Portals in authorization order for console roles. */
function portalFor(role: string | undefined | null): "firm" | "lawyer" | "staff" | "client" | null {
  switch (role) {
    case "firm_owner":
    case "admin":
      return "firm";
    case "lawyer":
    case "user":
      return "lawyer";
    case "staff":
    case "member":
      return "staff";
    case "client":
      return "client";
    default:
      return null;
  }
}

/** Which portals may open the chamber console. */
const CONSOLE = new Set(["firm_owner", "admin", "lawyer", "user"]);

/**
 * Route guard. `portal` restricts the route to one portal's audience;
 * console routes additionally require 2FA satisfaction when enrolled.
 */
export function RequireAuth({
  children,
  portal,
}: {
  children: ReactNode;
  portal?: "client" | "staff" | "lawyer" | "firm";
}) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();
  const twoFactor = useQuery(api.twofactor.sessionSatisfied);

  if (isLoading) {
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
        to={`/login${portal ? `/${portal}` : ""}?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }

  // Two-factor gate: console portals require the session challenge.
  if (
    twoFactor !== undefined &&
    twoFactor.needed &&
    !twoFactor.satisfied &&
    (!portal || portal === "firm" || portal === "lawyer")
  ) {
    return (
      <Navigate
        to={`/login/${portal ?? "firm"}?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  if (portal) {
    const mine = portalFor(user?.role);
    if (mine !== portal) {
      // Send them to their own authorized home, not the selector.
      const home =
        mine === "client"
          ? "/portal"
          : mine === "staff"
            ? "/staff"
            : mine
              ? "/dashboard"
              : `/login/${portal}`;
      return <Navigate to={home} replace />;
    }
  } else if (!CONSOLE.has(user?.role ?? "")) {
    // Console routes (no explicit portal): non-console roles get bounced.
    const mine = portalFor(user?.role);
    return <Navigate to={mine === "client" ? "/portal" : mine === "staff" ? "/staff" : "/login"} replace />;
  }

  return children;
}
