// =====================================================================
// Regression tests for the signed-in Continue flow (SessionGate).
//
// INCIDENT (12 Oct): a signed-in account was stuck on "You are already
// signed in" — Continue linked to /login (self-loop) when the account
// had no resolved portal. These tests render the real component with
// mocked Convex hooks and router and pin the observed Continue link
// destination for each flow:
//   1. signed-in platform owner, returnTo=/owner → /owner
//   2. eligible owner without returnTo → /owner
//   3. ordinary customer → their own workspace (portal home / returnTo)
//   4. unauthenticated visitor's returnTo is preserved through the
//      destination policy (RequireAuth-side contract unit-tested in
//      postAuthDestination.test.ts; here the safe-returnTo path wins)
//   5. invalid/unauthorized destinations → safe fallback, never /login
//
// INCIDENT (13 Oct, preview bug fix): useQuery(workforce.myPlatformIdentity)
// sat BELOW the `twoFactorNeeded` and `resolved === undefined` early
// returns, so the render on which `orgs.resolve` resolved (or the first
// authenticated render after a 2FA-needed one) executed one extra Convex
// useQuery hook and React threw "Rendered more hooks than during the
// previous render". Fixed by hoisting every hook above the early returns.
// The hook-order block below reproduces those transitions with a stub
// that engages React's real dispatcher (a real useMemo per useQuery
// call), so a conditional hook still violates the invariant in tests.
// =====================================================================
import { describe, expect, it, vi, afterEach, afterAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

const useQuery = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("convex/react", async () => {
  const { useMemo } = await import("react");
  return {
    useQuery: (...args: unknown[]) => {
      // A REAL hook call (React hook dispatcher engaged) on every render
      // routed through this stub. Conditional hook execution anywhere in
      // the component then reproduces React's hook-order invariant —
      // otherwise a plain stub would silently hide the bug.
      useMemo(() => "useQuery-subscription-slot", []);
      return useQuery(...args);
    },
    useMutation: () => async () => undefined,
  };
});

vi.mock("@/convex/_generated/api", () => ({
  // Leaf refs are readable strings ("orgs.resolve") so the hook stub can
  // identify which query a component subscribes to.
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

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isLoading: false,
    isAuthenticated: true,
    user: { email: "owner@example.test" },
    signOut: async () => undefined,
  }),
}));

import { SessionGate } from "./Login";

/** Identify which query the component is subscribing to. */
function queryName(fn: unknown): string {
  return typeof fn === "string" ? fn : "";
}

