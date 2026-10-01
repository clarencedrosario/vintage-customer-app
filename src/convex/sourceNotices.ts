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
};
