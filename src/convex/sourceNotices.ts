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
};
