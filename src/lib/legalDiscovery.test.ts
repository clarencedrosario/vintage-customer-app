// Pure discovery helpers — unit tests (no network, no Convex runtime).
import { describe, expect, it } from "vitest";
import {
  extractPdfLinks,
  detectDocumentIdentity,
  deriveStableKey,
  languageMix,
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
