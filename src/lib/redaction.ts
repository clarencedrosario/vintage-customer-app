// =====================================================================
// VERIFIED REDACTION — pure helpers (§32 Phase 6).
//
// Honest capability model for this module:
//   - The ONLY formats where this module can produce a derivative whose
//     redaction can be MECHANICALLY VERIFIED are UTF-8 text-family
//     files. There the derivative's actual bytes are produced by
//     removing the recorded terms, and verification re-scans those
//     bytes with the same matcher: "verified" means the terms are
//     provably absent from the derivative.
//   - Everything else (PDF, images, office containers, scans) is
//     REFUSED. Drawing boxes over a PDF or an image would leave the
//     underlying text/pixels intact — the classic redaction failure —
//     and this module cannot verify their removal, so it never labels
//     such a derivative "verified". Refusals are recorded, not silent.
//   - Verification is a MECHANICAL absence check, not a human review
//     and not a guarantee that the source contained nothing else
//     sensitive (see REDACTION_COVERAGE_NOTE).
// =====================================================================

export type RedactionEntry = { term: string; label: string; reason: string };

/** Text-family formats this module can verifiably redact. */
export const REDACTABLE_TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
] as const;

/** Hard caps — keep jobs deterministic and rows small. */
export const MAX_REDACTION_ENTRIES = 100;
export const MIN_TERM_LENGTH = 2;
export const MAX_TERM_LENGTH = 200;
export const MAX_SOURCE_BYTES = 1_000_000;

/** Why a redaction job was refused. Refused ≠ verified — ever. */
export const REDACTION_REFUSAL_REASONS = [
  "unsupported_format", // real format known, but not verifiably redactable here
  "unknown_format", // no recognisable extension
  "binary_content", // binary signature inside a nominally text file
  "not_utf8", // bytes are not valid UTF-8 text
  "no_file", // document row has no stored object
  "source_integrity_mismatch", // stored bytes differ from the recorded hash
  "invalid_entries", // terms/labels/reasons failed validation
  "too_large", // source exceeds MAX_SOURCE_BYTES
  "storage_read_failed", // storage read threw
] as const;

export type RedactionRefusalReason = (typeof REDACTION_REFUSAL_REASONS)[number];

/**
 * The disclosure carried on every redaction job and derivative. The
 * marker proves the recorded terms were removed from THIS derivative —
 * nothing more.
 */
export const REDACTION_COVERAGE_NOTE =
  "Verified = mechanical absence check only: the produced derivative bytes were re-scanned with the same case-insensitive, whitespace-tolerant matcher used to remove each recorded term. It proves those terms are absent from THIS derivative; it does NOT prove the source contained nothing else sensitive, nor that rephrased, partial, encoded or image-based copies are absent. A human must review the derivative before any external use.";

// ---------------------------------------------------------------------
// Format support (decided from the document NAME; content guards follow)
// ---------------------------------------------------------------------

export type FormatSupport =
  | { supported: true; kind: "utf8_text"; extension: string }
  | { supported: false; reason: "unsupported_format" | "unknown_format"; detail: string };

export function formatSupport(name: string): FormatSupport {
  const lower = name.trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0 || dot === lower.length - 1) {
    return {
      supported: false,
      reason: "unknown_format",
      detail: "No recognisable file extension — format cannot be determined, so redaction cannot be verified.",
    };
  }
  const ext = lower.slice(dot);
  if ((REDACTABLE_TEXT_EXTENSIONS as readonly string[]).includes(ext)) {
    return { supported: true, kind: "utf8_text", extension: ext };
  }
  return {
    supported: false,
    reason: "unsupported_format",
    detail: `This module can only produce VERIFIABLY redacted derivatives for UTF-8 text files (${REDACTABLE_TEXT_EXTENSIONS.join(", ")}). ${ext} containers cannot be verified here, so no "verified" label is possible.`,
  };
}

// ---------------------------------------------------------------------
// Content guards (catch mislabelled files BEFORE any redaction)
// ---------------------------------------------------------------------

