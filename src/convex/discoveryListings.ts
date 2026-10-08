// Registered official LISTING pages for the automated discovery pipeline
// (turn 32) — pure data, no Convex function definitions, importable from
// the "use node" action module (legalDiscovery.ts) and from tests.
//
// Deliberately tiny: each entry records the VERIFIED evidence for why
// automated scanning of the listing page itself is permitted. A listing
// is added only after a plain-GET probe demonstrates automated access is
// served on the same terms as browser access (HTTP 200, server-rendered
// HTML, no login/CAPTCHA, robots honoured). Public browser access ALONE
// does not authorize automated collection — that is exactly what this
// registry records per channel.
//
// autoPromoteKeyPrefixes is the BOUNDED policy: only detected stableKeys
// with these prefixes are ingested without a human decision. Everything
// else lands in the review queue. Documents already in the corpus can
// never be re-ingested regardless of policy — the duplicate gates run
// before any promotion.
export const DISCOVERY_LISTINGS: Record<
  string,
  {
    url: string;
    publisher: string;
    accessBasis: string;
    autoPromoteKeyPrefixes: string[];
    maxLinksPerScan: number;
    maxValidatePerSweep: number;
  }
> = {
  "ncpcr-jj-listing": {
    url: "https://ncpcr.gov.in/public/juvenile-justice-act",
    publisher:
      "National Commission for Protection of Child Rights (NCPCR), Ministry of Women and Child Development, Government of India",
    // Verified 2026-10-08 (OFFICIAL_SOURCES.md §1.6): plain HTTP GET with
    // the connector's own default agent string returned HTTP 200 with
    // server-rendered HTML — the same response any browser sees. No
    // login, no CAPTCHA, no agent-specific gating observed on this page,
    // robots honoured. Automated scanning of the LISTING is therefore a
    // permitted-access channel, recorded here as evidence. If NCPCR
    // ever gates automated access, this entry must be removed and the
    // documents handled by the authorized manual-import path instead.
    accessBasis:
      "Public official listing page; plain HTTP GET with the connector's default agent string returned HTTP 200 with server-rendered HTML (verified 8 Oct 2026; evidence in OFFICIAL_SOURCES.md §1.6). No login, no CAPTCHA, robots honoured — the listing serves automated and browser access on the same terms.",
    // Bounded policy: JJ-family AMENDMENT instruments may auto-promote
    // (new publications in a deliberately narrow family). Model rules
    // and generic JJ rules queue for review; anything outside the JJ
    // family queues for review by construction (no matching prefix).
    // The base JJ Act 2015 is ALREADY in the corpus, so its stableKey
    // (in:statute:jj-2015) fails the duplicate gate — it can never be
    // re-ingested, only refreshed via its connector notice.
    autoPromoteKeyPrefixes: ["in:statute:jj-amendment-"],
    maxLinksPerScan: 12,
    maxValidatePerSweep: 8,
  },
};
