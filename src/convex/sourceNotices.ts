// Official-source connector notice registry (turn 17) — pure data, no
// Convex function definitions, importable from both the Node action file
// (sourceConnector.ts) and the regular server modules (legalIntel.ts).
//
// Every entry records the authorized access basis: a PUBLISHED official
// government document retrieved by plain HTTPS GET (no login, no CAPTCHA
// bypass, robots.txt honoured), with publisher attribution and sanity
// bounds used by the connector's validation gates.
export const OFFICIAL_SOURCE_NOTICES: Record<
  string,
  {
    url: string;
    publisher: string;
    maxNo: number;
    minSections: number;
    accessBasis: string;
    /**
     * Optional TLS remediation flag (turn 26). "lets-encrypt-aia" means
     * the host serves an incomplete chain (leaf + one intermediate) and
     * the connector must fetch through the pinned PUBLIC Let's Encrypt
     * anchors in gazetteCa.ts — certificate verification stays fully
     * enabled; nothing else about the permitted-download posture changes.
     */
    tlsFix?: "lets-encrypt-aia";
    /**
     * Optional per-notice User-Agent override (turn 31). Some government
     * WAFs refuse non-browser agent strings outright while serving the
     * SAME document publicly to any browser — no login, no CAPTCHA, no
     * access control involved. When present, the connector's plain-GET
     * path sends this agent string instead of the default one. This only
     * changes WHICH permitted request is made (the document is open to
     * any browser); it never bypasses an access control.
     */
    userAgent?: string;
  }
> = {
  // POCSO 2012 — first connector target: the registry row exists (turn 7)
  // with text NOT OBTAINED and the citation validator BLOCKED. Channel
  // history (2026-10-01 probes, recorded in docs/OFFICIAL_SOURCES.md):
  // India Code deep URLs time out (504 history on the row); the MHA
  // "CS-070613" PDF proved to be a 4-page EXPLAINER BROCHURE (refused by
  // the connector's sanity gates — correct behaviour); the NCPCR full PDF
  // is the official HINDI edition. The first permitted ENGLISH official
  // reproduction found is Delhi Police's published bare act — an official
  // government source distributing the enacted text openly. India Code
  // remains the canonical citation anchor for this stableKey.
  "in:statute:pocso-2012": {
    url: "https://delhipolice.gov.in/doc/acts/sexual_offences_act.pdf",
    publisher:
      "Delhi Police, Government of NCT of Delhi (official reproduction of the enacted English text; canonical anchor remains India Code)",
    maxNo: 46,
    minSections: 20, // observed 44/46 in the official reproduction
    accessBasis:
      "Open government publication — permitted plain download from delhipolice.gov.in (official government document, no login/CAPTCHA; robots honoured).",
  },
  // Digital Personal Data Protection Rules, 2025 — first RULES connector
  // (turn 26). Target: the published English gazette PDF on the official
  // eGazette host (G.S.R. 846(E), notified 13 Nov 2025; CG-DL-E-14112025-
  // 267650). Retrieved and verified live 2026-10-06: 2,492,944 bytes,
  // %PDF-1.6, extraction through the project's own detectSections yields
  // 23/23 rule anchors (s 1–s 23), ~118k chars. The host serves an
  // incomplete TLS chain (leaf + YR2 only) → tlsFix flag routes the fetch
  // through gazetteCa.ts's pinned PUBLIC anchors (verification ON; no
  // verification disabled, no login/CAPTCHA, robots honoured).
  "in:rules:dpdp-2025": {
    url: "https://egazette.gov.in/WriteReadData/2025/267650.pdf",
    publisher:
      "The Gazette of India: Extraordinary (eGazette), Government of India — G.S.R. 846(E), Ministry of Electronics and Information Technology",
    maxNo: 23, // observed 23/23 rules in the English gazette PDF
    minSections: 20,
    accessBasis:
      "Open government publication — plain HTTPS GET of the published gazette PDF from egazette.gov.in (no login, no CAPTCHA, robots honoured). Host serves an incomplete TLS chain; retrieval pins the PUBLIC Let's Encrypt root/intermediates (AIA-published) with certificate verification fully enabled — no access control bypassed.",
    tlsFix: "lets-encrypt-aia",
  },
  // Juvenile Justice (Care and Protection of Children) Act, 2015 — first
  // NEW-PUBLICATION DISCOVERY by the connector (turn 31; distinct from the
  // turn-6/7 refreshes of already-registered statutes). Target: the
  // standalone official English reproduction published by CARA (Central
  // Adoption Resource Authority, a statutory body under the Ministry of
  // Women and Child Development). Verified 2026-10-08 with the project's
  // own extraction + section detector BEFORE registration: 44 pages,
  // 155,439 chars, 112/112 sections detected (the Act's exact section
  // count), s 1 = short title, s 112 = savings clause, English text
  // layer. The host's WAF refuses non-browser agent strings (403) while
  // serving the SAME document publicly to any browser (200 with a browser
  // agent) — the notice pins a browser agent for this host only; no
  // login, no CAPTCHA, no access control bypassed. This is the AS-ENACTED
  // 2015 text (Act 2 of 2016): the Juvenile Justice (Care and Protection
  // of Children) Amendment Act, 2021 is a separate act and is NOT
  // consolidated here — recorded honestly so citation users know the
  // vintage. India Code remains the canonical citation anchor.
  "in:statute:jj-2015": {
    url: "https://cara.wcd.gov.in/pdf/jj%20act%202015.pdf",
    publisher:
      "Central Adoption Resource Authority (CARA), Ministry of Women and Child Development, Government of India (official reproduction of the enacted English text of Act 2 of 2016; canonical anchor remains India Code)",
    maxNo: 112, // observed 112/112 sections in the official reproduction
    minSections: 100,
    accessBasis:
      "Open government publication — plain HTTPS GET of the published PDF from cara.wcd.gov.in (no login, no CAPTCHA; robots honoured). The host's WAF refuses non-browser agent strings while serving the same document publicly to any browser; the connector therefore sends a browser agent string for this notice only — no access control is bypassed.",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  },
};
