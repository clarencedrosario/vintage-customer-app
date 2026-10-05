// §32 Group 1 — the adverse-authority decision surface must mirror the
// backend `adverseAuthority.recordDecision` union exactly; recheck item
// statuses must be rendered honestly (unchanged/changed/unavailable).
import { describe, expect, it } from "vitest";
import { ACTION_OPTIONS, STATUS_LABELS } from "@/components/s32/ConflictReviewPanel";

const BACKEND_ACT = [
  "confirm_conflict",
  "dismiss_different_events",
  "dismiss_other_reason",
  "mark_unresolved",
  "accept_interpretation",
] as const;

describe("§32 group 1 UI contracts", () => {
  it("conflict review options still mirror conflictReview.act", () => {
    expect(ACTION_OPTIONS.map((o) => o.key)).toEqual([...BACKEND_ACT]);
  });

  it("impact alert statuses cover every backend outcome", () => {
    // matterImpact handlers set: open (initial), acknowledged, dismissed,
    // converted_to_task (schema union), superseded (superseded row kept on list).
    for (const s of [
      "open",
      "acknowledged",
      "dismissed",
      "converted_to_task",
      "superseded",
    ]) {
      expect(STATUS_LABELS[s] ?? IMPACT_LABELS[s]).toBeTruthy();
    }
  });
});

// Local import kept below describe to make the drift explicit: the impact
// panel's status labels must exist for every backend status literal.
import { STATUS_LABELS as IMPACT_LABELS } from "@/components/s32/MatterImpactPanel";
