import { describe, expect, it } from "vitest";
import {
  canApproveActivation,
  canRecordBreach,
  canSeeFirmRegister,
  canSubmitForApproval,
  canTransitionUndertaking,
  canVerifyDischarge,
  canWithdraw,
  canCorrectRecord,
  completionObjection,
  dueClass,
  dueStamp,
  escalationTier,
  makeCorrection,
  registerSummary,
  toFirmReportRow,
  type UndertakingRoles,
} from "./undertakingsFlow";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000; // fixed "today"

function roles(overrides: Partial<UndertakingRoles> = {}): UndertakingRoles {
  return {
    isResponsible: false,
    isSupervising: false,
    hasUndertakingsCapability: false,
    hasElevatedCapability: false,
    ...overrides,
  };
}

describe("lifecycle transitions", () => {
  it("draft can be submitted or withdrawn, nothing else", () => {
    expect(canTransitionUndertaking("draft", "pending_approval")).toBe(true);
    expect(canTransitionUndertaking("draft", "withdrawn")).toBe(true);
    expect(canTransitionUndertaking("draft", "active")).toBe(false);
    expect(canTransitionUndertaking("draft", "discharged")).toBe(false);
  });

  it("approval activates; rejection returns to draft", () => {
    expect(canTransitionUndertaking("pending_approval", "active")).toBe(true);
    expect(canTransitionUndertaking("pending_approval", "draft")).toBe(true);
    expect(canTransitionUndertaking("pending_approval", "discharged")).toBe(false);
  });

  it("active can complete, breach or withdraw — never delete-skip to discharged", () => {
    expect(canTransitionUndertaking("active", "completed_pending_verification")).toBe(true);
    expect(canTransitionUndertaking("active", "breached")).toBe(true);
    expect(canTransitionUndertaking("active", "withdrawn")).toBe(true);
    expect(canTransitionUndertaking("active", "discharged")).toBe(false);
  });

  it("verification discharges or finds breach", () => {
    expect(canTransitionUndertaking("completed_pending_verification", "discharged")).toBe(true);
    expect(canTransitionUndertaking("completed_pending_verification", "breached")).toBe(true);
    expect(canTransitionUndertaking("completed_pending_verification", "active")).toBe(false);
  });

  it("terminal states never transition", () => {
    for (const s of ["discharged", "withdrawn", "breached"] as const) {
      expect(canTransitionUndertaking(s, "active")).toBe(false);
      expect(canTransitionUndertaking(s, "draft")).toBe(false);
    }
  });
});

describe("permission rules", () => {
  it("responsible or any undertaking-capable lawyer may submit", () => {
    expect(canSubmitForApproval(roles({ isResponsible: true }))).toBe(true);
    expect(canSubmitForApproval(roles({ hasUndertakingsCapability: true }))).toBe(true);
    expect(canSubmitForApproval(roles({}))).toBe(false);
  });

  it("only the supervising lawyer or elevated role may activate", () => {
    expect(canApproveActivation(roles({ isSupervising: true }))).toBe(true);
    expect(canApproveActivation(roles({ hasElevatedCapability: true }))).toBe(true);
    expect(canApproveActivation(roles({ isResponsible: true }))).toBe(false);
    expect(canApproveActivation(roles({ hasUndertakingsCapability: true }))).toBe(false);
  });

  it("discharge verification follows the same gate as activation", () => {
    expect(canVerifyDischarge(roles({ isSupervising: true }))).toBe(true);
    expect(canVerifyDischarge(roles({ isResponsible: true }))).toBe(false);
  });

  it("breach records need supervision or elevation", () => {
    expect(canRecordBreach(roles({ isSupervising: true }))).toBe(true);
    expect(canRecordBreach(roles({ isResponsible: true }))).toBe(false);
  });

  it("corrections and withdrawals are open to the responsible lawyer and above", () => {
    expect(canCorrectRecord(roles({ isResponsible: true }))).toBe(true);
    expect(canCorrectRecord(roles({}))).toBe(false);
    expect(canWithdraw(roles({ isResponsible: true }))).toBe(true);
    expect(canWithdraw(roles({}))).toBe(false);
  });

  it("firm register visibility is capability-gated", () => {
    expect(canSeeFirmRegister(roles({ hasElevatedCapability: true }))).toBe(true);
    expect(canSeeFirmRegister(roles({ isSupervising: true }))).toBe(true);
    expect(canSeeFirmRegister(roles({}))).toBe(false);
  });
});

describe("due classification", () => {
  it("undated or non-active rows carry no deadline class", () => {
    expect(dueClass(undefined, NOW, true)).toBe("no_deadline");
    expect(dueClass(NOW + DAY, NOW, false)).toBe("no_deadline");
  });

  it("past-due active undertakings are overdue", () => {
    expect(dueClass(NOW - DAY, NOW, true)).toBe("overdue");
    expect(dueStamp("overdue", NOW - DAY, NOW)).toBe("1d overdue");
  });

  it("within seven days reads due soon", () => {
    expect(dueClass(NOW + 6 * DAY, NOW, true)).toBe("due_soon");
    expect(dueClass(NOW + 8 * DAY, NOW, true)).toBe("on_track");
    expect(dueStamp("due_soon", NOW + 6 * DAY, NOW)).toBe("due in 6d");
  });

  it("boundary: exactly seven days is due soon", () => {
    expect(dueClass(NOW + 7 * DAY, NOW, true)).toBe("due_soon");
  });
});

