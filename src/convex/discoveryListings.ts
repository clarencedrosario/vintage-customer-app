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
    /**
     * Turn 34 — listing MARKUP shape. "plain" (default) = anchor-href
     * PDF links (extractPdfLinks). "egazette-recent-uploads" = eGazette
     * rows keyed by UGID (extractGazetteRows): the row's metadata spans
     * plus the DERIVED static WriteReadData URL (plain GET, no session
     * needed — verified live 2026-10-09 against the turn-26 derivation).
     */
    listingShape?: "plain" | "egazette-recent-uploads";
    /** Listing page path relative to the session seed (eGazette shape). */
    listingPath?: string;
    /**
     * Pinned-PUBLIC-anchors retrieval (same flag semantics as
     * sourceNotices.ts): the LISTING host serves an incomplete TLS
     * chain; verification stays fully enabled.
     */
    tlsFix?: "lets-encrypt-aia";
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

  // Gazette of India / eGazette — recent uploads (Category=1, Bills &
  // Acts), FIRST national-scope listing (turn 34). Evidence:
  //   • Listing: the ASP.NET seed redirect (GET root → (S(session)) —
  //     the ordinary browser redirect chain; cookies from responses
  //     honoured) then a plain GET of the listing page with one Referer
  //     serves full server-rendered rows to our agent string (verified
  //     live 2026-10-09, HTTP 200, ~84 KB HTML, 100 rows) — the listing
  //     serves automated and browser access on the SAME terms.
  //   • Documents: each row's UGID (e.g. CG-DL-E-09102026-277020)
  //     maps to the PUBLISHED static file /WriteReadData/<year>/<num>.pdf,
  //     which the host serves by PLAIN GET with NO session/cookies
  //     (verified live 2026-10-09: HTTP 200, %PDF-1.6, 819,727 bytes,
  //     unauthenticated; turn-26 derivation re-verified against
  //     current rows 277020/276981). robots.txt is ABSENT on this host
  //     (HTTP 404 — no disallow exists). No login, no CAPTCHA, no
  //     postback replay: we take the direct published file, which is
  //     served to everyone — no access control involved.
  //   • BOUNDED AUTO-PROMOTE POLICY: deliberately EMPTY. Every eGazette
  //     candidate (acts, rules, notifications of any kind) passes
  //     through the OPERATOR review queue with a promotion note — the
  //     identity detector is JJ-family-only, so ANY other instrument
  //     yields null identity ⇒ review BY CONSTRUCTION, and even JJ-keyed
  //     identifications here need a human publication decision first.
  //     Nothing from this national listing without a human decision.
  "egazette-recent-uploads": {
    url: "https://egazette.gov.in",
    listingShape: "egazette-recent-uploads",
    listingPath: "RecentUploads.aspx?Category=1",
    tlsFix: "lets-encrypt-aia",
    publisher:
      "Gazette of India (eGazette), Directorate of Printing, Ministry of Housing and Urban Affairs, Government of India",
    accessBasis:
      "Public official listing + PUBLISHED static document files. Listing served to our agent string via the ordinary seed-redirect chain (verified 9 Oct 2026, HTTP 200 server-rendered rows). Row UGIDs map to the published /WriteReadData/<year>/<num>.pdf files, served by plain unauthenticated GET (verified 9/9 Oct 2026 live: HTTP 200 %PDF, no cookies; derivation two-for-two). robots.txt absent (404). No login, no CAPTCHA, no postback replay — direct published files only.",
    autoPromoteKeyPrefixes: [],
    maxLinksPerScan: 24,
    maxValidatePerSweep: 6,
  },
};
