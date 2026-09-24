// ---------------------------------------------------------------------
// Layer 2 — Document utilities.
//
//   • computeDeadlineSeverity(dueDate) — Tailwind severity classes from
//     time-to-deadline: red (overdue), orange (due within 48h),
//     green (future). Missing/unparsable dates are neutral, never red —
//     a broken date must not trigger urgency styling.
//
//   • generateSecureDownloadLink(fileKey) — a 15-minute HMAC-signed
//     link token. Pure implementation (crypto.ts HMAC-SHA256, no
//     node:crypto) so the Convex query sandbox can sign and verify.
//     Platform bindings: documents.issueSecureDownloadLink (issue) and
//     the /secure_file HTTP route (redeem) — Convex file storage plays
//     the object-storage role; the token replaces the presigned URL.
// ---------------------------------------------------------------------

import { hmacSha256Hex } from "../convex/crypto";

// ---------------------------------------------------------------
// Deadline severity (case timeline)
// ---------------------------------------------------------------

export type DeadlineSeverity = "overdue" | "due_soon" | "future" | "neutral";

export const DEADLINE_SEVERITY: Record<
  DeadlineSeverity,
  { label: string; className: string; dot: string }
> = {
  overdue: {
    label: "Overdue",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    dot: "bg-red-600",
  },
  due_soon: {
    label: "Due within 48h",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    dot: "bg-orange-600",
  },
  future: {
    label: "Upcoming",
    className:
      "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
    dot: "bg-green-600",
  },
  neutral: {
    label: "No date",
    className: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/** IST offset (+5:30) — the project's canonical timezone. */
export const IST_OFFSET_MINUTES = 330;

/**
 * UTC ms of the END of a YYYY-MM-DD calendar day in IST. A deadline due
 * "today" is not overdue until the IST day closes (18:59:59.999 UTC).
 * Returns null for unparsable input.
 */
export function istDayEndUtc(dueDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  if (!m) return null;
  const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], 18, 59, 59, 999);
  return Number.isNaN(utcMs) ? null : utcMs;
}

/** 48-hour due-soon window in ms. */
export const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Severity from time-to-deadline: red / orange / green (neutral for
 * invalid dates). `dueDate` is an IST YYYY-MM-DD case-timeline string.
 */
export function computeDeadlineSeverity(
  dueDate: string | null | undefined,
  now: number = Date.now(),
): { severity: DeadlineSeverity; label: string; className: string; dot: string } {
  const neutral = DEADLINE_SEVERITY.neutral;
  if (!dueDate || typeof dueDate !== "string") {
    return { severity: "neutral", ...neutral };
  }
  const dayEnd = istDayEndUtc(dueDate);
  if (dayEnd === null) {
    return {
      severity: "neutral",
      label: "Invalid date",
      className: neutral.className,
      dot: neutral.dot,
    };
  }
  if (now > dayEnd) return { severity: "overdue", ...DEADLINE_SEVERITY.overdue };
  if (dayEnd - now <= DUE_SOON_WINDOW_MS) {
    return { severity: "due_soon", ...DEADLINE_SEVERITY.due_soon };
  }
  return { severity: "future", ...DEADLINE_SEVERITY.future };
}

// ---------------------------------------------------------------
// Secure download links (15-minute signed tokens)
// ---------------------------------------------------------------

/** Link lifetime: 15 minutes, per spec. */
export const DOWNLOAD_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Token format: `<fileKey>.<expiresAtMs>.<hmac_hex>` — every component
 * is URL-safe (hex/numeric/Convex ids), no further encoding needed.
 */
export function signDownloadToken(
  fileKey: string,
  expiresAt: number,
  secret: string,
): string {
  const sig = hmacSha256Hex(secret, `secure_file:${fileKey}:${expiresAt}`);
  return `${fileKey}.${expiresAt}.${sig}`;
}

/**
 * Verify a signed token: signature first (constant-time string compare),
 * then expiry. Returns the verified fileKey on success.
 */
export function verifyDownloadToken(
  token: string,
  secret: string,
  now: number,
): { ok: true; fileKey: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed token." };
  const [fileKey, expiresStr, sig] = parts;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt)) {
    return { ok: false, reason: "Malformed expiry." };
  }
  const expected = hmacSha256Hex(secret, `secure_file:${fileKey}:${expiresAt}`);
  if (sig.length !== expected.length) {
    return { ok: false, reason: "Invalid signature." };
  }
  // Constant-time comparison over equal-length hex strings.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "Invalid signature." };
  if (now > expiresAt) return { ok: false, reason: "Link expired." };
  return { ok: true, fileKey };
}

/**
 * The requested entry point: a short-lived (15-minute) signed download
 * link for a stored file. `secret` comes from the server environment
 * (Keys tab → SECURE_FILE_LINK_SECRET); `now` is injectable for tests.
 * The platform binding resolves `fileKey` to actual bytes via Convex
 * file storage on the /secure_file route.
 */
export function generateSecureDownloadLink(
  fileKey: string,
  opts: { secret: string; now?: number; baseUrl?: string },
): { token: string; url: string; path: string; expiresAt: number } {
  const now = opts.now ?? Date.now();
  const expiresAt = now + DOWNLOAD_LINK_TTL_MS;
  const token = signDownloadToken(fileKey, expiresAt, opts.secret);
  const path = `/secure_file?t=${token}`;
  return {
    token,
    path,
    url: `${(opts.baseUrl ?? "").replace(/\/$/, "")}${path}`,
    expiresAt,
  };
}
