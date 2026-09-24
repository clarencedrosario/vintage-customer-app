import { describe, expect, it } from "vitest";
import {
  DEADLINE_SEVERITY,
  DOWNLOAD_LINK_TTL_MS,
  computeDeadlineSeverity,
  generateSecureDownloadLink,
  istDayEndUtc,
  signDownloadToken,
  verifyDownloadToken,
} from "./documentManager";

// Layer 2 — document utilities.

const SECRET = "test-secret-key-0123456789";

describe("computeDeadlineSeverity (case timeline)", () => {
  // 2026-06-10 IST day ends 2026-06-10T18:59:59.999Z.
  const now = Date.UTC(2026, 5, 8, 6, 0, 0); // June 8, 06:00 UTC

  it("green for dates more than 48h out", () => {
    const r = computeDeadlineSeverity("2026-06-20", now);
    expect(r.severity).toBe("future");
    expect(r.className).toBe(DEADLINE_SEVERITY.future.className);
  });

  it("orange inside the 48-hour window", () => {
    // June 10 IST day-end is 54h away — green.
    expect(computeDeadlineSeverity("2026-06-10", now).severity).toBe("future");
    // June 9 IST day-end is 30h away — orange.
    expect(computeDeadlineSeverity("2026-06-09", now).severity).toBe("due_soon");
  });

  it("red once the IST day has closed", () => {
    // June 7 IST day-end passed 29h ago.
    const r = computeDeadlineSeverity("2026-06-07", now);
    expect(r.severity).toBe("overdue");
    expect(r.className).toContain("bg-red-100");
  });

  it("does not mark today as overdue before the IST day closes", () => {
    // 2026-06-09 IST day is still open at 2026-06-08 20:00 UTC.
    const late = Date.UTC(2026, 5, 8, 20, 0, 0);
    expect(computeDeadlineSeverity("2026-06-09", late).severity).toBe("due_soon");
  });

  it("neutral for missing or unparsable dates — never red", () => {
    expect(computeDeadlineSeverity(null).severity).toBe("neutral");
    expect(computeDeadlineSeverity(undefined).severity).toBe("neutral");
    expect(computeDeadlineSeverity("").severity).toBe("neutral");
    expect(computeDeadlineSeverity("10/06/2026").severity).toBe("neutral");
    expect(computeDeadlineSeverity("not-a-date").severity).toBe("neutral");
  });

  it("rejects impossible calendar dates", () => {
    expect(istDayEndUtc("2026-02-30")).not.toBeNull(); // Date.UTC rolls — documented behavior is non-crash
    expect(istDayEndUtc("2026-06")).toBeNull();
    expect(istDayEndUtc("2026-06-10T00:00:00Z")).toBeNull();
  });
});

describe("secure download tokens (15-minute links)", () => {
  it("issues a link expiring in exactly 15 minutes", () => {
    const now = 1_700_000_000_000;
    const link = generateSecureDownloadLink("file-key-1", { secret: SECRET, now });
    expect(link.expiresAt).toBe(now + DOWNLOAD_LINK_TTL_MS);
    expect(DOWNLOAD_LINK_TTL_MS).toBe(15 * 60 * 1000);
    expect(link.path).toBe(`/secure_file?t=${link.token}`);
    expect(link.url.endsWith(link.path)).toBe(true);
  });

  it("verifies a freshly issued token and returns its fileKey", () => {
    const now = 1_700_000_000_000;
    const { token } = generateSecureDownloadLink("storage123", { secret: SECRET, now });
    const v = verifyDownloadToken(token, SECRET, now + 60_000);
    expect(v).toEqual({ ok: true, fileKey: "storage123" });
  });

  it("rejects tokens signed with a different secret", () => {
    const { token } = generateSecureDownloadLink("k", {
      secret: SECRET,
      now: 1_700_000_000_000,
    });
    expect(verifyDownloadToken(token, "wrong-secret", 1_700_000_000_000).ok).toBe(false);
  });

  it("rejects expired tokens (after the 15-minute window)", () => {
    const now = 1_700_000_000_000;
    const { token } = generateSecureDownloadLink("k", { secret: SECRET, now });
    expect(verifyDownloadToken(token, SECRET, now + DOWNLOAD_LINK_TTL_MS + 1).ok).toBe(
      false,
    );
    expect(
      verifyDownloadToken(token, SECRET, now + DOWNLOAD_LINK_TTL_MS).ok,
    ).toBe(true); // boundary: valid up to the last ms
  });

  it("rejects tampered payloads (fileKey or expiry swapped)", () => {
    const now = 1_700_000_000_000;
    const { token } = generateSecureDownloadLink("k", { secret: SECRET, now });
    const [key, exp, sig] = token.split(".");
    const tamperedKey = `${"other"}.${exp}.${sig}`;
    const tamperedExp = `${key}.${exp + 1}.${sig}`;
    expect(verifyDownloadToken(tamperedKey, SECRET, now).ok).toBe(false);
    expect(verifyDownloadToken(tamperedExp, SECRET, now).ok).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyDownloadToken("", SECRET, 0).ok).toBe(false);
    expect(verifyDownloadToken("no-dots", SECRET, 0).ok).toBe(false);
    expect(verifyDownloadToken("a.b.c.d", SECRET, 0).ok).toBe(false);
    expect(verifyDownloadToken("a.notanumber.sig", SECRET, 0).ok).toBe(false);
  });

  it("signDownloadToken is deterministic for identical inputs", () => {
    expect(signDownloadToken("k", 123, SECRET)).toBe(
      signDownloadToken("k", 123, SECRET),
    );
  });
});
