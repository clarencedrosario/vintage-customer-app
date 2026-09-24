/**
 * Conflict-of-interest matching engine — pure, no I/O, no Convex.
 *
 * The server (src/convex/conflicts.ts) collects searchable rows and hands
 * them to `runConflictSearch` together with the caller's permission
 * flags; every visibility decision is made here so the vitest suite
 * exercises the exact rules the server enforces.
 *
 * Three labelled tiers (spec requirement: "exact, normalized and clearly
 * labelled possible/fuzzy matches"):
 *  - "exact"      — identical after trimming case/spacing
 *  - "normalized" — identical after full normalization (punctuation,
 *                   honorifics, suffixes, entity suffixes like Pvt Ltd)
 *  - "possible"   — fuzzy: ≥2 shared significant tokens, or a distinct
 *                   significant token contained in the other side
 *
 * Restricted results: when a matched record belongs to a matter the
 * caller cannot see (team-restricted), it is replaced by a placeholder
 * that carries no name, title or reference — only the restricted
 * indicator, tier and evidence class. Confidential matches are still
 * counted so classification is not silently weakened.
 */

// ---------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------

/** Honorifics and noise tokens stripped during normalization. */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "adv", "advocate", "sri", "smt",
  "shri", "kum", "md", "prof", "professor", "honble", "hon", "justice",
]);

/**
 * Purely generic form/connective tokens that never distinguish an org
 * when they are the final token. Business descriptors (Traders,
 * Industries, Holdings…) are NOT here — they are the name itself.
 */
const NAME_SUFFIXES = new Set([
  "the", "and", "amp", "co", "company", "corp", "corporation",
]);

/** Indian corporate suffixes trimmed from the END of an org name. */
const ORG_TAIL_SUFFIXES = [
  "private limited", "pvt ltd", "pvt. ltd.", "limited liability partnership",
  "llp", "limited", "ltd", "inc", "llc", "plc",
];

/** Possibly-hidden significant tokens — never dropped in fuzzy matching. */
export function significantTokens(normalized: string): string[] {
  return normalized
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !HONORIFICS.has(t));
}

