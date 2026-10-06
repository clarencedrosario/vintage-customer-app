import { describe, expect, it } from "vitest";
import {
  MODEL_TIERS,
  STANDARD_MODEL_ID,
  ADVANCED_MODEL_ENV,
  availableTiers,
  resolveModelId,
} from "./aiModels";

// =====================================================================
// Model-tier honesty: a tier exists in the UI only when it maps to a
// real, configured model. These tests pin the registry and the
// resolution rules the runner applies.
// =====================================================================

describe("model registry", () => {
  it("pins the standard tier to the runner's long-standing model", () => {
    expect(STANDARD_MODEL_ID).toBe("gpt-4o-mini");
    expect(MODEL_TIERS.standard.modelId).toBe("gpt-4o-mini");
    expect(MODEL_TIERS.standard.provider).toBe("OpenAI");
    expect(MODEL_TIERS.standard.requires).toBe("OPENAI_API_KEY");
  });

  it("never hardcodes the advanced tier's model", () => {
    expect(MODEL_TIERS.advanced.modelId).toBe(null);
    expect(ADVANCED_MODEL_ENV).toBe("ADVOKATE_ADVANCED_MODEL");
    expect(MODEL_TIERS.advanced.requires).toBe("ADVOKATE_ADVANCED_MODEL");
  });
});

describe("availableTiers — what the UI may offer right now", () => {
  it("offers nothing when live AI is not configured", () => {
    expect(availableTiers(false, "any/model")).toEqual([]);
    expect(availableTiers(false, null)).toEqual([]);
  });

  it("offers only the standard tier until ADVOKATE_ADVANCED_MODEL names a model", () => {
    expect(availableTiers(true, null).map((t) => t.id)).toEqual(["standard"]);
    expect(availableTiers(true, "").map((t) => t.id)).toEqual(["standard"]);
    // Whitespace-only config is not a model.
    expect(availableTiers(true, "   ").map((t) => t.id)).toEqual(["standard"]);
  });

  it("offers both tiers when the advanced model is configured, trimming the value", () => {
    const tiers = availableTiers(true, "  openai/gpt-x-high  ");
    expect(tiers.map((t) => t.id)).toEqual(["standard", "advanced"]);
    expect(tiers[1]!.modelId).toBe("openai/gpt-x-high");
    expect(tiers[1]!.provider).toBe("OpenAI");
    // Labels are distinct so the selector never shows two "Standard"s.
    expect(tiers[0]!.label).not.toBe(tiers[1]!.label);
  });
});

describe("resolveModelId — what a job actually runs on", () => {
  it("fails closed when live AI is unconfigured, whatever tier was asked for", () => {
    const std = resolveModelId("standard", false, null);
    expect(std).toMatchObject({ ok: false });
    if (!std.ok) expect(std.error).toContain("OPENAI_API_KEY");

    const adv = resolveModelId("advanced", false, "openai/gpt-x-high");
    expect(adv).toMatchObject({ ok: false });
    if (!adv.ok) expect(adv.error).toContain("OPENAI_API_KEY");

    expect(resolveModelId(null, false, null).ok).toBe(false);
  });

  it("resolves the standard tier (and absent tiers) to the standard model", () => {
    expect(resolveModelId("standard", true, null)).toEqual({
      ok: true,
      modelId: "gpt-4o-mini",
      tier: "standard",
    });
    expect(resolveModelId(null, true, null)).toMatchObject({
      ok: true,
      modelId: "gpt-4o-mini",
      tier: "standard",
    });
    expect(resolveModelId(undefined, true, null)).toMatchObject({ ok: true, tier: "standard" });
  });

  it("runs the configured advanced model when asked and configured", () => {
    expect(resolveModelId("advanced", true, "  openai/gpt-x-high ")).toEqual({
      ok: true,
      modelId: "openai/gpt-x-high",
      tier: "advanced",
    });
  });

  it("refuses an advanced request with disclosure when the tier is not configured — no silent substitution", () => {
    for (const advancedModelId of [null, "", "   "]) {
      const r = resolveModelId("advanced", true, advancedModelId);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain("Advanced model tier is not configured");
        expect(r.error).toContain("ADVOKATE_ADVANCED_MODEL");
        expect(r.error).toContain("Retry on the Standard tier");
      }
    }
  });

  it("agrees with availableTiers: every offered tier resolves, none unoffered do", () => {
    const live = true;
    const advancedModelId = "openai/gpt-x-high";
    const tiers = availableTiers(live, advancedModelId);
    for (const t of tiers) {
      expect(resolveModelId(t.id as "standard" | "advanced", live, advancedModelId).ok).toBe(true);
    }
    // A tier that was never offered cannot be resolved either.
    expect(resolveModelId("advanced", live, null).ok).toBe(false);
  });
});
