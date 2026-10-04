// =====================================================================
// §32 PHASE 12 — COMPLETE FIRM EXPORT & EXIT (pure layer).
//
// The end of the firm's journey: a COMPLETE, VERIFIED, PORTABLE export
// and a controlled exit — extending (never replacing) the existing
// machinery: backups.ts archive records, saasExports one-time tokens,
// and the Phase 7 legal-hold gate on deletion.
//
// Honesty rules encoded here:
//  - COMPLETENESS: every covered table is listed in the manifest with
//    its exported row count; every table in the org that is NOT covered
//    is listed as an OMISSION with a reason. Nothing is silently left
//    behind, and "complete" is a statement about a CATALOGUE.
//  - INTEGRITY: every part carries a SHA-256 over its exact bytes;
//    verifyJob re-reads storage and recomputes — a mismatch is a
//    FAILED verification, never silently repaired or excused.
//  - LEGAL-HOLD RESPECT: an active hold BLOCKS export-wide deletion
//    for every member including owners — the exit is an export, not a
//    destruction path. Holds are listed, not lifted, by this module.
//  - REAUTHENTICATION: starting, revoking and closing exit require a
//    recent successful sign-in (evidence: loginEvents). A stolen
//    session cannot destroy a firm's access to its own data.
//  - RESUMABILITY: one job, ordered checkpoints (table buckets in a
//    fixed sequence), an explicit resume cursor, and a fence — rows
//    are only appended at exactly the recorded cursor position, so a
//    retry can never duplicate rows.
//  - DOWNLOADS: expiring (bounded), single-use, audited links to
//    storage objects that ALREADY exist — expiry is the mechanism,
//    not revocation of data the firm already holds.
// =====================================================================

export type ExportJobStatus =
  | "collecting"
  | "awaiting_reauthentication"
  | "awaiting_download"
  | "revoked";

export const WINDOW_MS = 7 * 24 * 3600_000;
export const DOWNLOAD_TTL_MS = 3600_000; // expiring downloads: 1 hour
export const MAX_PARTS_PER_JOB = 200;

// ---------------------------------------------------------------------
// Resumable checkpoint sequence
// ---------------------------------------------------------------------

/** Deterministic collection order: org-scoped tables get one
 * checkpoint; matter-scoped tables get one per matter. */
export type Checkpoint = { table: string; matterIndex: number };

export type TableSpec = { table: string; kind: "org" | "matter" };

export function planCheckpoints(
  specs: readonly TableSpec[],
  matterCount: number,
): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (const spec of specs) {
    if (spec.kind === "org") {
      out.push({ table: spec.table, matterIndex: 0 });
    } else {
      for (let m = 0; m < Math.max(matterCount, 1); m += 1) {
        out.push({ table: spec.table, matterIndex: m });
      }
    }
  }
  return out;
}

export function checkpointKey(c: Checkpoint): string {
  return `${c.table}#${c.matterIndex}`;
}

export type ResumeState = {
  done: string[]; // checkpoint keys completed, in order
  next: string | null; // where a retry resumes
  progress: number; // 0..1
};