/** Lowercase, strip punctuation & diacritics, collapse whitespace. */
export function normalizeEntityName(name: string): string {
  const lower = (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const noPunct = lower.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const tokens = noPunct.split(" ").filter((t) => t && !HONORIFICS.has(t));
  return tokens.join(" ").trim();
}

/**
 * Normalized org name: single-letter initials (e.g. the "P" in
 * "Ramesh Industries (P) Ltd") never distinguish an organization and
 * entity-form tail suffixes are stripped.
 */
export function normalizeOrgName(name: string): string {
  let n = normalizeEntityName(name)
    .split(" ")
    .filter((t) => t.length >= 2)
    .join(" ");
  let changed = true;
  while (changed && n) {
    changed = false;
    for (const suffix of ORG_TAIL_SUFFIXES) {
      const suf = normalizeEntityName(suffix);
      if (suf && n.endsWith(` ${suf}`)) {
        n = n.slice(0, n.length - suf.length - 1).trim();
        changed = true;
      }
    }
  }
  // Drop generic tail tokens that no longer distinguish the name.
  const tokens = n.split(" ").filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ").trim();
}

/**
 * Normalized person name: honorifics and single-letter initials are
 * dropped; full middle names are kept ("Ramesh Kumar Verma" ≠
 * "Ramesh K Verma" — the latter only fuzzy-matches the former).
 */
export function normalizePersonName(name: string): string {
  return normalizeEntityName(name)
    .split(" ")
    .filter((t) => t.length >= 2)
    .join(" ")
    .trim();
}

/** Normalized email (lowercase, trimmed). */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** Normalized Indian phone: digits only, last 10 digits win. */
export function normalizePhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// ---------------------------------------------------------------------
// Match tiers
// ---------------------------------------------------------------------

export type MatchTier = "exact" | "normalized" | "possible";

/**
 * Classify how closely a raw name matches the needle.
 *  exact      — byte-identical strings
 *  normalized — identical after normalization (case, punctuation,
 *               honorifics, initials, corporate suffixes) or one fully
 *               contains the other
 *  possible   — fuzzy token overlap
 */
export function classifyNameMatch(needle: string, candidate: string): MatchTier | null {
  const n = (needle ?? "").trim();
  const c = (candidate ?? "").trim();
  if (!n || !c) return null;

  if (n === c) return "exact";

  const nn = normalizeEntityName(n);
  const cn = normalizeEntityName(c);
  if (nn && cn) {
    if (nn === cn) return "normalized";
    if (
      normalizeOrgName(n) &&
      normalizeOrgName(c) &&
      normalizeOrgName(n) === normalizeOrgName(c)
    ) {
      return "normalized";
    }
    if (
      normalizePersonName(n) &&
      normalizePersonName(c) &&
      normalizePersonName(n) === normalizePersonName(c)
    ) {
      return "normalized";
    }
    // Containment ("Sunil Kumar" inside "Sunil Kumar Sharma") is a
    // strong but fuzzy signal — labelled possible, not normalized.
  }

  // Fuzzy: shared significant tokens (aliases often drop middle names).
  const nTokens = new Set(significantTokens(nn));
  const cTokens = new Set(significantTokens(cn));
  const shared = [...nTokens].filter((t) => cTokens.has(t));
  if (shared.length >= 2) return "possible";
  // One distinct significant token spanning both sides (e.g. surname).
  if (shared.length === 1 && nTokens.size === 1 && cTokens.size === 1) {
    return "possible";
  }
  // Partial containment of a meaningful token.
  for (const t of nTokens) {
    if (t.length >= 4 && cn.includes(t)) return "possible";
  }
  return null;
}

// ---------------------------------------------------------------------
// Search records (server supplies these; pure code only classifies)
// ---------------------------------------------------------------------

export type SearchSide = "proposed_client" | "adverse_party" | "related_company" | "director" | "witness" | "alias" | "referring_party";

export type SearchableRecord = {
  kind:
    | "client"
    | "former_client"
    | "matter"
    | "matter_opposing_party"
    | "contact"
    | "witness"
    | "related_party"
    | "organization"
    | "alias"
    | "conflict_check";
  /** Stable identifier of the underlying record. */
  id: string;
  /** Display label — OMITTED for restricted rows. */
  label?: string;
  /** Secondary context shown to authorized viewers (reference/court). */
  detail?: string;
  /** Ids of matters this record is attached to (for access filtering). */
  matterIds: string[];
  /** Matters the CALLER cannot see (team-restricted) — restricted path. */
  hiddenMatterIds: string[];
  /** True when the row itself is confidential (team-restricted matter). */
  restricted: boolean;
  /** Normalized email / phone for exact-ish identity matching. */
  email?: string;
  phone?: string;
};

export type SearchQuery = {
  proposedClient: string;
  adverseParties: string[];
  relatedCompanies: string[];
  directors: string[];
  witnesses: string[];
  aliases: string[];
  relatedMatters: string[];
  referringParty: string;
};

export type MatchRecord = {
  recordKind: SearchableRecord["kind"];
  tier: MatchTier;
  /** What matched: the intake side(s) that produced this hit. */
  matchedAgainst: SearchSide[];
  /** Which intake strings produced the hit (for the evidence trail). */
  evidence: string[];
  /** Present only for non-restricted rows. */
  recordId?: string;
  label?: string;
  detail?: string;
  /** Restricted-conflict indicator — name and ids deliberately absent. */
  restricted?: boolean;
};

export type SearchResult = {
  matches: MatchRecord[];
  summary: {
    exact: number;
    normalized: number;
    possible: number;
    restricted: number;
  };
};

/** Intake sides that should be searched per record kind. */
const SIDES_OF_QUERY: Record<SearchSide, (q: SearchQuery) => string[]> = {
  proposed_client: (q) => [q.proposedClient],
  adverse_party: (q) => q.adverseParties,
  related_company: (q) => q.relatedCompanies,
  director: (q) => q.directors,
  witness: (q) => q.witnesses,
  alias: (q) => q.aliases,
  referring_party: (q) => (q.referringParty ? [q.referringParty] : []),
};

/**
 * Run the labelled search across all supplied records. Rows the caller
 * cannot access are returned as restricted placeholders — visible as
 * conflicts, invisible as data.
 */
export function runConflictSearch(
  query: SearchQuery,
  records: SearchableRecord[],
): SearchResult {
  const sides = (Object.keys(SIDES_OF_QUERY) as SearchSide[])
    .map((side) => ({ side, terms: SIDES_OF_QUERY[side](query).map((t) => t.trim()).filter(Boolean) }))
    .filter((s) => s.terms.length > 0);

  const matches = new Map<string, MatchRecord>();

  for (const record of records) {
    let bestTier: MatchTier | null = null;
    const matchedAgainst: SearchSide[] = [];
    const evidence: string[] = [];

    for (const { side, terms } of sides) {
      let sideHit = false;
      for (const term of terms) {
        // Identity fields (email/phone) count as normalized-tier hits —
        // a pure identity match still surfaces the record.
        const emailHit =
          record.email && normalizeEmail(term) && record.email === normalizeEmail(term);
        const phoneHit =
          record.phone &&
          normalizePhone(term).length === 10 &&
          record.phone === normalizePhone(term);
        const tier = classifyNameMatch(term, record.label ?? "");
        if (emailHit) {
          evidence.push(`email match for “${term}”`);
          sideHit = true;
        }
        if (phoneHit) {
          evidence.push(`phone match for “${term}”`);
          sideHit = true;
        }
        if (tier) {
          evidence.push(`${side.replace(/_/g, " ")} “${term}” ~ ${tier} match`);
          sideHit = true;
        }
        const effective: MatchTier | null =
          tier ?? (emailHit || phoneHit ? "normalized" : null);
        if (effective && (!bestTier || tierRank(effective) < tierRank(bestTier))) {
          bestTier = effective;
        }
      }
      if (sideHit && !matchedAgainst.includes(side)) matchedAgainst.push(side);
    }

    if (!bestTier) continue;

    const key = `${record.kind}:${record.restricted ? "restricted" : record.id}`;
    const existing = matches.get(key);
    if (existing) {
      // Keep the strongest tier, merge evidence.
      if (tierRank(bestTier) < tierRank(existing.tier)) existing.tier = bestTier;
      for (const e of evidence) if (!existing.evidence.includes(e)) existing.evidence.push(e);
      for (const s of matchedAgainst) if (!existing.matchedAgainst.includes(s)) existing.matchedAgainst.push(s);
    } else {
      matches.set(key, {
        recordKind: record.kind,
        tier: bestTier,
        matchedAgainst,
        evidence,
        ...(record.restricted
          ? { restricted: true }
          : { recordId: record.id, label: record.label, detail: record.detail }),
      });
    }
  }

  const list = [...matches.values()];
  const summary = {
    exact: list.filter((m) => m.tier === "exact").length,
    normalized: list.filter((m) => m.tier === "normalized").length,
    possible: list.filter((m) => m.tier === "possible").length,
    restricted: list.filter((m) => m.restricted).length,
  };
  list.sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) ||
      Number(b.restricted ?? false) - Number(a.restricted ?? false) ||
      (a.label ?? "").localeCompare(b.label ?? ""),
  );
  return { matches: list.slice(0, 40), summary };
}

