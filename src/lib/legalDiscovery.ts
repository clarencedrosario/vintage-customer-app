// =====================================================================
// Automated legal-discovery helpers — PURE functions, no network, no
// Convex. The Convex pipeline (src/convex/legalDiscovery.ts) fetches an
// authorized official LISTING page on a schedule, extracts document
// links, detects document identity, and classifies extraction quality.
// Nothing here decides access rights: the caller supplies only listings
// registered with a permitted automated access method.
// =====================================================================

/** One document link extracted from a listing page. */
export type ListingLink = { url: string; title: string };

/**
 * Extract PDF links (with anchor text as title) from listing HTML.
 * Absolute-resolves against the listing URL, dedupes, and drops
 * non-document links. Bounded: only same-host links are kept — the scan
 * never follows off-host links from a listing.
 *
 * NCPCR (like many government CMSs) renders each document TWICE: a
 * direct /public/uploads/… URL and an inline /public/viewPdf/… viewer
 * URL for the same file. Canonical form: anything under /viewPdf/ is
 * mapped to its /public/uploads/ counterpart; dedupe is then by full
 * canonical URL AND by filename, so one document ⇒ one candidate.
 */
export function extractPdfLinks(html: string, listingUrl: string): ListingLink[] {
  const base = new URL(listingUrl);
  const out = new Map<string, string>();
  const seenNames = new Set<string>();
  const re = /<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      let abs = new URL(m[1], base);
      if (abs.host !== base.host) continue;
      if (!abs.pathname.toLowerCase().endsWith(".pdf")) continue;
      // Canonicalize viewer URLs to the direct file URL
      // (/public/viewPdf/NAME.pdf → /public/uploads/NAME.pdf).
      if (abs.pathname.includes("/viewPdf/")) {
        abs = new URL(abs.pathname.replace("/viewPdf/", "/uploads/"), base);
      }
      const title = m[2]
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const fileName = abs.pathname.split("/").pop() ?? abs.pathname;
      if (out.has(abs.href) || seenNames.has(fileName)) {
        // Same document via a second link — keep the first occurrence.
        continue;
      }
      seenNames.add(fileName);
      out.set(abs.href, title);
    } catch {
      // Malformed href — skip, never throw on publisher markup.
    }
  }
  return [...out.entries()].map(([url, title]) => ({ url, title }));
}

/**
 * Extract eGazette "recent uploads" ROWS (turn 34): the listing renders
 * one <tr> per gazette with the UGID in a span
 * (`gvGazetteList_lbl_UGID_N`) and metadata (ministry/department/
 * subject/dates) in sibling labelled spans. Returns one row per gazette
 * ID with the composed DIRECT document URL — the static WriteReadData
 * path (year + numeric tail from the UGID), which serves the PDF by
 * plain GET with NO session/cookies (verified live 2026-10-09: HTTP 200,
 * %PDF-1.6, from an unauthenticated request — turn-26 derivation,
 * re-verified against current rows). The rows' own download control is
 * a postback; we take the DIRECT published file instead, which the
 * host serves to everyone without any access control — no handshake
 * replay, no bypass.
 */
export function extractGazetteRows(
  html: string,
  listingUrl: string,
): ListingLink[] {
  const base = new URL(listingUrl);
  const out = new Map<string, string>();
  const re = /CG-[A-Z0-9]{2,6}-[A-Z]-\d{8}-(\d{6})/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const ugid = m[0];
    if (seen.has(ugid)) continue;
    seen.add(ugid);
    const num = m[1]!; // numeric tail of the UGID = static file id
    // Publication date sits in the same row's UGID itself (ddmmyyyy
    // inside the id); the year is unambiguous there.
    const ddmmyyyy = /\d{8}/.exec(ugid) ![0];
    const year = ddmmyyyy.slice(4); // "09102026" → "2026"
    const url = new URL(`/WriteReadData/${year}/${num}.pdf`, base);
    if (url.host !== base.host) continue; // never off-host
    out.set(ugid, url.href);
  }
  return [...out.entries()].map(([title, url]) => ({ url, title }));
}

/**
 * Detect the document identity of a JJ-family instrument from the
 * extracted text (gazette headers repeat the instrument title). Returns
 * a canonical identity string, or null when the header does not name a
 * recognisable instrument — callers must treat null as UNCERTAIN and
 * queue for review, never guess.
 *
 * Guard rails added after the 2026-10-08 live run: a gazette NOTIFICATION
 * of RULES cites the amending act in its recitals ("Rules under the JJ Act
 * 2000 (as amended by the Amendment Act 33 of 2006)", recitals naming
 * "…Amendment Act, 2006"), which a naive head-window match mistakes for
 * the document's own identity. Counter-measures: (1) citation
 * parentheticals "(33 of 2006)" are stripped; (2) a "Rules under the …"
 * header marks the document as RULES — the amendment-act pattern is then
 * not applied to the recitals; the rules' own call ("…may be called the
 * …Rules, YYYY") is searched deeper instead; null if not found.
 */
