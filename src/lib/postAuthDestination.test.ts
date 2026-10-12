// =====================================================================
// Regression tests for post-auth destination resolution.
//
// Covers the signed-in Continue flow cases from INCIDENT turn 6:
//   1. signed-in user clicking Continue (portal-resolved homes)
//   2. authenticated navigation to /owner (platform identity returnTo
//      honored; platform identity fallback → /owner; non-platform
//      returnTo /owner still honored — the console's own server-side
//      gates render the refusal, the client never opens the queue)
//   3. ordinary customer workspace routing (client/staff/firm)
//   4. unauthenticated access + returnTo preservation (safe paths kept)
//   5. invalid/unauthorized destinations (open-redirect + /login loop)
// =====================================================================
import { describe, expect, it } from "vitest";
import { portalHome, postAuthDestination } from "./postAuthDestination";

describe("postAuthDestination — signed-in user clicking Continue", () => {
  it("uses the portal home when there is no returnTo", () => {
    expect(postAuthDestination(null, "firm", false)).toBe("/dashboard");
    expect(postAuthDestination(undefined, "client", false)).toBe("/portal");
    expect(postAuthDestination(null, "staff", false)).toBe("/staff");
  });

  it("honors a safe returnTo over the portal home", () => {
    expect(postAuthDestination("/matters/abc", "firm", false)).toBe(
      "/matters/abc",
    );
    expect(postAuthDestination("/settings", null, false)).toBe("/settings");
  });
});

describe("postAuthDestination — authenticated navigation to /owner", () => {
  it("keeps /owner for a signed-in platform identity via returnTo", () => {
    // RequireAuth bounces a 2FA-pending platform identity to
    // /login?returnTo=/owner — Continue must resume /owner, not loop.
    expect(postAuthDestination("/owner", null, true)).toBe("/owner");
  });

  it("sends a platform identity with no portal to /owner without returnTo", () => {
    expect(postAuthDestination(null, null, true)).toBe("/owner");
  });

  it("sends a NON-platform identity that asked for /owner back to /owner (refusal card renders)", () => {
    // The destination is preserved; OwnerConsole's server-side gates show
    // the masked-eligibility refusal — the queue never renders for them.
    expect(postAuthDestination("/owner", null, false)).toBe("/owner");
    expect(postAuthDestination("/owner", "firm", false)).toBe("/owner");
  });
});

describe("postAuthDestination — ordinary customer workspace routing", () => {
  it("routes each resolved portal to its own workspace", () => {
    expect(portalHome("client", false)).toBe("/portal");
    expect(portalHome("staff", false)).toBe("/staff");
    expect(portalHome("firm", false)).toBe("/dashboard");
  });

  it("portal home beats an unsafe/absent returnTo", () => {
    expect(postAuthDestination("https://evil.example", "client", false)).toBe(
      "/portal",
    );
    expect(postAuthDestination("", "staff", false)).toBe("/staff");
  });
});

describe("postAuthDestination — unauthenticated access + returnTo preservation", () => {
  // RequireAuth builds the bounce: /login?returnTo=<path+search>. These
  // tests pin the resolver half of that contract for every route shape.
  it("preserves plain paths (preserves the ?returnTo contract)", () => {
    for (const path of [
      "/settings",
      "/matters",
      "/matters/m1",
      "/billing",
      "/owner",
    ]) {
      expect(postAuthDestination(path, null, false)).toBe(path);
    }
  });

  it("preserves query strings inside the returnTo value", () => {
    expect(postAuthDestination("/billing?tab=history", null, false)).toBe(
      "/billing?tab=history",
    );
  });

  it("an unsafe returnTo falls back to the portal home (never lost)", () => {
    expect(postAuthDestination("https://evil.example", null, false)).toBe(
      "/settings",
    );
    expect(postAuthDestination("//evil.example", "firm", false)).toBe(
      "/dashboard",
    );
    expect(postAuthDestination("/x\\evil.example", "client", false)).toBe(
      "/portal",
    );
  });
});

describe("postAuthDestination — invalid or unauthorized destinations", () => {
  it("never sends a signed-in user back to /login (the self-loop fix)", () => {
    expect(postAuthDestination("/login", null, false)).toBe("/settings");
    expect(postAuthDestination("/login", "firm", false)).toBe("/dashboard");
    expect(postAuthDestination("/login", null, true)).toBe("/owner");
    expect(postAuthDestination("/login?reason=signedout", "client", false)).toBe(
      "/portal",
    );
  });

  it("rejects scheme-relative and absolute returnTo values", () => {
    expect(postAuthDestination("//example.com/x", null, true)).toBe("/owner");
    expect(postAuthDestination("https://example.com/x", "firm", false)).toBe(
      "/dashboard",
    );
    expect(
      postAuthDestination("javascript:alert(1)", "client", false),
    ).toBe("/portal");
  });

  it("rejects backslash tricks normalized by browsers", () => {
    expect(postAuthDestination("/login\\evil", "staff", false)).toBe("/staff");
  });
});
