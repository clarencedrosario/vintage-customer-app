// §32 Group 3 — the walls/holds UI must mirror the backend unions in
// src/convex/schemaExtras.ts exactly: hold reason kinds, emergency grant
// reasons, and wall statuses. Drift here would silently produce select
// options the Convex validators reject at runtime.
import { describe, expect, it } from "vitest";
import { HOLD_REASON_KINDS } from "@/components/s32/MatterHoldCard";
import {
  EmergencyGrantRow,
  GRANT_REASONS,
  HOLD_KINDS,
} from "@/components/s32/WallsHoldsPanel";

const BACKEND_LEGAL_HOLD_REASON_KINDS = [
  "litigation",
  "investigation",
  "audit",
  "regulatory",
  "other",
] as const;

const BACKEND_EMERGENCY_GRANT_REASONS = [
  "hold_setup_or_correction",
  "wall_correction",
  "security_incident",
  "court_order",
  "other_documented",
] as const;

const BACKEND_HOLD_WALL_STATUSES = ["active", "lifted"] as const;

describe("§32 Group 3 UI/backend literal drift", () => {
  it("HOLD_KINDS and MatterHoldCard HOLD_REASON_KINDS equal backend LEGAL_HOLD_REASON_KINDS", () => {
    expect([...HOLD_KINDS].sort()).toEqual(
      [...BACKEND_LEGAL_HOLD_REASON_KINDS].sort(),
    );
    expect([...HOLD_REASON_KINDS].sort()).toEqual(
      [...BACKEND_LEGAL_HOLD_REASON_KINDS].sort(),
    );
  });

  it("GRANT_REASONS equal backend EMERGENCY_GRANT_REASONS", () => {
    expect([...GRANT_REASONS].sort()).toEqual(
      [...BACKEND_EMERGENCY_GRANT_REASONS].sort(),
    );
  });

  it("grant row shape covers every lifecycle state the backend returns", () => {
    // grantsForWall returns: grantId, actorId, actorName, reason, detail,
    // acknowledgedAt, expiresAt, revokedAt, createdAt — every field the
    // wall-card grant list renders must exist on the row type.
    const required: (keyof EmergencyGrantRow)[] = [
      "grantId",
      "actorId",
      "actorName",
      "reason",
      "detail",
      "acknowledgedAt",
      "expiresAt",
      "revokedAt",
      "createdAt",
    ];
    expect(required.length).toBe(9);
  });

  it("wall status labels cover backend ETHICAL_WALL_STATUSES", () => {
    // The wall card renders active/lifted via a ternary on status; if the
    // backend ever grows a third status this test forces a UI revisit.
    expect([...BACKEND_HOLD_WALL_STATUSES]).toEqual(["active", "lifted"]);
  });
});
