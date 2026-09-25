import { describe, expect, it } from "vitest";
import {
  afterProviderResult,
  canApplyDeliveryEvent,
  canRetry,
  decideSend,
  DEFAULT_REQUIRES_APPROVAL,
  nextVersionOnEdit,
  requiresApprovalFor,
  sendableVersion,
  statusAfterEdit,
  type OutboxShape,
} from "./commOutboxFlow";

const approved = {
  status: "approved" as const,
  currentVersion: 2,
  approvedVersion: 2,
  requiresApproval: true,
  attempts: 0,
};

describe("category approval policy", () => {
  it("requires approval for legal/substantive categories by default", () => {
    expect(DEFAULT_REQUIRES_APPROVAL.hearing_update).toBe(true);
    expect(DEFAULT_REQUIRES_APPROVAL.deadline_reminder).toBe(true);
    expect(DEFAULT_REQUIRES_APPROVAL.matter_update).toBe(true);
    expect(DEFAULT_REQUIRES_APPROVAL.billing_notice).toBe(true);
  });

  it("does not require approval for administrative categories by default", () => {
    expect(DEFAULT_REQUIRES_APPROVAL.document_request).toBe(false);
    expect(DEFAULT_REQUIRES_APPROVAL.appointment).toBe(false);
    expect(DEFAULT_REQUIRES_APPROVAL.secure_message).toBe(false);
  });

  it("honours org overrides in both directions", () => {
    expect(requiresApprovalFor("appointment", true)).toBe(true);
    expect(requiresApprovalFor("hearing_update", false)).toBe(false);
    expect(requiresApprovalFor("hearing_update")).toBe(true);
  });
});

describe("approval gating (decideSend)", () => {
  it("allows an approved, current-version message", () => {
    expect(decideSend(approved)).toEqual({ ok: true, queue: true });
  });

  it("blocks an unapproved message", () => {
    expect(decideSend({ ...approved, approvedVersion: undefined }).ok).toBe(false);
  });

  it("blocks when the approved version is stale (edited after approval)", () => {
    const r = decideSend({ ...approved, currentVersion: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/edited after approval/);
  });

  it("never re-sends in-flight traffic (retry dedupe)", () => {
    for (const status of ["queued", "sent", "delivered", "read"] as const) {
      const r = decideSend({ ...approved, status });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/duplicate/i);
    }
  });

  it("never sends cancelled, rejected or returned messages", () => {
    for (const status of ["cancelled", "rejected", "returned"] as const) {
      expect(decideSend({ ...approved, status }).ok).toBe(false);
    }
  });

  it("skips the approval requirement for no-approval categories", () => {
    const noApproval: OutboxShape = {
      status: "draft",
      currentVersion: 1,
      requiresApproval: false,
      attempts: 0,
    };
    expect(decideSend(noApproval)).toEqual({ ok: true, queue: true });
  });

  it("retains approved messages whose provider was missing and allows re-queue", () => {
    const waiting: OutboxShape = { ...approved, status: "awaiting_configuration" };
    expect(decideSend(waiting)).toEqual({ ok: true, queue: true });
  });
});

describe("version integrity on edit", () => {
  it("bumps the version on every edit", () => {
    expect(nextVersionOnEdit(approved)).toBe(3);
  });

  it("returns an approval-required message to pending after an edit", () => {
    expect(statusAfterEdit(approved)).toBe("pending_approval");
  });

  it("keeps no-approval messages approved through edits", () => {
    expect(
      statusAfterEdit({ ...approved, requiresApproval: false }),
    ).toBe("approved");
  });

  it("only the approved-and-current version is sendable", () => {
    expect(sendableVersion(approved)).toBe(2);
    expect(sendableVersion({ ...approved, currentVersion: 3 })).toBeNull();
    expect(sendableVersion({ ...approved, approvedVersion: undefined })).toBeNull();
    expect(
      sendableVersion({
        status: "draft",
        currentVersion: 1,
        requiresApproval: false,
        attempts: 0,
      }),
    ).toBe(1);
  });
});

describe("provider results and retries", () => {
  it("marks sent with the provider message id", () => {
    const r = afterProviderResult(approved, {
      ok: true,
      providerMessageId: "abc",
    });
    expect(r.status).toBe("sent");
    expect(r.providerMessageId).toBe("abc");
  });

  it("retains approved messages as awaiting_configuration when the provider is missing", () => {
    const r = afterProviderResult(approved, {
      ok: false,
      reason: "Email sending is not configured.",
      providerMissing: true,
    });
    expect(r.status).toBe("awaiting_configuration");
    expect(r.lastError).toMatch(/not configured/);
  });

  it("marks hard failures as failed", () => {
    const r = afterProviderResult(approved, {
      ok: false,
      reason: "Provider rejected the request",
      providerMissing: false,
    });
    expect(r.status).toBe("failed");
  });

  it("allows retrying failed and awaiting-configuration messages only", () => {
    expect(canRetry({ ...approved, status: "failed" })).toBe(true);
    expect(canRetry({ ...approved, status: "awaiting_configuration" })).toBe(true);
    expect(canRetry({ ...approved, status: "sent" })).toBe(false);
    expect(canRetry({ ...approved, status: "cancelled" })).toBe(false);
  });
});

describe("delivery callbacks", () => {
  it("advances forward only", () => {
    expect(canApplyDeliveryEvent("queued", "sent")).toBe(true);
    expect(canApplyDeliveryEvent("sent", "delivered")).toBe(true);
    expect(canApplyDeliveryEvent("delivered", "read")).toBe(true);
  });

  it("never downgrades", () => {
    expect(canApplyDeliveryEvent("delivered", "sent")).toBe(false);
    expect(canApplyDeliveryEvent("read", "delivered")).toBe(false);
  });

  it("never resurrects failed or cancelled rows", () => {
    expect(canApplyDeliveryEvent("failed", "delivered")).toBe(false);
    expect(canApplyDeliveryEvent("cancelled", "read")).toBe(false);
  });

  it("ignores events for messages never queued", () => {
    expect(canApplyDeliveryEvent("draft", "sent")).toBe(false);
    expect(canApplyDeliveryEvent("approved", "delivered")).toBe(false);
  });
});
