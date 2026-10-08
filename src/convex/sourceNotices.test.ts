// =====================================================================
// Official-source notice registry — pure data-module tests (no Convex
// runtime). Guards the invariants the connector's gates depend on, so a
// typo'd future notice fails a test instead of shipping a broken fetch
// target or an unsatisfiable sanity bound.
// =====================================================================
import { describe, expect, it } from "vitest";
import { OFFICIAL_SOURCE_NOTICES } from "./sourceNotices";

describe("official-source notice registry", () => {
  it("registers notices with permitted-download HTTPS targets and sane gates", () => {
    const keys = Object.keys(OFFICIAL_SOURCE_NOTICES);
    expect(keys.length).toBeGreaterThan(0);
    for (const [key, n] of Object.entries(OFFICIAL_SOURCE_NOTICES)) {
      // stableKey namespace: <country>:<kind>:<slug>
      expect(key).toMatch(/^in:(constitution|code|statute|rules|regulation|judgment|order|guidance|notification):/);
      // Plain HTTPS GET of a published document — never a login/CAPTCHA target.
      expect(n.url.startsWith("https://")).toBe(true);
      expect(n.publisher.length).toBeGreaterThan(0);
      expect(n.accessBasis).toMatch(/no login/i);
      // Sanity gates must be satisfiable: min sections can never exceed
      // the max section number the detector will look for.
      expect(n.maxNo).toBeGreaterThan(0);
      expect(n.minSections).toBeGreaterThan(0);
      expect(n.minSections).toBeLessThanOrEqual(n.maxNo);
    }
  });

  it("flags exactly the hosts that need pinned public TLS anchors", () => {
    const pinned = Object.entries(OFFICIAL_SOURCE_NOTICES)
      .filter(([, n]) => n.tlsFix === "lets-encrypt-aia")
      .map(([k]) => k);
    // Only egazette.gov.in is known to serve an incomplete chain; the
    // pinned path must stay the exception, never the default posture.
    expect(pinned).toEqual(["in:rules:dpdp-2025"]);
  });

  it("DPDP Rules notice targets the published English gazette PDF", () => {
    const n = OFFICIAL_SOURCE_NOTICES["in:rules:dpdp-2025"];
    expect(n.url).toBe("https://egazette.gov.in/WriteReadData/2025/267650.pdf");
    expect(n.maxNo).toBe(23); // observed 23/23 rules in the gazette PDF
    expect(n.minSections).toBe(20);
    expect(n.publisher).toMatch(/G\.S\.R\. 846\(E\)/);
    expect(n.accessBasis).toMatch(/verification fully enabled/);
  });

  it("JJ Act 2015 notice targets CARA's standalone verified reproduction", () => {
    const n = OFFICIAL_SOURCE_NOTICES["in:statute:jj-2015"];
    // Verified before registration (turn 31): 112/112 sections — the
    // Act's exact count — s 1 short title, s 112 savings, English layer.
    expect(n.url).toBe("https://cara.wcd.gov.in/pdf/jj%20act%202015.pdf");
    expect(n.maxNo).toBe(112);
    expect(n.minSections).toBe(100);
    expect(n.publisher).toMatch(/CARA|Central Adoption Resource Authority/);
    // The WAF-agent posture must stay explicit and bounded to this host.
    expect(n.accessBasis).toMatch(/no access control is bypassed/);
    expect(n.userAgent).toMatch(/^Mozilla\//);
    // The pinned-TLS exception must NOT have grown with the new notice.
    const pinned = Object.entries(OFFICIAL_SOURCE_NOTICES)
      .filter(([, m]) => m.tlsFix === "lets-encrypt-aia")
      .map(([k]) => k);
    expect(pinned).toEqual(["in:rules:dpdp-2025"]);
  });
});
