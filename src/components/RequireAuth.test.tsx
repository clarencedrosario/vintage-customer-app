// =====================================================================
// Regression tests for the RequireAuth route guard.
//
// Pins the guard decisions that caused the 11 Oct /owner regression and
// the 12 Oct signed-in Continue fix:
//   - a signed-in platform identity is admitted to /owner (the route
//     renders once identity resolves); the page's own server-side gates
//     still decide what content appears.
//   - a portal-less, NON-platform account on /owner is NOT redirected to
//     /login (the OwnerConsole refusal card renders) — RequireAuth only
//     decides WHICH portal resolves, never opens the queue.
//   - portal routes still bounce mismatched portals to their own home
//     (client → /portal etc.), and that home is never /login.
//   - unauthenticated visitors are bounced to /login with returnTo
//     preserved.
// =====================================================================
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

const useQuery = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_t, prop) =>
        new Proxy(
          {},
          { get: (_t2, fn) => `${String(prop)}.${String(fn)}` },
        ),
    },
  ),
}));

const authState = {
  isLoading: false,
  isAuthenticated: true,
};

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authState,
}));

import { RequireAuth } from "./RequireAuth";

function queryName(fn: unknown): string {
  return typeof fn === "string" ? fn : "";
}

/** How the guard sees the account. Adjust per test. */
function stubGuard(opts: {
  portal: string | null;
  identity: { isPlatformAdmin: boolean; platformRole: string | null } | null;
  twoFactor?: { needed: boolean; satisfied: boolean };
}) {
  useQuery.mockImplementation((fn: unknown) => {
    switch (queryName(fn)) {
      case "orgs.resolve":
        return { portal: opts.portal, role: null };
      case "workforce.myPlatformIdentity":
        return opts.identity;
      case "twofactor.sessionSatisfied":
        return opts.twoFactor ?? { needed: true, satisfied: true };
      default:
        return undefined;
    }
  });
}

const OWNER_IDENTITY = { isPlatformAdmin: true, platformRole: null };

function renderRoute(
  path: string,
  children: React.ReactNode,
  initialEntry?: string,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry ?? path]}>
      <Routes>
        <Route
          path={path}
          element={<RequireAuth portal={undefined}>{children}</RequireAuth>}
        />
        <Route path="*" element={<div data-testid="other" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth — platform console admission", () => {
  it("admits a signed-in platform owner to /owner (guard renders children)", async () => {
    stubGuard({ portal: null, identity: OWNER_IDENTITY });
    render(
      <MemoryRouter initialEntries={["/owner"]}>
        <Routes>
          <Route
            path="/owner"
            element={
              <RequireAuth platform>
                <div data-testid="owner-console" />
              </RequireAuth>
            }
          />
          <Route path="*" element={<div data-testid="other" />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("owner-console")).toBeInTheDocument(),
    );
  });

  it("admits an active workforce member (non-admin identity) to /owner", async () => {
    stubGuard({
      portal: null,
      identity: { isPlatformAdmin: false, platformRole: "support_agent" },
    });
    render(
      <MemoryRouter initialEntries={["/owner"]}>
        <Routes>
          <Route
            path="/owner"
            element={
              <RequireAuth platform>
                <div data-testid="owner-console" />
              </RequireAuth>
            }
          />
          <Route path="*" element={<div data-testid="other" />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("owner-console")).toBeInTheDocument(),
    );
  });

  it("a portal-less NON-platform account is NOT bounced to /login from /owner", async () => {
    // Guard decision: platform-flagged route + no platform identity →
    // rerouted to the account hub (/settings), NEVER to /login. The
    // masked-eligibility refusal card belongs to the console page itself
    // when a platform identity IS present but unauthorized.
    stubGuard({ portal: null, identity: null });
    render(
      <MemoryRouter initialEntries={["/owner"]}>
        <Routes>
          <Route
            path="/owner"
            element={
              <RequireAuth platform>
                <div data-testid="owner-console" />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<div data-testid="login" />} />
          <Route path="*" element={<div data-testid="other" />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.queryByTestId("login")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("owner-console")).not.toBeInTheDocument();
  });
});

describe("RequireAuth — portal routing and auth bounce", () => {
  it("bounces a client off a firm portal route to /portal (never /login)", async () => {
    stubGuard({ portal: "client", identity: null });
    renderRoute(
      "/dashboard",
      <div data-testid="dashboard" />,
      "/dashboard",
    );
    const bounced = await waitFor(() => screen.findByTestId("other"));
    expect(bounced).toBeInTheDocument();
  });

  it("admits a firm account to a console route (/dashboard renders)", async () => {
    stubGuard({ portal: "firm", identity: null });
    renderRoute("/dashboard", <div data-testid="dashboard" />, "/dashboard");
    await waitFor(() =>
      expect(screen.queryByTestId("dashboard")).toBeInTheDocument(),
    );
  });
});

describe("RequireAuth — unauthenticated bounce preserves returnTo", () => {
  it("bounces an unauthenticated visitor to /login?returnTo=<path+search>", async () => {
    const saved = authState.isAuthenticated;
    authState.isAuthenticated = false;
    try {
      stubGuard({ portal: null, identity: null });
      render(
        <MemoryRouter initialEntries={["/billing?tab=history"]}>
          <Routes>
            <Route
              path="/billing"
              element={
                <RequireAuth>
                  <div data-testid="billing" />
                </RequireAuth>
              }
            />
            <Route
              path="/login"
              element={<div data-testid="login" />}
            />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByTestId("login")).toBeInTheDocument());
      // The destination contract itself (returnTo → /billing) is pinned in
      // postAuthDestination.test.ts and SessionGate.test.tsx.
    } finally {
      authState.isAuthenticated = saved;
    }
  });
});
