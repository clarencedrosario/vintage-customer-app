// =====================================================================
// Unit tests for src/lib/appLinks.ts — the link-base resolution policy.
//
// The production domain must stay configuration, not code:
//   1. configured base (VITE_PUBLIC_APP_URL) wins, normalized to a bare
//      origin,
//   2. otherwise the LIVE window.location.origin (the preview) is used,
//   3. unparseable/empty config never breaks link generation.
//
// Vite injects import.meta.env statically, so vi.stubEnv cannot affect
// the app build's env object at runtime; the helper exposes an explicit
// __setConfiguredBaseForTests hook that behaves identically to a
// configured VITE_PUBLIC_APP_URL and is what these tests drive.
// =====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appLink, appOrigin, __setConfiguredBaseForTests as setBase } from "./appLinks";

const LIVE_ORIGIN = window.location.origin; // jsdom default: http://localhost:3000

beforeEach(() => setBase(null));
afterEach(() => setBase(null));

describe("appOrigin — configured value wins", () => {
  it("returns the bare origin of a full URL", () => {
    setBase("https://example.com");
    expect(appOrigin()).toBe("https://example.com");
  });

  it("ignores trailing slashes, paths, query and hash (origin only)", () => {
    setBase("https://example.com/app/path/?x=1#top");
    expect(appOrigin()).toBe("https://example.com");
  });

  it("adds the https scheme when the configured value omits it", () => {
    setBase("newdomain.example");
    expect(appOrigin()).toBe("https://newdomain.example");
  });

  it("normalizes scheme and host casing", () => {
    setBase("HTTPS://EXAMPLE.COM");
    expect(appOrigin()).toBe("https://example.com");
  });

  it("keeps a nonstandard port", () => {
    setBase("http://localhost:5173");
    expect(appOrigin()).toBe("http://localhost:5173");
  });

  it("configured value beats the live origin", () => {
    setBase("https://prod.example");
    expect(appOrigin()).toBe("https://prod.example");
  });
});

describe("appOrigin — falls back to the live preview origin", () => {
  it("empty and whitespace config count as unconfigured", () => {
    setBase("   ");
    expect(appOrigin()).toBe(LIVE_ORIGIN);
  });

  it("unparseable config falls back instead of throwing", () => {
    // Regression: a pre-test bug stripped slashes before the scheme check,
    // turning "http://" into a bogus "https://http" origin.
    setBase("http://");
    expect(appOrigin()).toBe(LIVE_ORIGIN);
  });

  it("null override behaves exactly as unconfigured", () => {
    setBase(null);
    expect(appOrigin()).toBe(LIVE_ORIGIN);
  });

  it("reads the LIVE origin at call time (not frozen at import)", () => {
    setBase(null);
    // jsdom forbids history.replaceState across origins, so swap the window
    // global instead; vitest.setup.ts calls vi.unstubAllGlobals() afterEach.
    vi.stubGlobal("window", { location: { origin: "https://staging.example.org" } });
    expect(appOrigin()).toBe("https://staging.example.org");
  });
});

describe("appLink", () => {
  it("joins an absolute path onto the resolved origin", () => {
    setBase("https://example.com");
    expect(appLink("/owner")).toBe("https://example.com/owner");
  });

  it("adds the leading slash when the path omits it", () => {
    setBase("https://example.com");
    expect(appLink("owner?tab=queue")).toBe("https://example.com/owner?tab=queue");
  });

  it("builds on the live preview origin when unconfigured", () => {
    setBase(null);
    expect(appLink("/accept-platform-invite?token=tok")).toBe(
      `${LIVE_ORIGIN}/accept-platform-invite?token=tok`,
    );
  });

  it("always returns an absolute URL — never a bare relative path", () => {
    setBase(null);
    expect(appLink("/owner")).toMatch(/^https?:\/\//);
  });
});
