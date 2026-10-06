// =====================================================================
// AI model registry — the ONLY place model identifiers are defined.
//
// HONESTY RULE (commercial release, requirement 3): a tier is offered in
// the UI ONLY when it is mapped to a real, configured model. We never
// invent model availability and never silently substitute a provider
// contrary to the firm's data-handling configuration.
//
//   standard — OpenAI gpt-4o-mini, the model the runner has always used
//              (aiRunner.ts MODEL). Available when OPENAI_API_KEY is set.
//   advanced — NOT a product promise: it maps to the operator-configured
//              ADVOKATE_ADVANCED_MODEL environment variable. Until that
//              variable names a real model, the Advanced tier does not
//              exist for anyone and is not advertised as available.
//
// AI access is provided through ADVOKATE's subscription; it does NOT
// include a separate consumer AI-service subscription. (Disclosed on
// pricing and subscription surfaces.)
// =====================================================================

export type ModelTierId = "standard" | "advanced";

export type ModelTierInfo = {
  id: ModelTierId;
  label: string;
  modelId: string | null;
  provider: string;
  /** What must be configured for this tier to exist. */
  requires: string;
};

export const STANDARD_MODEL_ID = "gpt-4o-mini";
export const ADVANCED_MODEL_ENV = "ADVOKATE_ADVANCED_MODEL";

/** The registry: advanced is null until an operator maps a real model. */
export const MODEL_TIERS: Record<"standard", ModelTierInfo> & {
  advanced: ModelTierInfo;
} = {
  standard: {
    id: "standard",
    label: "Standard",
    modelId: STANDARD_MODEL_ID,
    provider: "OpenAI",
    requires: "OPENAI_API_KEY",
  },
  advanced: {
    id: "advanced",
    label: "Advanced",
    modelId: null, // set from ADVOKATE_ADVANCED_MODEL at runtime — never hardcoded
    provider: "OpenAI",
    requires: ADVANCED_MODEL_ENV,
  },
};

/**
 * Tiers that genuinely exist right now. `liveConfigured` reflects
 * OPENAI_API_KEY presence; `advancedModelId` is the operator's configured
 * advanced model (or null). Never returns a tier whose mapping is null.
 */
export function availableTiers(
  liveConfigured: boolean,
  advancedModelId: string | null,
): ModelTierInfo[] {
  const tiers: ModelTierInfo[] = [];
  if (liveConfigured) tiers.push({ ...MODEL_TIERS.standard });
  if (liveConfigured && advancedModelId && advancedModelId.trim().length > 0) {
    tiers.push({ ...MODEL_TIERS.advanced, modelId: advancedModelId.trim() });
  }
  return tiers;
}

/** Resolve a job's requested tier to the model id actually used. */
export function resolveModelId(
  requestedTier: ModelTierId | null | undefined,
  liveConfigured: boolean,
  advancedModelId: string | null,
): { ok: true; modelId: string; tier: ModelTierId } | { ok: false; error: string } {
  if (!liveConfigured) {
    return { ok: false, error: "Live AI is not configured on this deployment (OPENAI_API_KEY missing)." };
  }
  if (requestedTier === "advanced") {
    if (advancedModelId && advancedModelId.trim().length > 0) {
      return { ok: true, modelId: advancedModelId.trim(), tier: "advanced" };
    }
    // Honest fallback: the requested tier is not configured — say so and
    // run nothing silently substituted WITHOUT disclosure.
    return {
      ok: false,
      error:
        "The Advanced model tier is not configured on this deployment (ADVOKATE_ADVANCED_MODEL missing), so that request cannot run as asked. Retry on the Standard tier.",
    };
  }
  return { ok: true, modelId: STANDARD_MODEL_ID, tier: "standard" };
}
