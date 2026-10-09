// Pure discovery helpers — unit tests (no network, no Convex runtime).
import { describe, expect, it } from "vitest";
import {
  extractPdfLinks,
  detectDocumentIdentity,
  deriveStableKey,
  languageMix,
  identityClass,
  expectedInstrumentClass,
} from "./legalDiscovery";

const LISTING = "https://ncpcr.gov.in/public/juvenile-justice-act";

describe("extractPdfLinks", () => {
  it("extracts same-host absolute PDF links with anchor titles, deduped", () => {
    const html = `
      <a href="/public/uploads/165648720662bbfd264b93a_the-juvenile-justice-care-and-protection-of-children-act-2015.pdf">Juvenile Justice (Care And Protection Of Children) ACT, 2015</a>
      <a href="uploads/165648725462bbfd563fdbb_the-juvenile-justice-care-and-protection-of-children-act-2015rules-2016-hindi-english.pdf">JJ Act 2015, Rules, 2016</a>
      <a href="/page">not a pdf</a>
      <a href="/x.pdf">dup</a>
      <a href="/x.pdf">dup again</a>
      <a href="https://other.gov.in/y.pdf">off-host</a>
      <a href="https://ncpcr.gov.in/public/uploads/act.pdf">gov copy</a>`;
    const links = extractPdfLinks(html, LISTING);
    const urls = links.map((l) => l.url);
    expect(urls).toHaveLength(4);
    expect(urls.every((u) => new URL(u).host === "ncpcr.gov.in")).toBe(true);
    // Relative hrefs resolve against the listing URL.
    expect(urls[0]).toBe("https://ncpcr.gov.in/public/uploads/165648720662bbfd264b93a_the-juvenile-justice-care-and-protection-of-children-act-2015.pdf");
    // Anchor text becomes the title; first occurrence wins (dedupe).
    expect(links[0].title).toContain("ACT, 2015");
    expect(urls.filter((u) => u.endsWith("/x.pdf"))).toHaveLength(1);
    // Duplicates by resolved href: the trailing "/public/uploads/act.pdf"
    // row is distinct from "/x.pdf", so 4 unique URLs total.
  });

  it("never throws on malformed hrefs", () => {
    const links = extractPdfLinks('<a href="ht!tp://bad url.pdf">x</a><a href="%zz.pdf">y</a>', LISTING);
    expect(Array.isArray(links)).toBe(true);
  });

  it("canonicalizes NCPCR viewPdf viewer URLs to the direct uploads URL and dedupes the pair", () => {
    // Real markup shape observed 2026-10-08: every document renders twice
    // (direct /public/uploads/… + inline /public/viewPdf/…). One document
    // must yield ONE candidate, keyed on the direct URL.
    const html = `
      <a href="viewPdf/165648704562bbfc85b1b06_juvenile-justice-care-and-protection-of-children-act-2000.pdf">JJ Act 2000 (viewer)</a>
      <a href="https://ncpcr.gov.in/public/uploads/165648704562bbfc85b1b06_juvenile-justice-care-and-protection-of-children-act-2000.pdf">JJ Act 2000 (direct)</a>
      <a href="viewPdf/165648684162bbfbb933ddc_juvenile-justice-care-and-protection-of-children-amendment-act-2011.pdf">JJ Amendment 2011 (viewer only)</a>`;
    const links = extractPdfLinks(html, LISTING);
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe(
      "https://ncpcr.gov.in/public/uploads/165648704562bbfc85b1b06_juvenile-justice-care-and-protection-of-children-act-2000.pdf",
    );
    expect(links[1].url).toBe(
      "https://ncpcr.gov.in/public/uploads/165648684162bbfbb933ddc_juvenile-justice-care-and-protection-of-children-amendment-act-2011.pdf",
    );
  });

  it("dedupes by filename even when directory paths differ (uploads vs uploads/admin)", () => {
    const html = `
      <a href="https://ncpcr.gov.in/public/uploads/abc_report.pdf">R (uploads)</a>
      <a href="https://ncpcr.gov.in/public/uploads/admin/abc_report.pdf">R (admin copy)</a>`;
    expect(extractPdfLinks(html, LISTING)).toHaveLength(1);
  });
});

