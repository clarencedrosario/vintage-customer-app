// ---------------------------------------------------------------------
// Layer 3 — Audit logging (pure metadata + redaction rules).
//
// Pure functions so the redaction guarantees are unit-tested. The
// platform binding (logUserAction in src/convex/auditLogger.ts) writes
// to the existing append-only auditLog table and NEVER lets a logging
// failure propagate: it catches every database error and returns a
// structured `logged: false` result so the core flow never crashes.
// ---------------------------------------------------------------------

export type LogMetadataInput = {
  userId?: string | null;
  organizationId?: string | null;
  actionType?: string | null;
  resourceId?: string | null;
  req?: {
    headers?: unknown;
    socket?: { remoteAddress?: unknown } | null;
  } | null;
};

export type AuditMetadata = {
  action: string;
  detail: string;
  actorName: string;
  ip: string;
  userAgent: string;
};

/** Header keys that may carry confidential material — never logged. */
export const REDACTED_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-csrf-token",
  "proxy-authorization",
] as const;

const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Prefixed provider keys (sk_test_…, sk_live_…, ghp_…, xoxb-…).
  { pattern: /\b(?:sk|pk|rk)_[A-Za-z0-9_-]{12,}\b/g, replacement: "[redacted-token]" },
  { pattern: /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{16,}\b/g, replacement: "[redacted-token]" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "[redacted-token]" },
  // Bare hex tokens — lookarounds so underscore-embedded runs match too.
  { pattern: /(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])/g, replacement: "[redacted-token]" },
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, replacement: "[redacted-email]" },
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[redacted-card]" },
];

/**
 * Redact confidential material from free text destined for the log.
 * Tokens, emails and card-like numbers never reach the audit trail.
 */
export function redactSensitive(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Minimal read-only header view; values are read, never persisted raw. */
function readHeaders(headers: unknown): { get(name: string): string | null } {
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    const h = headers as Headers;
    return { get: (n) => h.get(n) };
  }
  if (headers && typeof headers === "object") {
    const rec = headers as Record<string, unknown>;
    return {
      get: (n) => {
        const v = rec[n] ?? rec[n.toLowerCase()];
        return typeof v === "string" ? v : null;
      },
    };
  }
  return { get: () => null };
}

/**
 * Build the audit record's metadata from an action descriptor and an
 * optional request-like object (fetch Headers or plain header record).
 * Confidential headers are never read; IP and user-agent are captured
 * (and themselves redacted); everything else is discarded.
 */
export function buildAuditMetadata(input: LogMetadataInput): AuditMetadata {
  const action =
    (input.actionType ?? "unknown").trim().slice(0, 120) || "unknown";
  const actorName = input.userId
    ? `user:${input.userId.slice(0, 12)}`
    : "anonymous";

  let ip = "unknown";
  let userAgent = "unknown";
  const req = input.req;
  if (req) {
    const socketIp =
      typeof req.socket?.remoteAddress === "string"
        ? req.socket.remoteAddress
        : undefined;
    if (socketIp) ip = redactSensitive(socketIp);
    const ua = readHeaders(req.headers).get("user-agent");
    if (ua) userAgent = redactSensitive(ua.slice(0, 200));
  }

  const detailParts: string[] = [];
  if (input.organizationId) detailParts.push(`org=${input.organizationId}`);
  if (input.resourceId) detailParts.push(`resource=${input.resourceId}`);
  const detail = redactSensitive(detailParts.join(" "));

  return { action, detail, actorName, ip, userAgent };
}
