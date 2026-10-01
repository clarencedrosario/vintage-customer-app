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
  // with text NOT OBTAINED and the citation validator BLOCKED; this
  // channel is the same MHA/Gazette one already used for the six ingested
  // core sources.
  "in:statute:pocso-2012": {
    url: "https://www.mha.gov.in/sites/default/files/2023-03/CS-070613_0%5B1%5D_0%5B1%5D.pdf",
    publisher: "Ministry of Home Affairs, Government of India (official reprint)",
    maxNo: 46, // POCSO has 46 sections + schedule
    minSections: 10,
    accessBasis: "Open government publication — permitted plain download from mha.gov.in (official MHA document repository).",
  },
};