/** Returns a human label when the bytes look binary, else null. */
export function detectBinarySignature(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, 8192);
  const ascii = (s: string, offset = 0) =>
    s
      .split("")
      .every((c, i) => head[offset + i] === c.charCodeAt(0));
  if (ascii("%PDF-")) return "PDF";
  if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5) && (head[3] === 4 || head[3] === 6))
    return "ZIP container (e.g. docx/xlsx/odt)";
  if (head[0] === 0x89 && ascii("PNG", 1)) return "PNG image";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "JPEG image";
  if (ascii("GIF8")) return "GIF image";
  if (ascii("%!PS")) return "PostScript";
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return "binary content (NUL byte)";
  }
  return null;
}

/** Strict UTF-8 decode — null when the bytes are not valid UTF-8 text. */
export function decodeTextStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------

export type EntryValidation =
  | { ok: true; entries: RedactionEntry[] }
  | {
      ok: false;
      reason:
        | "no_entries"
        | "too_many_entries"
        | "invalid_term"
        | "duplicate_term";
    };

/**
 * Validate + normalize redaction entries. Every entry needs a term
 * (2–200 chars) and a mandatory human reason (why this is sensitive) —
 * a redaction without a stated reason is refused, mirroring the
 * mandatory-reason discipline used across the product.
 */
export function validateEntries(raw: RedactionEntry[]): EntryValidation {
  if (!Array.isArray(raw) || raw.length === 0)
    return { ok: false, reason: "no_entries" };
  if (raw.length > MAX_REDACTION_ENTRIES)
    return { ok: false, reason: "too_many_entries" };
  const seen = new Set<string>();
  const entries: RedactionEntry[] = [];
  for (const e of raw) {
    const term = (e?.term ?? "").trim();
    const label = (e?.label ?? "").trim() || "redacted";
    const reason = (e?.reason ?? "").trim();
    if (
      term.length < MIN_TERM_LENGTH ||
      term.length > MAX_TERM_LENGTH ||
      reason.length < 3
    ) {
      return { ok: false, reason: "invalid_term" };
    }
    const key = term.toLowerCase();
    if (seen.has(key)) return { ok: false, reason: "duplicate_term" };
    seen.add(key);
    entries.push({ term, label, reason });
  }
  // Longest first: a longer term containing a shorter one must be
  // replaced before the shorter one can fragment it.
  entries.sort((a, b) => b.term.length - a.term.length);
  return { ok: true, entries };
}

// ---------------------------------------------------------------------
// The matcher (ONE matcher for production AND verification)
// ---------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive, whitespace-tolerant matcher: the term's tokens must
 * appear in order with any whitespace between them, so a term wrapped
 * across lines ("Acme Trading\nPvt. Ltd.") is still found and removed.
 * The same builder is used for removal and for the absence re-scan, so
 * verification is exactly as strong as the removal — never stronger.
 */
export function buildTermRegex(term: string): RegExp {
  const tokens = term.trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(tokens.join("\\s+"), "gi");
}

/** Remove every occurrence of every entry; report per-term hit counts. */
export function applyRedactions(
  text: string,
  entries: RedactionEntry[],
): { output: string; hits: { term: string; count: number }[] } {
  let output = text;
  const hits: { term: string; count: number }[] = [];
  for (const e of entries) {
    const count = output.match(buildTermRegex(e.term))?.length ?? 0;
    if (count > 0) {
      // Function replacement: the marker is inserted literally (no `$`
      // substitution semantics), whatever the label contains.
      const marker = `[REDACTED: ${e.label}]`;
      output = output.replace(buildTermRegex(e.term), () => marker);
    }
    hits.push({ term: e.term, count });
  }
  return { output, hits };
}

/** Re-scan text for the terms (used on the DERIVATIVE to verify). */
export function scanText(
  text: string,
  entries: RedactionEntry[],
): { term: string; remaining: number }[] {
  return entries.map((e) => ({
    term: e.term,
    remaining: text.match(buildTermRegex(e.term))?.length ?? 0,
  }));
}

/** True only when EVERY term is provably absent. */
export function allAbsent(
  scan: { term: string; remaining: number }[],
): boolean {
  return scan.every((s) => s.remaining === 0);
}