describe("escalation ladder", () => {
  it("non-active or undated undertakings never escalate", () => {
    expect(escalationTier("draft", NOW - 30 * DAY, NOW)).toBe(0);
    expect(escalationTier("active", undefined, NOW)).toBe(0);
    expect(escalationTier("discharged", NOW - 30 * DAY, NOW)).toBe(0);
  });

  it("tier rises with overdue depth and caps", () => {
    expect(escalationTier("active", NOW - 3 * DAY, NOW)).toBe(1);
    expect(escalationTier("active", NOW - 7 * DAY, NOW)).toBe(1);
    expect(escalationTier("active", NOW - 8 * DAY, NOW)).toBe(2);
    expect(escalationTier("active", NOW - 21 * DAY, NOW)).toBe(3);
    expect(escalationTier("active", NOW - 90 * DAY, NOW)).toBe(3);
  });

  it("awaiting-verification rows still escalate while overdue", () => {
    expect(escalationTier("completed_pending_verification", NOW - 10 * DAY, NOW)).toBe(2);
  });

  it("not-yet-due rows do not escalate", () => {
    expect(escalationTier("active", NOW + 5 * DAY, NOW)).toBe(0);
  });
});

describe("completion gate", () => {
  it("refuses discharge without evidence or explanation", () => {
    expect(completionObjection({ verificationRequired: true })).toMatch(/completion evidence/);
    expect(completionObjection({ evidenceNote: "   ", verificationRequired: true })).toMatch(/completion evidence/);
  });

  it("accepts a note or a document as evidence", () => {
    expect(completionObjection({ evidenceNote: "Original title deposited with registrar.", verificationRequired: true })).toBeNull();
    expect(completionObjection({ documentId: "doc_1", verificationRequired: false })).toBeNull();
  });
});

describe("corrections preserve history", () => {
  it("requires a reason", () => {
    const r = makeCorrection({
      byId: "u1",
      byName: "A",
      reason: "  ",
      field: "text",
      previous: "a",
      next: "b",
    });
    expect("error" in r && r.error).toMatch(/reason is required/);
  });

  it("refuses no-op corrections", () => {
    const r = makeCorrection({
      byId: "u1",
      byName: "A",
      reason: "typo",
      field: "text",
      previous: "same",
      next: "same",
    });
    expect("error" in r && r.error).toMatch(/not a change/);
  });

  it("records a trimmed, complete entry", () => {
    const r = makeCorrection({
      byId: "u1",
      byName: "A",
      reason: " typo fix ",
      field: "text",
      previous: "old text",
      next: "new text",
      at: 123,
    });
    expect(r).toEqual({
      at: 123,
      byId: "u1",
      byName: "A",
      reason: "typo fix",
      field: "text",
      previous: "old text",
      next: "new text",
    });
  });
});

describe("firm-level reporting strips confidential detail", () => {
  const row = {
    id: "u1",
    matterReference: "ADV/2026/0042",
    matterTitle: "Secret matter",
    clientName: "Confidential Client",
    direction: "given" as const,
    status: "active" as const,
    dueAt: NOW + DAY,
    textPreview: "File the original agreement…",
    isConfidential: true,
  };

  it("viewers see everything", () => {
    const out = toFirmReportRow(row, true, NOW);
    expect(out.confidential).toBe(false);
    expect(out.textPreview).toBe(row.textPreview);
  });

  it("non-viewers get an indicator without client names or text", () => {
    const out = toFirmReportRow(row, false, NOW);
    expect(out.confidential).toBe(true);
    expect(out.textPreview).toBe("");
    expect(out).not.toHaveProperty("clientName");
    expect(out).not.toHaveProperty("matterTitle");
    expect(out.matterReference).toBe("ADV/2026/0042");
    expect(out.status).toBe("active");
    expect(out.dueClass).toBe("due_soon");
  });
});

describe("register summary", () => {
  it("counts each bucket exactly once", () => {
    const s = registerSummary(
      [
        { status: "active", dueAt: NOW + DAY },
        { status: "active", dueAt: NOW - DAY },
        { status: "active", dueAt: undefined },
        { status: "pending_approval", dueAt: undefined },
        { status: "completed_pending_verification", dueAt: NOW + 2 * DAY },
        { status: "breached", dueAt: NOW - 5 * DAY },
        { status: "discharged", dueAt: NOW - 5 * DAY },
        { status: "active", dueAt: NOW + 3 * DAY },
      ],
      NOW,
    );
    expect(s).toEqual({
      active: 4,
      dueSoon: 2,
      overdue: 1,
      pendingVerification: 1,
      pendingApproval: 1,
      breached: 1,
    });
  });
});
