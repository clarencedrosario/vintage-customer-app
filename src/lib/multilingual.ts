// =====================================================================
// §32 PHASE 9 — MULTILINGUAL EVIDENCE REVIEW (pure layer).
//
// Posture: Indian matters routinely hold evidence in more than one
// language (Hindi, Tamil, regional languages, English filings). This
// layer governs how TRANSLATIONS of evidence are recorded and shown —
// it never claims a translation is the evidence.
//
// Honesty rules encoded here:
//  - ORIGINAL PRESERVED: a translation is stored as a NEW record that
//    freezes a copy of the original text at translation time; the
//    original row (aiSources text / matterFacts statement) is NEVER
//    modified. If the live original later changes, the review view
//    flags the translation stale (see buildSideBySide staleness in the
//    module — the pure pairing here works on the frozen pair).
//  - MACHINE-LABELLED: anything not produced by a named human carries
//    a mandatory machine-translation disclosure, on every read, in
//    every export. There is no path that presents a machine rendering
//    unlabelled.
//  - HUMAN VERIFICATION IS AN ATTESTATION, not a transformation: a
//    lawyer may record that they compared a rendering against the
//    original; that never changes the text and never promotes the
//    translation to "the evidence".
//  - DATA-HANDLING RESTRICTIONS: recording a machine translation
//    produced by an EXTERNAL service implies the text was sent outside
//    the deployment. That is refused unless a human has recorded an
//    explicit data-handling decision for the matter. The honest
//    default is "unset" = external recording REFUSED (no silent
//    transfer, and no silent assumption that transfer is fine).
// =====================================================================

/** How a rendering was produced. */
export const TRANSLATION_PROVIDER_KINDS = [
  "manual", // a human produced the rendering (named translator)
  "machine_external", // an external automated service produced it (text left the deployment)
  "machine_self_hosted", // machinery inside the firm's own infrastructure produced it
] as const;

export type TranslationProviderKind = (typeof TRANSLATION_PROVIDER_KINDS)[number];

/** Facts implied by a provider kind — stored explicitly on the record. */
export function providerFacts(kind: TranslationProviderKind): {
  machineTranslated: boolean;
  externalTransfer: boolean;
} {
  switch (kind) {
    case "manual":
      return { machineTranslated: false, externalTransfer: false };
    case "machine_external":
      return { machineTranslated: true, externalTransfer: true };
    case "machine_self_hosted":
      // Recorded as machine-produced, but NOT an external transfer.
      return { machineTranslated: true, externalTransfer: false };
  }
}

// ---------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------

/**
 * Known language labels (English names) for codes the workspace is
 * likely to see. NOT a whitelist: a well-formed unknown code is
 * accepted and displayed as itself — we never invent a name for it.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  or: "Odia",
  as: "Assamese",
  kok: "Konkani",
  mai: "Maithili",
  ne: "Nepali",
  sa: "Sanskrit",
  ks: "Kashmiri",
  sd: "Sindhi",
  doi: "Dogri",
  mni: "Meiteilon (Manipuri)",
  ar: "Arabic",
  zh: "Chinese",
  fr: "French",
};

/** BCP-47-ish: 2–3 letter base code plus optional subtags. */
const LANGUAGE_CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isValidLanguageCode(code: string): boolean {
  return LANGUAGE_CODE_RE.test(code);
}

/** Display label: known map name, else the code itself (honest). */
export function languageLabel(code: string): string {
  const base = code.split("-")[0] ?? code;
  return LANGUAGE_NAMES[base] ?? code;
}

// ---------------------------------------------------------------------
// Side-by-side pairing (deterministic, explainable)
// ---------------------------------------------------------------------

/**
 * Segment a text for pairing: newline-separated paragraphs, trimmed,
 * empties dropped. Language-neutral (works for Devanagari and other
 * scripts; sentence-level splitting is deliberately NOT attempted —
 * punctuation conventions differ and a wrong split pretends
 * alignment that does not exist).
 */
