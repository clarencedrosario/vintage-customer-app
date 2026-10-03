// =====================================================================
// §32 PHASE 10 — CLIENT-UPDATE DRAFTS (pure layer).
//
// Posture: a client update may only state what the chamber has
// APPROVED as a development. This layer is the deterministic core of
// that discipline:
//
//  - APPROVED-DEVELOPMENTS-ONLY: the draft body is ASSEMBLED from a
//    lawyer-selected set of approved matter-timeline entries. There is
//    no free-text channel here: whatever the chamber has not approved
//    as a development cannot appear in the assembled body. The footer
//    disclosure travels with every body.
//  - SEND-TIME RE-VERIFICATION: a draft freezes the digest of every
//    development it was built from. Before queueing, the module
//    re-derives the CURRENT digest/approval of each one; any missing,
//    changed or no-longer-approved development BLOCKS the send with a
//    precise problem list — the draft must be regenerated, never
//    silently patched.
//  - DUPLICATE-SEND PREVENTION: the same development set must not
//    reach the client twice. The decision is made against the existing
//    send ledger (sent drafts + the comm outbox states) — the outbox's
//    own status guards remain the delivery-side backstop.
//
// Honest limits: the digest here is change DETECTION for re-approval,
// not a security attestation; the body is deliberately plain (no
// tone/promising language is added by the assembler).
// =====================================================================

/** A development as frozen into a draft (title/date/detail + digest). */
export type DevelopmentSnapshot = {
  refKey: string;
  entryKind: string;
  title: string;
  date: string; // YYYY-MM-DD
  detail?: string;
};

/** A provenance item stored on a draft (refKey + change-detection digest). */
export type ProvenanceItem = {
  refKey: string;
  title: string;
  digest: string;
};

export const MAX_DEVELOPMENTS = 25;

/** Travels with EVERY assembled body — the honest framing. */
export const UPDATE_FOOTER =
  "This update is drawn only from the developments listed above, each approved by your legal team. It is a summary for your information — the underlying documents and court records remain the authoritative record.";

/**
 * Deterministically assemble the update body. Plain and factual: date,
 * title, optional detail. Nothing is added, promised or softened.
 */
export function assembleUpdateBody(
  matterRef: string,
  items: DevelopmentSnapshot[],
): string {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const lines = sorted.map(
    (i) => `• ${i.date} — ${i.title}${i.detail ? `: ${i.detail}` : ""}`,
  );
  return [
    `Matter update — ${matterRef}`,
    "",
    ...(lines.length ? lines : ["(no developments selected)"]),
    "",
    UPDATE_FOOTER,
  ].join("\n");
}

/** Canonical input for the development-set key (order-independent). */
export function canonicalSetInput(digests: string[]): string {
  return [...digests].sort().join("|");
}

// ---------------------------------------------------------------------
// Send-time re-verification
// ---------------------------------------------------------------------

export type ProvenanceProblem = {
  refKey: string;
  problem: "missing" | "not_approved" | "changed";
};

export type DevelopmentNow = {
  digest: string;
  approved: boolean;
} | null;

/**
 * Re-verify a draft's frozen provenance against the CURRENT state of
 * each development. Any missing / no-longer-approved / changed
 * development is a problem — one precise entry per refKey.
 */
export function reverifyProvenance(
  snapshot: ProvenanceItem[],
  current: Map<string, DevelopmentNow>,
): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  for (const item of snapshot) {
    const now = current.get(item.refKey);
    if (!now) {
      problems.push({ refKey: item.refKey, problem: "missing" });
      continue;
    }
    if (!now.approved) {
      problems.push({ refKey: item.refKey, problem: "not_approved" });
      continue;
    }
    if (now.digest !== item.digest) {
      problems.push({ refKey: item.refKey, problem: "changed" });
    }
  }
  return problems;
}

export function describeProblems(problems: ProvenanceProblem[]): string {
  const what = problems
    .map((p) => `${p.refKey.slice(0, 8)}… (${p.problem})`)
    .join(", ");
  return `Underlying developments changed since this draft was prepared: ${what}. Regenerate the draft from the current approved developments — do not send a stale draft.`;
}

// ---------------------------------------------------------------------
// Duplicate-send prevention (against the existing send ledger)
// ---------------------------------------------------------------------

/**
 * Outbox states that mean "this communication exists on the delivery
 * path or has been delivered" — a second queue of the same set is a
 * duplicate. cancelled/failed/rejected do NOT block: the outbox owns
 * their retry/reissue lifecycle deliberately.
 */
const BLOCKING_OUTBOX_STATES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "awaiting_configuration",
] as const;

export function duplicateSendDecision(input: {
  priorSentSetKeyAt?: number | null;
  outboxStatus?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (input.priorSentSetKeyAt) {
    return {
      ok: false,
      reason: `This exact development set was already sent on ${new Date(input.priorSentSetKeyAt).toISOString().slice(0, 10)} — sending the same update twice is prevented. Prepare a new draft if you have NEW approved developments to add.`,
    };
  }
  if (
    input.outboxStatus &&
    (BLOCKING_OUTBOX_STATES as readonly string[]).includes(input.outboxStatus)
  ) {
    return {
      ok: false,
      reason: `This draft is already on the delivery path (outbox status: ${input.outboxStatus}). Track it in the communication outbox instead of queueing again.`,
    };
  }
  return { ok: true };
}
