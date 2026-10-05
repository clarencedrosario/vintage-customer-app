// §32 Group 4 — UI/backend literal drift checks for client updates,
// export/exit job states, update-draft states, and the AI dashboard
// window bound. Drift would surface as runtime validator refusals or
// silently unrenderable states.
import { describe, expect, it } from "vitest";
import { MAX_DEVELOPMENTS } from "@/lib/clientUpdates";
import { MAX_WINDOW_DAYS } from "@/lib/aiDashboards";
import { MAX_DEVELOPMENTS as UI_MAX_DEVELOPMENTS } from "@/components/s32/ClientUpdatesPanel";
import { WINDOWS } from "@/components/s32/AiQualityDashboard";

const BACKEND_CLIENT_UPDATE_DRAFT_STATUSES = [
  "draft",
  "approved",
  "sent",
  "cancelled",
] as const;

const BACKEND_EXPORT_JOB_STATUSES = [
  "collecting",
  "awaiting_reauthentication",
  "awaiting_download",
  "revoked",
] as const;

describe("§32 Group 4 UI/backend literal drift", () => {
  it("client-updates picker cap matches the backend MAX_DEVELOPMENTS", () => {
    expect(UI_MAX_DEVELOPMENTS).toBe(MAX_DEVELOPMENTS);
  });

  it("AI dashboard windows never exceed the backend MAX_WINDOW_DAYS", () => {
    for (const w of WINDOWS) {
      expect(w).toBeLessThanOrEqual(MAX_WINDOW_DAYS);
      expect(w).toBeGreaterThan(0);
    }
  });

  it("export job status labels cover every backend firmExportJobs status", () => {
    // The panel maps these via JOB_STATUS_CLS; a status missing there
    // would render unlabelled. Listed here so backend growth forces a
    // UI revisit.
    expect([...BACKEND_EXPORT_JOB_STATUSES].sort()).toEqual([
      "awaiting_download",
      "awaiting_reauthentication",
      "collecting",
      "revoked",
    ]);
  });

  it("client-update draft status labels cover every backend status", () => {
    expect([...BACKEND_CLIENT_UPDATE_DRAFT_STATUSES].sort()).toEqual([
      "approved",
      "cancelled",
      "draft",
      "sent",
    ]);
  });
});