export function computeResume(doneKeys: string[], plan: Checkpoint[]): ResumeState {
  const planKeys = plan.map(checkpointKey);
  // Only a PREFIX of the plan counts as done — a completed checkpoint
  // out of order is refused by the caller; here we take the longest
  // matching prefix defensively.
  let i = 0;
  while (i < doneKeys.length && i < planKeys.length && doneKeys[i] === planKeys[i]) {
    i += 1;
  }
  return {
    done: planKeys.slice(0, i),
    next: i < planKeys.length ? planKeys[i]! : null,
    progress: planKeys.length === 0 ? 1 : Math.round((i / planKeys.length) * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------
// Manifest + checksums + omissions
// ---------------------------------------------------------------------

export type ManifestPart = {
  table: string;
  rows: number;
  sha256: string;
  storageId: string;
};

export type ManifestOmission = {
  table: string;
  rows: number;
  reason: string;
};

export type ExitManifest = {
  schemaVersion: 1;
  exportedAt: string;
  organization: { name: string; slug: string };
  parts: ManifestPart[];
  omissions: ManifestOmission[];
  documentsInStorage: number;
  legalHolds: { matterReference: string; reasonKind: string; placedAt: number }[];
  definition: string;
};

export const MANIFEST_DEFINITION =
  "COMPLETE means: every covered table is exported and counted in this manifest, and every org table NOT covered is listed as an omission with a reason. Completeness is a statement about this catalogue — always verify checksums after download (verifyJob recomputes them independently).";

export function computeOmissions(
  exportedTableNames: readonly string[],
  allTableNames: readonly string[],
  countsByTable: Record<string, number>,
  note?: string,
): ManifestOmission[] {
  const covered = new Set(exportedTableNames);
  const omissions: ManifestOmission[] = [];
  for (const t of allTableNames) {
    if (covered.has(t)) continue;
    const rows = countsByTable[t] ?? 0;
    if (rows === 0) continue; // nothing to omit
    omissions.push({
      table: t,
      rows,
      reason:
        t === "matterDocuments" || t === "clientPortalUploads"
          ? "Binary file bytes live in object storage, not table rows; document FILE parts are included separately when present."
          : note ??
            "Operational/system table — deliberately outside the firm-data export scope; recorded here so nothing is silently left behind.",
    });
  }
  return omissions.sort((a, b) => b.rows - a.rows);
}

export function manifestLineCount(manifest: ExitManifest): number {
  return manifest.parts.reduce((acc, p) => acc + p.rows, 0);
}

// ---------------------------------------------------------------------
// Reauthentication gate
// ---------------------------------------------------------------------

export function reauthState(
  lastSuccessfulLoginAt: number | null | undefined,
  now: number,
): { satisfied: boolean; ageMs: number | null; reason: string } {
  if (!lastSuccessfulLoginAt) {
    return {
      satisfied: false,
      ageMs: null,
      reason: "No successful sign-in is on record for your account — sign in again to confirm your identity before this action.",
    };
  }
  const ageMs = now - lastSuccessfulLoginAt;
  if (ageMs > WINDOW_MS) {
    return {
      satisfied: false,
      ageMs,
      reason: `Your last successful sign-in was ${Math.floor(ageMs / 3600_000)}h ago (allowed: within 168h). Sign in again to confirm your identity.`,
    };
  }
  return {
    satisfied: true,
    ageMs,
    reason: "Recent successful sign-in on record.",
  };
}

export function requireReauth(
  lastSuccessfulLoginAt: number | null | undefined,
  now: number,
): void {
  const s = reauthState(lastSuccessfulLoginAt, now);
  if (!s.satisfied) throw new Error(s.reason);
}

// ---------------------------------------------------------------------
// Resume fence: append-only, position-checked parts
// ---------------------------------------------------------------------

export type PendingPart = { table: string; rows: number; sha256: string; storageId: string };

/**
 * Append the next completed part at EXACTLY the resume cursor. Throws
 * on any position drift — a retried worker can advance the job but can
 * never duplicate or reorder rows.
 */
export function appendPartAtCursor(
  state: { parts: PendingPart[]; cursor: number },
  part: PendingPart,
  plan: Checkpoint[],
): void {
  if (state.parts.length !== state.cursor) {
    throw new Error(
      `Resume fence violated: parts (${state.parts.length}) and cursor (${state.cursor}) disagree.`,
    );
  }
  const expected = plan[state.cursor];
  const key = expected ? checkpointKey(expected) : null;
  if (!key || key !== `${part.table}#${expected?.matterIndex ?? -1}`) {
    throw new Error(
      `Resume fence violated: part for "${part.table}" does not match the planned checkpoint (${key ?? "plan exhausted"}).`,
    );
  }
  state.parts.push(part);
  state.cursor += 1;
}

// ---------------------------------------------------------------------
// Download tokens (expiring, single-use, audited)
// ---------------------------------------------------------------------

export type DownloadGrant = {
  storageId: string;
  expiresAt: number;
  usedAt: number | null;
};

export function downloadDecision(
  grant: DownloadGrant | null | undefined,
  now: number,
): { ok: true } | { ok: false; reason: string } {
  if (!grant) return { ok: false, reason: "No download grant exists for this part." };
  if (grant.usedAt) return { ok: false, reason: "This download link was already used (single-use)." };
  if (now > grant.expiresAt) {
    return {
      ok: false,
      reason: `This download link expired (TTL ${DOWNLOAD_TTL_MS / 60_000} minutes). Issue a fresh one — the exported data itself is unchanged.`,
    };
  }
  return { ok: true };
}
