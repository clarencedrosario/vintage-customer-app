import { describe, expect, it } from "vitest";
import {
  appendCustody,
  CUSTODY_ACTIONS,
  custodyDay,
  describeCustodyEvent,
  isValidSha256Hex,
  sha256Hex,
  shortHash,
} from "./evidenceIntegrity";

// -----------------------------------------------------------------
// sha256Hex — deterministic vectors (WebCrypto available in vitest
// node/jsdom via Node webcrypto global).
// -----------------------------------------------------------------

describe("sha256Hex", () => {
  it("hashes the empty string to the known SHA-256 vector", async () => {
    const encoder = new TextEncoder();
    const hex = await sha256Hex(encoder.encode(""));
    expect(hex).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc' to the known vector", async () => {
    const hex = await sha256Hex(new TextEncoder().encode("abc"));
    expect(hex).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("accepts ArrayBuffer input", async () => {
    const buf = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(await sha256Hex(buf)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces lowercase hex of length 64", async () => {
    const hex = await sha256Hex(new TextEncoder().encode("résumé ⚖"));
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("isValidSha256Hex / shortHash", () => {
  it("accepts only 64 lowercase hex chars", () => {
    expect(isValidSha256Hex("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(true);
    expect(isValidSha256Hex("E3B0C44298FC1C149AFBF4C8996FB924")).toBe(false); // uppercase
    expect(isValidSha256Hex("abc123")).toBe(false);
    expect(isValidSha256Hex("g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(false);
    expect(isValidSha256Hex(undefined)).toBe(false);
    expect(isValidSha256Hex(null)).toBe(false);
  });

  it("shortens a valid hash and rejects invalid ones", () => {
    expect(shortHash("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(
      "e3b0c44298fc…",
    );
    expect(shortHash("nope")).toBeNull();
    expect(shortHash(undefined)).toBeNull();
  });
});

describe("custody events", () => {
  it("exposes the documented action vocabulary", () => {
    expect(CUSTODY_ACTIONS).toContain("filed");
    expect(CUSTODY_ACTIONS).toContain("submitted_by_client");
    expect(CUSTODY_ACTIONS).toContain("accepted_from_request");
    expect(CUSTODY_ACTIONS).toContain("imported");
    expect(CUSTODY_ACTIONS).toContain("downloaded");
    expect(CUSTODY_ACTIONS).toContain("integrity_verified");
    expect(CUSTODY_ACTIONS).toContain("integrity_mismatch");
    expect(CUSTODY_ACTIONS).toContain("version_added");
    expect(CUSTODY_ACTIONS).toContain("restored");
    expect(CUSTODY_ACTIONS).toContain("note");
  });

  it("describes an integrity mismatch with a clear alert phrase", () => {
    const text = describeCustodyEvent({
      at: new Date("2026-09-26T10:00:00+05:30").getTime(),
      byName: "A. Partner",
      action: "integrity_mismatch",
    });
    expect(text).toContain("INTEGRITY MISMATCH");
    expect(text).toContain("A. Partner");
  });

  it("falls back to System when no actor is recorded", () => {
    const text = describeCustodyEvent({ at: Date.now(), action: "filed" });
    expect(text).toContain("System");
  });

  it("appends a note when present", () => {
    const text = describeCustodyEvent({
      at: Date.now(),
      byName: "Clerk",
      action: "note",
      note: "Original marked as exhibit A",
    });
    expect(text).toContain("exhibit A");
  });
});

describe("appendCustody", () => {
  it("appends to an undefined trail", () => {
    const trail = appendCustody(undefined, { at: 1, action: "filed" });
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("filed");
  });

  it("preserves order and appends newest last", () => {
    let trail = appendCustody(undefined, { at: 1, action: "filed" });
    trail = appendCustody(trail, { at: 2, action: "downloaded" });
    trail = appendCustody(trail, { at: 3, action: "note", note: "x" });
    expect(trail.map((e) => e.action)).toEqual(["filed", "downloaded", "note"]);
  });

  it("caps the trail, dropping the OLDEST events", () => {
    let trail: ReturnType<typeof appendCustody> = [];
    for (let i = 0; i < 250; i++) {
      trail = appendCustody(trail, { at: i, action: "note", note: String(i) });
    }
    expect(trail).toHaveLength(200);
    expect(trail[0].note).toBe("50"); // first 50 dropped
    expect(trail[199].note).toBe("249");
  });

  it("respects a custom cap", () => {
    let trail = appendCustody(undefined, { at: 1, action: "filed" }, 1);
    trail = appendCustody(trail, { at: 2, action: "note" }, 1);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("note");
  });
});

describe("custodyDay", () => {
  it("returns the IST day for a timestamp", () => {
    expect(custodyDay(new Date("2026-09-26T10:00:00+05:30").getTime())).toBe(
      "2026-09-26",
    );
    // 23:30 UTC = next day 05:00 IST
    expect(custodyDay(Date.UTC(2026, 8, 26, 23, 30))).toBe("2026-09-27");
  });
});