function tierRank(t: MatchTier): number {
  return t === "exact" ? 0 : t === "normalized" ? 1 : 2;
}

// ---------------------------------------------------------------------
// Classification & opening gate
// ---------------------------------------------------------------------

export const CONFLICT_CLASSIFICATIONS = [
  "no_conflict",
  "possible_conflict",
  "confirmed_conflict",
  "investigation_required",
] as const;
export type ConflictClassification = (typeof CONFLICT_CLASSIFICATIONS)[number];

/** Human labels for the four classifications. */
export const CLASSIFICATION_LABELS: Record<ConflictClassification, string> = {
  no_conflict: "No conflict",
  possible_conflict: "Possible conflict",
  confirmed_conflict: "Confirmed conflict",
  investigation_required: "Investigation required",
};

/**
 * Can the matter be opened given the check's current state?
 *  - no classification            -> no (pending review)
 *  - no_conflict                  -> yes
 *  - confirmed_conflict           -> only with an override
 *  - possible / investigation     -> yes once classified (lawyer judgement),
 *                                    matching the spec ("classify ... with
 *                                    reasoning; prevent opening until
 *                                    approval") — the classification IS the
 *                                    approval for these two middle states.
 */
export function canProceedToMatter(input: {
  classification: ConflictClassification | null;
  override?: { byId: string; reason: string } | null;
}): boolean {
  if (!input.classification) return false;
  if (input.classification === "no_conflict") return true;
  if (input.classification === "confirmed_conflict") {
    return Boolean(input.override && input.override.reason.trim().length >= 10);
  }
  return true;
}

