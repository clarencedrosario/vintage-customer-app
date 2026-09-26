import { describe, expect, it } from "vitest";
import {
  BRIEFING_EMAIL_CAP,
  emailDigestForBriefing,
  istDayWindow,
} from "./ai";

// IST is a fixed UTC+5:30 offset. A helper: epoch ms for an IST wall time.
const ist = (iso: string) => Date.parse(`${iso}+05:30`);

describe("istDayWindow", () => {
  it("returns the full IST day for offset 0 (today)", () => {
    const noon = ist("2026-09-25T12:00:00");
    const w = istDayWindow(noon, 0);
    expect(w.start).toBe(ist("2026-09-25T00:00:00"));
    expect(w.end).toBe(ist("2026-09-26T00:00:00"));
    expect(w.end - w.start).toBe(86_400_000);
  });

  it("returns yesterday for offset 1", () => {
    const morning = ist("2026-09-25T07:15:00");
    const w = istDayWindow(morning, 1);
    expect(w.start).toBe(ist("2026-09-24T00:00:00"));
    expect(w.end).toBe(ist("2026-09-25T00:00:00"));
  });

  it("rolls the month and year back correctly", () => {
    const firstDay = ist("2026-01-01T00:30:00");
    const w = istDayWindow(firstDay, 1);
    expect(w.start).toBe(ist("2025-12-31T00:00:00"));
    expect(w.end).toBe(ist("2026-01-01T00:00:00"));
  });

  it("classifies emails inside vs outside the yesterday window", () => {
    const now = ist("2026-09-25T09:00:00");
    const w = istDayWindow(now, 1);
    const filedYesterday23 = ist("2026-09-24T23:59:00");
    const filedTodayEarly = ist("2026-09-25T00:00:00");
    const filedDayBefore = ist("2026-09-23T18:00:00");
    const inWindow =
      filedYesterday23 >= w.start && filedYesterday23 < w.end;
    const todayExcluded =
      filedTodayEarly >= w.start && filedTodayEarly < w.end;
    const olderExcluded =
      filedDayBefore >= w.start && filedDayBefore < w.end;
    expect(inWindow).toBe(true);
    expect(todayExcluded).toBe(false);
    expect(olderExcluded).toBe(false);
  });

  it("handles a request made just after IST midnight (yesterday = the day before)", () => {
    // 00:05 IST on the 25th → yesterday is the 24th, NOT today.
    const justAfterMidnight = ist("2026-09-25T00:05:00");
    const w = istDayWindow(justAfterMidnight, 1);
    expect(w.start).toBe(ist("2026-09-24T00:00:00"));
  });
});

describe("emailDigestForBriefing", () => {
  const base = {
    messageId: "m1",
    matterId: "mat1",
    matterReference: "ADV/2026/0001",
    fromAddress: "client@example.com",
    subject: "Certified copy",
    receivedAt: ist("2026-09-24T15:30:00"),
    body: "Please arrange the certified copy of the order.",
  };

  it("returns null when there are no emails", () => {
    expect(emailDigestForBriefing([])).toBeNull();
  });

  it("formats each email with matter, sender, time and subject", () => {
    const digest = emailDigestForBriefing([base])!;
    expect(digest).toContain("matter ADV/2026/0001");
    expect(digest).toContain("From: client@example.com");
    expect(digest).toContain("Subject: Certified copy");
    expect(digest).toContain("Please arrange the certified copy");
    expect(digest).toMatch(/IST/);
  });

  it("sorts newest first regardless of input order", () => {
    const newer = {
      ...base,
      messageId: "m2",
      receivedAt: ist("2026-09-24T20:00:00"),
      subject: "Later email",
    };
    const digest = emailDigestForBriefing([base, newer])!;
    expect(digest.indexOf("Later email")).toBeLessThan(
      digest.indexOf("Certified copy"),
    );
  });

  it("caps the digest at BRIEFING_EMAIL_CAP emails", () => {
    const rows = Array.from({ length: BRIEFING_EMAIL_CAP + 5 }, (_, i) => ({
      ...base,
      messageId: `m${i}`,
      receivedAt: base.receivedAt + i * 60_000,
      subject: `Email ${i}`,
    }));
    const digest = emailDigestForBriefing(rows)!;
    // The five oldest (Email 0..4) must be dropped; the newest kept.
    expect(digest).not.toContain("Email 0\n");
    expect(digest).toContain(`Email ${BRIEFING_EMAIL_CAP + 4}`);
    expect(digest.match(/\[1\] EMAIL/g)?.length).toBe(1);
  });

  it("truncates long bodies with an explicit marker", () => {
    const long = {
      ...base,
      body: "x".repeat(5_000),
    };
    const digest = emailDigestForBriefing([long])!;
    expect(digest).toContain("[truncated]");
    expect(digest.length).toBeLessThan(5_000);
  });

  it("marks the digest items as numbered EMAIL citations", () => {
    const digest = emailDigestForBriefing([base, { ...base, messageId: "m2" }])!;
    expect(digest).toContain("[1] EMAIL");
    expect(digest).toContain("[2] EMAIL");
  });
});
