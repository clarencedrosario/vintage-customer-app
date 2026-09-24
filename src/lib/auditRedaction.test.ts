import { describe, expect, it } from "vitest";
import { REDACTED_HEADERS, buildAuditMetadata, redactSensitive } from "./auditRedaction";

// Layer 3 — audit redaction guarantees (the pure half of auditLogger;
// the database half fails silently by construction in convex/auditLogger.ts).

describe("redactSensitive", () => {
  it("removes token-like hex strings", () => {
    const out = redactSensitive("key sk_test_abcdef0123456789abcdef0123456789 leaked");
    expect(out).toContain("[redacted-token]");
    expect(out).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("removes bare hex tokens embedded after underscores", () => {
    const out = redactSensitive("sig=aabbccdd0011aabbccdd0011aabbccdd");
    expect(out).toContain("[redacted-token]");
    expect(out).not.toContain("aabbccdd0011aabbccdd0011aabbccdd");
  });

  it("removes GitHub and Slack style tokens", () => {
    expect(redactSensitive("t=ghp_0123456789abcdefghijklmnop")).toContain("[redacted-token]");
    expect(redactSensitive("t=xoxb-01234567890-abcdefghijklmnop")).toContain("[redacted-token]");
  });

  it("removes email addresses", () => {
    expect(redactSensitive("contact client@example.in today")).toBe(
      "contact [redacted-email] today",
    );
  });

  it("removes card-like number sequences", () => {
    expect(redactSensitive("card 4111 1111 1111 1111 on file")).toContain(
      "[redacted-card]",
    );
  });

  it("leaves ordinary detail text untouched", () => {
    const t = "Approved written submissions in matter ADV/2026/0001";
    expect(redactSensitive(t)).toBe(t);
  });
});

describe("buildAuditMetadata", () => {
  const base = {
    userId: "user-1234567890abcdef",
    organizationId: "org-1",
    actionType: "document.download_link_issued",
    resourceId: "doc-42",
  };

  it("captures action, org/resource context and an actor prefix", () => {
    const m = buildAuditMetadata(base);
    expect(m.action).toBe("document.download_link_issued");
    expect(m.detail).toContain("org=org-1");
    expect(m.detail).toContain("resource=doc-42");
    expect(m.actorName).toBe("user:user-1234567"); // 12-char cap
  });

  it("reads IP and user-agent from a request and redacts them", () => {
    const m = buildAuditMetadata({
      ...base,
      req: {
        socket: { remoteAddress: "10.1.2.3" },
        headers: { "user-agent": "Mozilla/5.0 client@example.in" },
      },
    });
    expect(m.ip).toBe("10.1.2.3");
    expect(m.userAgent).toBe("Mozilla/5.0 [redacted-email]");
  });

  it("accepts fetch-style Headers objects", () => {
    const headers = new Headers({ "user-agent": "TestUA/1.0" });
    const m = buildAuditMetadata({ ...base, req: { headers } });
    expect(m.userAgent).toBe("TestUA/1.0");
  });

  it("falls back to unknown when no request is supplied", () => {
    const m = buildAuditMetadata(base);
    expect(m.ip).toBe("unknown");
    expect(m.userAgent).toBe("unknown");
  });

  it("caps action length and never includes confidential header values", () => {
    const m = buildAuditMetadata({
      ...base,
      actionType: "a".repeat(500),
      req: {
        headers: {
          authorization: "Bearer super-secret",
          cookie: "session=abc",
          "user-agent": "UA",
        },
      },
    });
    expect(m.action).toHaveLength(120);
    expect(m.userAgent).toBe("UA");
    expect(JSON.stringify(m)).not.toContain("super-secret");
    expect(JSON.stringify(m)).not.toContain("session=abc");
  });

  it("REDACTED_HEADERS names the header classes never logged", () => {
    expect(REDACTED_HEADERS).toContain("authorization");
    expect(REACTED_GUARD()).toBe(true);
  });
  function REACTED_GUARD() {
    return REDACTED_HEADERS.includes("cookie" as never);
  }
});