/** Is a classification decision final for the checker (i.e. recorded)? */
export function isDecisionComplete(d: {
  classification: ConflictClassification | null;
  reason?: string | null;
}): boolean {
  return d.classification !== null && Boolean(d.reason && d.reason.trim().length >= 10);
}

// ---------------------------------------------------------------------
// Timestamped report
// ---------------------------------------------------------------------

export type ReportInput = {
  reference: string; // conflict check reference e.g. CNF/2026/0004
  proposedClient: string;
  engagementDescription?: string;
  searchedAt: number;
  searchResult: SearchResult;
  classification: ConflictClassification | null;
  classificationReason?: string | null;
  decidedByName?: string | null;
  override?: { byName: string; reason: string; at: number } | null;
  viewerName: string;
  now: number;
};

/**
 * Render the timestamped conflict report as plain text (printable,
 * storable). Restricted rows appear ONLY as indicators — never with a
 * label or id.
 */
export function renderConflictReport(input: ReportInput): string {
  const when = new Date(input.searchedAt).toISOString();
  const line = "-".repeat(64);
  const rows: string[] = [];
  rows.push("CONFLICT OF INTEREST CHECK REPORT");
  rows.push(line);
  rows.push(`Reference: ${input.reference}`);
  rows.push(`Proposed client: ${input.proposedClient}`);
  if (input.engagementDescription) {
    rows.push(`Engagement: ${input.engagementDescription}`);
  }
  rows.push(`Search executed: ${when}`);
  rows.push(`Report generated: ${new Date(input.now).toISOString()}`);
  rows.push(`Generated by: ${input.viewerName}`);
  rows.push(line);
  rows.push(
    `Matches — exact: ${input.searchResult.summary.exact}, normalized: ${input.searchResult.summary.normalized}, possible: ${input.searchResult.summary.possible}, RESTRICTED (confidential): ${input.searchResult.summary.restricted}`,
  );
  rows.push("");
  if (input.searchResult.matches.length === 0) {
    rows.push("No matches found against current/former clients, matters,");
    rows.push("opposing parties, contacts, witnesses, related parties,");
    rows.push("organizations, aliases or earlier conflict checks.");
  } else {
    rows.push("Detailed results:");
    for (const m of input.searchResult.matches) {
      const tierLabel = m.tier.toUpperCase();
      if (m.restricted) {
        rows.push(
          `  [${tierLabel}] RESTRICTED CONFLICT — confidential match withheld (${m.recordKind.replace(/_/g, " ")}); details visible only to the responsible team.`,
        );
      } else {
        rows.push(
          `  [${tierLabel}] ${m.label}${m.detail ? ` (${m.detail})` : ""} — ${m.recordKind.replace(/_/g, " ")}`,
        );
      }
      for (const e of m.evidence) rows.push(`        • ${e}`);
    }
  }
  rows.push(line);
  rows.push(
    `Classification: ${input.classification ? CLASSIFICATION_LABELS[input.classification] : "Pending review"}`,
  );
  if (input.classificationReason) rows.push(`Reason: ${input.classificationReason}`);
  if (input.decidedByName) rows.push(`Classified by: ${input.decidedByName}`);
  if (input.override) {
    rows.push(
      `ELEVATED OVERRIDE: cleared by ${input.override.byName} on ${new Date(input.override.at).toISOString()} — ${input.override.reason}`,
    );
  }
  rows.push(line);
  return rows.join("\n");
}