describe("detectDocumentIdentity", () => {
  it("recognises JJ-family instruments in gazette-style headers", () => {
    const rulesHeader =
      "MINISTRY OF WOMEN AND CHILD DEVELOPMENT ... Juvenile Justice (Care and Protection of Children) Model Amendment Rules, 2022 — published in the Gazette of India";
    expect(detectDocumentIdentity(rulesHeader)).toBe(
      "Juvenile Justice (Care and Protection of Children) Model Amendment Rules, 2022",
    );
    const amendmentHeader =
      "THE JUVENILE JUSTICE (CARE AND PROTECTION OF CHILDREN) AMENDMENT ACT, 2021 NO. 30 OF 2021";
    expect(detectDocumentIdentity(amendmentHeader)).toBe(
      "Juvenile Justice (Care and Protection of Children) Amendment Act, 2021",
    );
  });

  it("returns null for unrecognisable headers (uncertainty, never guessing)", () => {
    expect(detectDocumentIdentity("Completely unrelated brochure about adoption")).toBeNull();
    expect(detectDocumentIdentity("")).toBeNull();
  });

  it("does NOT mistake a rules notification for the amendment act it cites (live-observed misfire)", () => {
    // Verbatim-shaped header of the JJ Rules 2007 gazette notification
    // (NCPCR) — its recital cites the Amendment Act 33 of 2006. Detected
    // as "Amendment Act, 2006" by the first live run (2026-10-08), which
    // promoted the WRONG body. The guard must route this to the rules'
    // own call — or null (review), never the recital citation.
    const notification =
      "MINISTRY OF WOMEN AND CHILD DEVELOPMENT NOTIFICATION New Delhi, the 26 day of October, 2007 " +
      "Rules under the Juvenile Justice (Care and Protection of Children) Act 2000 (56 of 2000) (as " +
      "amended by the Amendment Act 33 of 2006) to be administered by the States G.S.R. 679(E) - " +
      "WHEREAS the Constitution has, in several provisions, including clause (3) of article 15...";
    const id = detectDocumentIdentity(notification);
    // Either the rules' own call is found deeper, or null — but NEVER
    // the amendment-act identity from the recital.
    if (id !== null) {
      expect(id).not.toContain("Amendment Act");
      expect(identityClass(id)).toBe("rules");
    }
  });

  it("strips citation parentheticals before matching (Amendment Act 33 of 2006 recital)", () => {
    // With the recital stripped, a bare amendment-act header still matches.
    const header =
      "THE JUVENILE JUSTICE (CARE AND PROTECTION OF CHILDREN) AMENDMENT ACT, 2006 (33 OF 2006) AS PASSED BY BOTH HOUSES";
    expect(detectDocumentIdentity(header)).toBe(
      "Juvenile Justice (Care and Protection of Children) Amendment Act, 2006",
    );
  });
});