function stubQueries(opts: {
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

const PLATFORM_OWNER_IDENTITY = {
  isPlatformAdmin: true,
  platformRole: null,
};

const WORKFORCE_IDENTITY = {
  isPlatformAdmin: false,
  platformRole: "support_agent",
};

function renderGate(wrapper?: { initialEntry?: string }) {
  return render(
    <MemoryRouter initialEntries={[wrapper?.initialEntry ?? "/login"]}>
      <Routes>
        <Route path="/login" element={<SessionGate twoFactorNeeded={false} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function continueHref(): string {
  const link = screen.getByRole("link", { name: /continue/i });
  return link.getAttribute("href") ?? "";
}

describe("SessionGate Continue — platform owner flows", () => {
  it("routes a signed-in platform owner with returnTo=/owner back to /owner", async () => {
    stubQueries({ portal: null, identity: PLATFORM_OWNER_IDENTITY });
    renderGate({ initialEntry: "/login?returnTo=%2Fowner" });
    await waitFor(() => expect(continueHref()).toBe("/owner"));
  });

  it("an owner clicking Continue with no returnTo resumes at /owner", async () => {
    stubQueries({ portal: null, identity: PLATFORM_OWNER_IDENTITY });
    renderGate({ initialEntry: "/login" });
    await waitFor(() => expect(continueHref()).toBe("/owner"));
  });

  it("an active workforce member (non-admin platform identity) also lands at /owner", async () => {
    stubQueries({ portal: null, identity: WORKFORCE_IDENTITY });
    renderGate({ initialEntry: "/login?returnTo=%2Fowner" });
    await waitFor(() => expect(continueHref()).toBe("/owner"));
  });
});

describe("SessionGate Continue — ordinary customer workspaces", () => {
  it("a firm owner resumes at /dashboard (or their returnTo)", async () => {
    stubQueries({ portal: "firm", identity: null });
    renderGate({ initialEntry: "/login" });
    await waitFor(() => expect(continueHref()).toBe("/dashboard"));
  });

  it("a client resumes at /portal; returnTo preserves deep links", async () => {
    stubQueries({ portal: "client", identity: null });
    renderGate({ initialEntry: "/login?returnTo=%2Fportal%3Ftab%3Dprofile" });
    await waitFor(() => expect(continueHref()).toBe("/portal?tab=profile"));
  });

  it("a staff member resumes at /staff", async () => {
    stubQueries({ portal: "staff", identity: null });
    renderGate({ initialEntry: "/login" });
    await waitFor(() => expect(continueHref()).toBe("/staff"));
  });
});

describe("SessionGate Continue — unauthenticated returnTo preservation", () => {
  // The returnTo arrives on the URL when RequireAuth bounces an
  // unauthenticated visitor; after sign-in the same value is read here.
  // The component honors any safe internal path — the portal home is
  // only the no-returnTo fallback.
  it("preserves the bounced protected destination for a portal account", async () => {
    stubQueries({ portal: "firm", identity: null });
    renderGate({ initialEntry: "/login?returnTo=%2Fbilling" });
    await waitFor(() => expect(continueHref()).toBe("/billing"));
  });

  it("preserves returnTo for a portal-less account too (settings hub)", async () => {
    stubQueries({ portal: null, identity: null });
    renderGate({ initialEntry: "/login?returnTo=%2Fsettings" });
    await waitFor(() => expect(continueHref()).toBe("/settings"));
  });
});

describe("SessionGate Continue — invalid or unauthorized destinations", () => {
  it("never links Continue back to /login (the self-loop fix)", async () => {
    stubQueries({ portal: null, identity: null });
    renderGate({ initialEntry: "/login?returnTo=%2Flogin" });
    await waitFor(() => expect(continueHref()).not.toBe("/login"));
  });

  it("rejects absolute and scheme-relative returnTo values", async () => {
    stubQueries({ portal: "firm", identity: null });
    renderGate({ initialEntry: "/login?returnTo=https%3A%2F%2Fevil.example" });
    await waitFor(() => expect(continueHref()).toBe("/dashboard"));
  });

  it("rejects backslash returnTo tricks normalized by browsers", async () => {
    stubQueries({ portal: "client", identity: null });
    renderGate({ initialEntry: "/login?returnTo=%2Fx%5Cevil.example" });
    await waitFor(() => expect(continueHref()).toBe("/portal"));
  });

  it("rejects a returnTo while identity info is loading (no premature /login)", async () => {
    // myPlatformIdentity still loading: the fallback chain is used, which
    // also can never be /login.
    useQuery.mockImplementation((fn: unknown) => {
      if (queryName(fn) === "workforce.myPlatformIdentity") return undefined;
      return { portal: null, role: null };
    });
    renderGate({ initialEntry: "/login" });
    await waitFor(() => expect(continueHref()).toBe("/settings"));
  });
});

// ---------------------------------------------------------------------
// Hook-order stability (13 Oct preview incident regression).
//
// The stub above calls a real useMemo for every Convex useQuery call, so
// the component's hook count is enforced by React itself. These tests
// re-render through the exact transitions that crashed the preview:
//   loading (orgs.resolve undefined) → resolved, and
//   2FA-needed branch ↔ no-2FA branch.
// The final UI assertions also pin that the Continue/2FA behavior is
// unchanged — the fix only reorders hooks.
// ---------------------------------------------------------------------
describe("SessionGate — hook-order stability", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  afterEach(() => {
    consoleError.mockClear();
  });
  afterAll(() => {
    consoleError.mockRestore();
  });

  function gateElement(twoFactorNeeded: boolean) {
    return (
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<SessionGate twoFactorNeeded={twoFactorNeeded} />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("loading → resolved transition uses a stable hook order (no 'Rendered more hooks')", async () => {
    let resolved = false;
    useQuery.mockImplementation((fn: unknown) => {
      if (queryName(fn) === "orgs.resolve") {
        return resolved ? { portal: "firm", role: null } : undefined;
      }
      if (queryName(fn) === "workforce.myPlatformIdentity") return null;
      return undefined;
    });

    const view = render(gateElement(false));
    expect(view.container.textContent).toContain("Checking your access");

    // The Convex subscription resolves: the same component instance now
    // takes the non-loading branch. Pre-fix, this render executed one
    // MORE hook than the previous render and the preview crashed.
    resolved = true;
    view.rerender(gateElement(false));

    await waitFor(() => expect(continueHref()).toBe("/dashboard"));
    for (const call of consoleError.mock.calls) {
      expect(String(call[0])).not.toMatch(/Rendered more hooks|Rendered fewer hooks/);
    }
  });

  it("2FA-needed ↔ no-2FA rerender keeps a stable hook order and behavior", async () => {
    useQuery.mockImplementation((fn: unknown) => {
      if (queryName(fn) === "orgs.resolve") return { portal: "firm", role: null };
      if (queryName(fn) === "workforce.myPlatformIdentity") return null;
      return undefined;
    });

    const view = render(gateElement(false));
    await waitFor(() => expect(continueHref()).toBe("/dashboard"));

    view.rerender(gateElement(true));
    await waitFor(() =>
      expect(view.container.textContent).toContain("Two-factor required"),
    );

    view.rerender(gateElement(false));
    await waitFor(() => expect(continueHref()).toBe("/dashboard"));
    for (const call of consoleError.mock.calls) {
      expect(String(call[0])).not.toMatch(/Rendered more hooks|Rendered fewer hooks/);
    }
  });
});
