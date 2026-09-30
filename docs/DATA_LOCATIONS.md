# DATA_LOCATIONS.md — Where Advokate Data Actually Travels and Resides

**Owner:** CJ GLOBAL (Advokate)
**Last updated:** 30 Sep 2026 (turn 15)
**Companion to:** `docs/DPDP_REVIEW.md` and the in-product inventory
(`dataResidency.seedInventory` / `listInventory`).

**Status: an inventory, not a residency guarantee.** Every region below is
`unverified` until an operator verifies it in the provider's own console; the
in-product `verifyRegion` mutation is the only path that marks a service
verified.

---

## 1. Inventory (actual stack, turn 15)

| Service | Data category | Provider | Region | Verified | Notes |
| --- | --- | --- | --- | --- | --- |
| primary_database | All application records (matters, clients, facts, drafts, registers) | Convex managed cloud (deployment `moonlit-elk-307`) | unverified | No | Verify from the Convex dashboard before claiming any region |
| document_storage | Original documents + derived files | Convex file storage (same deployment) | unverified | No | Follows the deployment region |
| backups | Platform-managed snapshots | Convex managed cloud | unverified | No | Backup geography not separately verified |
| search_indexes | Full-text indexes over firm data | Convex (in-deployment) | unverified | No | |
| embeddings | Vector indexes over firm data | Convex vector index (in-deployment) | unverified | No | No external vector store |
| ai_processing | Prompts + matter context for model processing | **None active** (OPENAI_API_KEY not configured) | n/a | No | Live-model path is gated off; MUST be re-assessed before any model API is enabled |
| logs_diagnostics | Application logs and diagnostics | Platform logging | unverified | No | Support access follows PERMISSIONS.md restricted diagnostics |
| email_notifications | Transactional email | Provider per deployment config | unverified | No | Operator records provider/region when email is configured |
| payments | Merchant credentials (AES-256-GCM encrypted) + payment identifiers | Razorpay (when configured) | unverified | No | Card data never stored by Advokate |
| support_access | Operator support sessions | CJ GLOBAL (restricted, audited) | unverified | No | |

## 2. Isolation architecture (accurate description)

- **Logical tenant isolation only.** All firms share infrastructure; every
  query/mutation resolves the caller's session and filters by `orgId`, with
  matter-level and document-level rules layered on. This is under automated
  test across many suites.
- It is **not** a dedicated database or physically separate storage, and must
  never be advertised as such. Stronger dedicated isolation is offered only if
  actually implemented and verified (it is not, today).
- Architecture alone does not guarantee legal privilege; privilege derives
  from law and professional conduct, not from our storage topology.

## 3. Residency policy modes

- **`record_only` (default)** — inventory and flagging only. No residency
  commitment exists, and none may be advertised, because nothing above is
  verified in-region.
- **`restrict_in`** — used ONLY when a law, contract, or customer policy
  actually requires India-only processing. It blocks processing in any
  service not verified in-region (`assertProcessingAllowed` internal gate)
  and logs every refused attempt (`residencyBlocks`) instead of silently
  transferring data elsewhere. Enable it only after verifying the relevant
  services' regions — enabling it with an unverified inventory blocks all
  restricted processing (which is the honest failure mode).

## 4. Rules for claims

1. Never advertise data residency the hosting stack cannot guarantee.
2. Verify **every relevant service** — not just the primary database — before
   any India-only processing commitment; flag incompatible services.
3. Migration or paid-service activation (model APIs, external email, storage
   changes) requires explicit approval and a re-verified inventory row for the
   affected service.
4. Re-check this file whenever providers, regions, or data categories change.