export function detectDocumentIdentity(text: string): string | null {
  // Strip citation parentheticals like "(33 of 2006)" / "(56 of 2000)".
  const cleaned = text.replace(/\((\d{1,3})\s+of\s+(\d{4})\)/g, "");
  const head = cleaned.slice(0, 4000).replace(/\s+/g, " ");
  const deep = cleaned.slice(0, 12000).replace(/\s+/g, " ");
  const patterns: [RegExp, string][] = [
    [/juvenile justice[\s\S]{0,220}?model\s+amendment\s+rules,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Model Amendment Rules, $1"],
    [/juvenile justice[\s\S]{0,220}?amendment\s+act,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Amendment Act, $1"],
    [/juvenile justice[\s\S]{0,220}?rules,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Rules, $1"],
    [/juvenile justice[\s\S]{0,220}?act,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Act, $1"],
  ];
  // A "Rules under the … Act" header ⇒ this is a rules notification, not
  // the cited amendment act: identity must come from the rules' own call.
  if (/rules\s+under\s+the\s+juvenile\s+justice[\s\S]{0,200}?act/i.test(head)) {
    const m = /(?:may\s+be\s+called\s+the|called\s+the)\s+juvenile\s+justice[\s\S]{0,220}?rules,\s*(\d{4})/i.exec(
      deep,
    );
    if (m) {
      return "Juvenile Justice (Care and Protection of Children) Rules, $1".replace(
        "$1",
        m[1]!,
      );
    }
    return null; // uncertain — review, never the recital citation
  }
  for (const [re, fmt] of patterns) {
    const m = re.exec(head);
    if (m) return fmt.replace("$1", m[1]!);
  }
  return null;
}

/**
 * Instrument CLASS of a detected identity (rules / amendment_act / act),
 * used to cross-check the detected identity against the publisher's own
 * filename/anchor title. A contradiction is uncertainty: the caller must
 * review, not promote.
 */
export function identityClass(
  identity: string | null,
): "rules" | "amendment_act" | "act" | null {
  if (!identity) return null;
  const s = identity.toLowerCase();
  if (s.includes("rules")) return "rules";
  if (s.includes("amendment")) return "amendment_act";
  if (s.includes("act")) return "act";
  return null;
}

/**
 * Instrument CLASS expected from a document URL/filename/anchor title
 * (the publisher's own naming): "…rules-2007.pdf" ⇒ rules,
 * "…amendment-act-2006.pdf" ⇒ amendment_act, "…act-2015.pdf" ⇒ act.
 * null when the name carries no signal.
 */
export function expectedInstrumentClass(
  urlOrTitle: string,
): "rules" | "amendment_act" | "act" | null {
  const s = urlOrTitle.toLowerCase();
  if (/rules/.test(s)) return "rules";
  if (/amendment/.test(s) && /act/.test(s)) return "amendment_act";
  if (/act/.test(s)) return "act";
  return null;
}

/**
 * Map a canonical identity to a corpus stableKey (citation anchor).
 * Returns null for identities that must not be auto-keyed — the caller
 * queues those for review instead of inventing an anchor.
 */
export function deriveStableKey(identity: string | null): string | null {
  if (!identity) return null;
  const s = identity.toLowerCase();
  let m = /model amendment rules,\s*(\d{4})/.exec(s);
  if (m) return `in:guidance:jj-model-rules-${m[1]}`;
  m = /amendment act,\s*(\d{4})/.exec(s);
  if (m) return `in:statute:jj-amendment-${m[1]}`;
  m = /children\) rules,\s*(\d{4})/.exec(s);
  if (m) return `in:rules:jj-${m[1]}`;
  m = /children\) act,\s*(\d{4})/.exec(s);
  if (m) return `in:statute:jj-${m[1]}`;
  return null;
}

/**
 * Language-mix classification of extracted body text. Returns the share
 * of Devanagari characters and whether an English text layer is present.
 * A bilingual gazette header (a few dozen Hindi chars) is normal; a
 * Hindi-dominant body means the English corpus need is NOT met.
 */
export function languageMix(body: string): {
  hindiRatio: number;
  englishOk: boolean;
} {
  if (!body) return { hindiRatio: 0, englishOk: false };
  const hindi = (body.match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (body.match(/[A-Za-z]/g) ?? []).length;
  return {
    hindiRatio: hindi / body.length,
    englishOk: latin / body.length > 0.4 && /[A-Za-z]{4,}/.test(body),
  };
}
