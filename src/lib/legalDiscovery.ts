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
 * Absolute-resolves against the listing URL, dedupes by URL, and drops
 * non-document links. Bounded: only same-host links are kept — the scan
 * never follows off-host links from a listing.
 */
export function extractPdfLinks(html: string, listingUrl: string): ListingLink[] {
  const base = new URL(listingUrl);
  const out = new Map<string, string>();
  const re = /<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], base);
      if (abs.host !== base.host) continue;
      const title = m[2]
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!abs.pathname.toLowerCase().endsWith(".pdf")) continue;
      if (!out.has(abs.href)) out.set(abs.href, title);
    } catch {
      // Malformed href — skip, never throw on publisher markup.
    }
  }
  return [...out.entries()].map(([url, title]) => ({ url, title }));
}

/**
 * Detect the document identity of a JJ-family instrument from the
 * extracted text (gazette headers repeat the instrument title). Returns
 * a canonical identity string, or null when the header does not name a
 * recognisable instrument — callers must treat null as UNCERTAIN and
 * queue for review, never guess.
 */
export function detectDocumentIdentity(text: string): string | null {
  const head = text.slice(0, 4000).replace(/\s+/g, " ");
  const patterns: [RegExp, string][] = [
    [/juvenile justice[\s\S]{0,220}?model\s+amendment\s+rules,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Model Amendment Rules, $1"],
    [/juvenile justice[\s\S]{0,220}?amendment\s+act,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Amendment Act, $1"],
    [/juvenile justice[\s\S]{0,220}?rules,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Rules, $1"],
    [/juvenile justice[\s\S]{0,220}?act,\s*(\d{4})/i, "Juvenile Justice (Care and Protection of Children) Act, $1"],
  ];
  for (const [re, fmt] of patterns) {
    const m = re.exec(head);
    if (m) return fmt.replace("$1", m[1]);
  }
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