export function splitSegments(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type SideBySideRow = {
  index: number;
  original: string;
  translated: string;
};

export type SideBySide = {
  alignment: "aligned" | "segment_count_mismatch";
  rows: SideBySideRow[];
  originalCount: number;
  translatedCount: number;
  /** Unpaired remainders when counts mismatch — shown, never hidden. */
  originalOnly: string[];
  translatedOnly: string[];
};

/**
 * Pair original and translated segments by index. When the segment
 * counts differ the mismatch is the headline: rows pair only up to the
 * shorter side and the remainders are returned explicitly. The view
 * must never imply a paragraph-by-paragraph correspondence that the
 * renderer did not actually produce.
 */
export function buildSideBySide(
  originalText: string,
  translatedText: string,
): SideBySide {
  const original = splitSegments(originalText);
  const translated = splitSegments(translatedText);
  const n = Math.min(original.length, translated.length);
  return {
    alignment: original.length === translated.length ? "aligned" : "segment_count_mismatch",
    rows: Array.from({ length: n }, (_, i) => ({
      index: i,
      original: original[i]!,
      translated: translated[i]!,
    })),
    originalCount: original.length,
    translatedCount: translated.length,
    originalOnly: n < original.length ? original.slice(n) : [],
    translatedOnly: n < translated.length ? translated.slice(n) : [],
  };
}

// ---------------------------------------------------------------------
// Data-handling permission for external processors
// ---------------------------------------------------------------------

export type ExternalProcessorPolicy = "unset" | "allowed" | "restricted";

export type PermissionDecision = {
  allowed: boolean;
  reason: string;
};

/**
 * Can a translation produced by `kind` be RECORDED for a matter whose
 * recorded data-handling policy is `policy`?
 *
 * - manual: allowed — a named human produced the rendering; recording
 *   it is a filing act inside the workspace, not an automated
 *   external disclosure. (Handing text to that human is itself a
 *   disclosure the firm manages outside this record — noted honestly
 *   in the reason.)
 * - machine_self_hosted: allowed — by definition of the record, no
 *   external service received the text.
 * - machine_external: allowed ONLY on an explicit recorded "allowed"
 *   decision. "unset" (the default) and "restricted" both refuse.
 */
export function evaluateExternalPermission(
  kind: TranslationProviderKind,
  policy: ExternalProcessorPolicy,
): PermissionDecision {
  if (kind === "manual") {
    return {
      allowed: true,
      reason:
        "Manual rendering by a named translator — recorded as an in-workspace filing act. Note: giving the text to that human is itself a disclosure the firm manages separately.",
    };
  }
  if (kind === "machine_self_hosted") {
    return {
      allowed: true,
      reason:
        "Self-hosted machinery — recorded as processing inside the firm's own infrastructure; no external transfer implied.",
    };
  }
  // machine_external
  if (policy === "allowed") {
    return {
      allowed: true,
      reason:
        "An explicit data-handling decision allows external processors on this matter.",
    };
  }
  if (policy === "restricted") {
    return {
      allowed: false,
      reason:
        "This matter's recorded data-handling decision RESTRICTS external processors — a machine translation from an external service cannot be recorded.",
    };
  }
  return {
    allowed: false,
    reason:
      "No data-handling decision is recorded for this matter (default: unset). Recording a machine_external translation implies the text was sent to an external service — record an explicit decision first (setHandlingPolicy).",
  };
}

// ---------------------------------------------------------------------
// Mandatory labels
// ---------------------------------------------------------------------

const MACHINE_LABEL = "MACHINE TRANSLATION — produced automatically";

/** Mandatory label for a machine rendering (travels with every read). */
export function machineTranslationDisclosure(
  providerName: string | undefined,
  providerVersion: string | undefined,
): string {
  const who = providerName?.trim() || "unspecified provider";
  const ver = providerVersion?.trim();
  return (
    `${MACHINE_LABEL} by ${who}${ver ? ` (${ver})` : ""}; it is NOT authoritative and NOT the evidence. ` +
    "Only the original text is evidence — use this rendering to navigate, and verify against the original before relying on it."
  );
}

/** Label once a lawyer has attested comparing the rendering to the original. */
export function humanVerificationDisclosure(
  verifierName: string,
  verifiedAt: number,
): string {
  return (
    `HUMAN-VERIFIED against the original by ${verifierName} on ${new Date(verifiedAt).toISOString().slice(0, 10)} — ` +
    "this attests a comparison of THIS rendering against the original text; it is not a certification of legal effect and does not make the translation the evidence."
  );
}

/** Label for a human-produced rendering (authorship recorded). */
export function manualTranslationDisclosure(
  translatorName: string | undefined,
): string {
  const who = translatorName?.trim() || "a named translator";
  return (
    `MANUAL RENDERING — produced by ${who}; authorship is recorded on the translation. ` +
    "This is still not the evidence — only the original text is."
  );
}

/** Label shown when the live original no longer matches the frozen snapshot. */
export const STALE_ORIGINAL_DISCLOSURE =
  "STALE — the original text has changed since this translation was recorded. The pairing below is against the FROZEN original; re-check before relying on it.";

// ---------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------

/** Snapshot size guard: absurdly large texts are refused, not truncated
 * (a truncated side-by-side pairing would silently mislead). */
export const MAX_TRANSLATION_CHARS = 200_000;

export const MIN_POLICY_NOTE_CHARS = 10; // same discipline as Phase 2/7 reasons

export function validateTranslationTexts(
  originalText: string,
  translatedText: string,
): { ok: true } | { ok: false; error: string } {
  if (!originalText.trim()) return { ok: false, error: "Original text is empty." };
  if (!translatedText.trim()) return { ok: false, error: "Translation is empty." };
  if (originalText.length > MAX_TRANSLATION_CHARS) {
    return {
      ok: false,
      error: `Original text exceeds ${MAX_TRANSLATION_CHARS} chars — translate per-page sources instead (a truncated snapshot would mislead the pairing).`,
    };
  }
  if (translatedText.length > MAX_TRANSLATION_CHARS) {
    return { ok: false, error: `Translation exceeds ${MAX_TRANSLATION_CHARS} chars.` };
  }
  return { ok: true };
}
