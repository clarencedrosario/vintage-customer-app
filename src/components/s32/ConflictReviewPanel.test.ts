// §32 Phase 1 UI — the panel's decision surface must mirror the backend
// `conflictReview.act` action union EXACTLY. If a literal is added or
// renamed server-side, this test fails and forces the UI to follow
// (labels/status mapping drift is a concrete risk, not vanity coverage).
import { describe, expect, it } from "vitest";
import {
  ACTION_OPTIONS,
  STATUS_LABELS,
} from "@/components/s32/ConflictReviewPanel";

const BACKEND_ACT_LITERALS = [
  "confirm_conflict",
  "dismiss_different_events",
  "dismiss_other_reason",
  "mark_unresolved",
  "accept_interpretation",
] as const;

const BACKEND_TO_STATUS: Record<string, string> = {
  confirm_conflict: "confirmed_conflict",
  dismiss_different_events: "dismissed_different_events",
  dismiss_other_reason: "dismissed_other_reason",
  mark_unresolved: "unresolved",
  accept_interpretation: "accepted_interpretation",
};

describe("§32 conflict review — UI decision surface", () => {
  it("offers exactly the backend's five act literals, in order", () => {
    expect(ACTION_OPTIONS.map((o) => o.key)).toEqual([...BACKEND_ACT_LITERALS]);
  });

  it("maps every action literal to the backend's resulting status", () => {
    for (const o of ACTION_OPTIONS) {
      expect(BACKEND_TO_STATUS[o.key]).toBe(o.status);
      // Every outcome label the panel can show must exist for both the
      // action result and the review-list statuses.
      expect(STATUS_LABELS[o.status]).toBeTruthy();
    }
  });

  it("labels every status the review list can return", () => {
    for (const s of [
      "open",
      "reassessment_flagged",
      ...BACKEND_ACT_LITERALS.map((a) => BACKEND_TO_STATUS[a]!),
    ]) {
      expect(STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("gives every option a distinct human label and hint", () => {
    const labels = ACTION_OPTIONS.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const o of ACTION_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });
});