describe("identityClass / expectedInstrumentClass cross-check", () => {
  it("classifies detected identities", () => {
    expect(identityClass("Juvenile Justice (Care and Protection of Children) Rules, 2007")).toBe("rules");
    expect(identityClass("Juvenile Justice (Care and Protection of Children) Amendment Act, 2006")).toBe("amendment_act");
    expect(identityClass("Juvenile Justice (Care and Protection of Children) Act, 2015")).toBe("act");
    expect(identityClass(null)).toBeNull();
  });

  it("signals expected class from publisher naming (REVERSE direction: rules body named as amendment act is also uncertainty)", () => {
    // Reverse misfire class: a gazette notification whose OWN header rules
    // out the recital citation (detectDocumentIdentity ⇒ rules) but whose
    // FILENAME says "amendment-act" — a publisher-naming error or a
    // mis-captioned file. Classes contradict ⇒ uncertain ⇒ review, and
    // filename agreement alone NEVER established identity in either
    // direction (see decision test below).
    const detected = "Juvenile Justice (Care and Protection of Children) Rules, 2007";
    const expected = expectedInstrumentClass(
      ".../juvenule-justice-care-and-protection-of-children-amendment-act-2006.pdf",
    );
    expect(expected).not.toBe(identityClass(detected));
    // Symmetry: filename matching a DETECTED identity is 1-way evidence —
    // a rules-detected body under an act-shaped name stays uncertain.
    expect(identityClass(detected)).toBe("rules");
    expect(expected).toBe("amendment_act");
  });

  it("decides promotion only on consistent identity — filename agreement ALONE never promotes", () => {
    // Decision table mirroring the validator (legalDiscovery.ts ~line 322):
    // identity = null ⇒ identityOk false ⇒ review (regardless of filename).
    // identity detected + class contradiction ⇒ identity reset to null ⇒
    // review. Auto-promote requires: identity non-null AND class match
    // (or no filename signal) AND duplicate-free AND policy prefix match.
    const decide = (identity: string | null, expected: string | null) => {
      let eff: string | null = identity;
      const detected = identityClass(identity);
      if (eff && (detected === null || (expected !== null && expected !== detected))) {
        eff = null;
      }
      return eff !== null; // identityOk
    };
    // Consistent: the correct cycle-3 outcome (rules-2007 URL + rules body).
    expect(
      decide("JJ Rules 2007", expectedInstrumentClass(".../chidlren-rules-2007.pdf")),
    ).toBe(true);
    // The LIVE misfire: amendment-act detection + rules URL ⇒ refuted.
    expect(
      decide("JJ Amendment Act, 2006", expectedInstrumentClass(".../chidlren-rules-2007.pdf")),
    ).toBe(false);
    // Contradiction the OTHER way (test above) also refuted.
    expect(
      decide("JJ Rules, 2007", expectedInstrumentClass(".../amendment-act-2006.pdf")),
    ).toBe(false);
    // No filename signal AND null identity ⇒ review, never promote.
    expect(decide(null, null)).toBe(false);
    // No filename signal but consistent detection ⇒ promote-eligible
    // (subject to duplicate + policy gates).
    expect(decide("JJ Amendment Act, 2006", null)).toBe(true);
  });

  it("signals expected class from publisher naming and exposes the live misfire", () => {
    expect(expectedInstrumentClass(".../juvenile-justice-care-and-protection-of-chidlren-rules-2007.pdf")).toBe("rules");
    expect(expectedInstrumentClass(".../juvenule-justice-care-and-protection-of-children-amendment-act-2006.pdf")).toBe("amendment_act");
    expect(expectedInstrumentClass(".../juvenile-justice-care-and-protection-of-children-act-2015.pdf")).toBe("act");
    expect(expectedInstrumentClass("https://example.org/doc123.pdf")).toBeNull();
    // THE live misfire: rules URL + amendment-act detection ⇒ classes
    // differ, so the validator must treat the identity as uncertain.
    const detected = "Juvenile Justice (Care and Protection of Children) Amendment Act, 2006";
    const expected = expectedInstrumentClass(
      ".../juvenile-justice-care-and-protection-of-chidlren-rules-2007.pdf",
    );
    expect(expected).not.toBe(identityClass(detected));
  });
});

describe("deriveStableKey", () => {
  it("maps recognised identities to namespace-valid stable keys", () => {
    expect(deriveStableKey("Juvenile Justice (Care and Protection of Children) Model Amendment Rules, 2022")).toBe("in:guidance:jj-model-rules-2022");
    expect(deriveStableKey("Juvenile Justice (Care and Protection of Children) Amendment Act, 2021")).toBe("in:statute:jj-amendment-2021");
    expect(deriveStableKey("Juvenile Justice (Care and Protection of Children) Rules, 2016")).toBe("in:rules:jj-2016");
    expect(deriveStableKey("Juvenile Justice (Care and Protection of Children) Act, 2015")).toBe("in:statute:jj-2015");
  });

  it("refuses to key unrecognised identities", () => {
    expect(deriveStableKey(null)).toBeNull();
    expect(deriveStableKey("Something else entirely")).toBeNull();
  });
});

describe("languageMix", () => {
  it("passes a plain English body and fails a Hindi-dominant body", () => {
    const english = "This Act may be called the Juvenile Justice Act, 2015. ".repeat(40);
    expect(languageMix(english)).toMatchObject({ englishOk: true });
    const hindi = "बाल एवं किशोर न्याय अधिनियम ".repeat(60);
    const mix = languageMix(hindi);
    expect(mix.englishOk).toBe(false);
    expect(mix.hindiRatio).toBeGreaterThan(0.2);
  });

  it("flags bilingual gazette headers as still-English when the body is English", () => {
    const body =
      "वल्काश laö Mhö ,yö&33004 REGD. NO. D. L.-33004/99 vlk/kj.k EXTRAORDINARY " +
      "This Act may be called the Juvenile Justice (Care and Protection of Children) Act, 2015. ".repeat(30);
    expect(languageMix(body).englishOk).toBe(true);
  });
});
