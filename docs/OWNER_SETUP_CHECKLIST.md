# ADVOKATE — Owner Setup Checklist (commercial release)

**Never paste secret values into chat, tickets, or this document.** Secrets are
configured through the platform's **Keys / API keys** UI; backend code reads them
via `process.env` inside Convex functions only.

Two completely separate merchant identities exist in this release:

| Identity | Pays for | Credentials |
|---|---|---|
| **CJ GLOBAL** (platform) | ADVOKATE subscription charges (plans A–D) | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (platform account) |
| **The law firm** | Its own client invoices | Firm's own keys, connected in-app via Settings → merchant connect (stored encrypted, never in chat) |

Firm invoice money is collected **only** through the firm's own connected account
(test-enforced); the platform account never collects firm money. Keep the two
Razorpay dashboards separate and label them accordingly.

---

## 1. AI — OpenAI

| Item | Name (exact) | Where | Test / Production | Unlocks |
|---|---|---|---|---|
| Model API key | `OPENAI_API_KEY` | Keys / API keys UI → backend reads `process.env.OPENAI_API_KEY` (only reader: `aiRunner.ts`) | Start with a project **test key with an ENFORCED monthly spend limit** — set in the OpenAI project's billing USAGE LIMITS (a hard cap that DECLINES further paid usage; monthly reports/alert emails alone merely NOTIFY and do not stop spend) — proposal: US$5/month; execution awaits the owner's explicit spending approval. Note the app cannot enforce provider-side spend: on the deployment side `AI_RESERVE_ESTIMATE_TOKENS` governs job concurrency/reservations only, never money. Production: same key form, raise the cap only after bounded evaluation | Live AI everywhere: Case X-Ray, research, drafting, replies, briefings. The UI flips from honest "AI is not configured on this deployment" to live tiers |
| Advanced tier model id | `ADVOKATE_ADVANCED_MODEL` | Same Keys UI (a plain string, not a secret) | Test: leave unset — the Advanced tier must NOT appear. Production: set only when you have chosen and benchmarked the model (e.g. an OpenAI model id) | The Advanced tier option in `/ai` — offered **only** when this names a real model (plan permission alone never advertises it) |

Verification step unlocked: bounded real-AI checks (§5 of the release
checklist) — synthetic matter data, source-backed answers, unsupported-jurisdiction
refusal, drafting with missing facts.

## 2. Payments — Razorpay (CJ GLOBAL subscription account)

| Item | Name (exact) | Where | Test / Production | Unlocks |
|---|---|---|---|---|
| Key id | `RAZORPAY_KEY_ID` | Keys / API keys UI → server-side checkout + payment links | **Test mode first** (`rzp_test_…`). Switch to `rzp_live_…` keys only after the full test-mode pass below AND an explicit owner approval | `purchasingAvailable: true` on `/pricing`; checkout and renewal payment links |
| Key secret | `RAZORPAY_KEY_SECRET` | Keys / API keys UI | Test-mode secret first; live secret later (never in chat) | Signature-verified webhooks and provider calls |
| Webhook (test mode) | Dashboard → Settings → Webhooks → **`https://moonlit-elk-307.convex.site/webhooks/razorpay`** | Razorpay dashboard (NOT in-app) | Test mode: create on the test dashboard; event subscription: `payment.captured`, `payment_link.paid`, `order.paid`, `payment.failed`. When creating the webhook the dashboard asks for a **Webhook Secret** — generate one there and store the SAME value (by hand, never pasted into chat) as `RAZORPAY_WEBHOOK_SECRET` in the Keys UI | Automatic reconciliation: checkout → activation, renewal → period extension, idempotent duplicate handling. CORRECTED 7 Oct: HTTP actions serve the `.convex.site` origin (verified live: `.cloud` path returns 404, `.site` answers 503 "Webhook secret not configured." — also proving the secret is currently ABSENT) |
| Webhook (production) | Same `…convex.site` URL, created on the LIVE dashboard | Razorpay dashboard | Live mode: repeat the webhook creation on the live account before live keys are installed; set its own Webhook Secret and swap `RAZORPAY_WEBHOOK_SECRET` to that value at the same time (a mismatched secret silently breaks reconciliation) | Live-mode reconciliation |
| Encryption master key | `SECRET_ENCRYPTION_KEY` | Keys / API keys UI | Exact format (implementation `src/convex/crypto.ts` masterKey()): ANY string ≥ 32 characters after trimming — format otherwise free; generate with `openssl rand -base64 24` (32 chars) or `openssl rand -hex 32`. See the generation + no-casual-rotation rule below §2. Required for FIRM merchant credential encryption (see §3) | Firm in-app merchant connect (invoice payment links) — independent of platform keys |

Note: the deployment URL above is the current dev deployment
(moonlit-elk-307). HTTP actions (webhooks) serve the deployment's `…convex.site`
origin — verified 7 Oct: `…convex.cloud/webhooks/razorpay` returns 404 while
`https://moonlit-elk-307.convex.site/webhooks/razorpay` reaches the deployed
handler. If the production deployment differs, point the webhook at THAT
deployment's `…convex.site` `/webhooks/razorpay` path (platform account) —the firm webhook path is `/webhooks/razorpay/firm/<orgId>` (same `…convex.site`
origin) and is configured per-firm from the app, not by the platform owner.
**Firm webhook secret**: the optional secret a firm enters in-app at connect
must equal the **Webhook Secret** the FIRM sets on ITS OWN dashboard webhook;
platform and firm secrets are independent — the platform value never verifies
firm events, and a missing/mismatched firm secret fails signature verification.

**`SECRET_ENCRYPTION_KEY` — generation and the no-casual-rotation rule.**
GENERATION (only when the key does not exist yet): locally generate a random
string of at least 32 characters — e.g. `openssl rand -base64 24` or
`openssl rand -hex 32` — and paste it ONCE into the Keys UI; never reuse a
Razorpay secret or any other credential as this value, and never paste it into
chat. DO NOT casually replace an existing key: per-firm merchant credentials
are encrypted as `HKDF(master, salt "advokate-secret-enc-v1", info=<per-secret
context>) → AES-256-GCM` (`src/convex/crypto.ts`), and the stored blob carries
no key-version marker — a different master makes every previously stored firm
credential UNREADABLE (decryption refuses, connect flows fail, recovery
requires the OLD value). IF ROTATION IS EVER NEEDED: (1) record the existing
key safely; (2) have each firm disconnect its merchant account (or hand over
its own credentials via the firm exit workflow); (3) switch the master value
in the Keys UI; (4) have each firm reconnect under the new key; (5) verify one
test invoice payment link per firm. This release has no in-place
re-encryption tool — rotation is a coordinated, scheduled operation, never a
silent key swap.

## 3. Razorpay — the FIRM's own account (client invoices)

Configured in-app, by the firm owner (Settings → merchant connect) — **never**
in chat and never through the platform's keys:

| Item | Where | Notes |
|---|---|---|
| Firm key id + key secret | In-app connect form | Stored encrypted at rest (AES-GCM, row-bound context); the app displays only the last 4 of the key id |
| Firm webhook secret | In-app connect form (optional) | Firm webhooks verify against the FIRM's secret at `/webhooks/razorpay/firm/<orgId>`; tenant scope is enforced even with a valid signature |

The platform owner does nothing here except ensure `SECRET_ENCRYPTION_KEY`
exists. This separation is test-enforced ("refuses invoice payment links until
the firm connects its own account").

## 4. Platform administration (who can see the commercial console)

| Item | Name (exact) | Where | Purpose |
|---|---|---|---|
| Owner email | `PLATFORM_OWNER_EMAIL` | Keys / API keys UI (plain string) | `bootstrapAdmin` grants `isPlatformAdmin` to the **verified** user with exactly this email (fail-closed). That admin opens `/platform` to: create plans (PlanEditorDialog: prices, category A–D, AI allowance, billing unit, tax treatment), toggle plan availability, and triage enterprise enquiries |
| Admin bootstrap run | `internal/platform:bootstrapAdmin` | Run once (e.g. `npx convex run platform:bootstrapAdmin` style invocation, or via dashboard) after the owner account exists and is verified | Platform console access |

**Scope of platform ownership (verified turn 32, in-app):** `isPlatformAdmin`
commercially administers the SaaS (plans, subscriptions, enterprise enquiries,
microservice administration) — and it demonstrably does NOT read customer legal
records: matter/client/document access exists only through `exceptionalAccess`
per organization, granted with a written reason, time-boxed ≤ 7 days, audited,
and revocable (`platform.ts`; enforced in `access.ts` across all §32 modules;
destructive-path sweep in `docs/S32_INTERFACE_MAP.md`). History: an earlier
progress note mis-stated the exceptional-access key as the trigger for the
backup restore drill; the restore drill's key is its own distinct secret
(`docs/BACKUPS.md`) — corrected here for the record.

**Legal-intel owner-curation keys** (source discovery/review, not commercial):
- `manualReviewTokenLegacy` — legacy compatibility reader only; grants NO write
  capability. Owner review actions (`legalDiscoveryStore:promoteFromReview`
  / `rejectFromReview`) require an authenticated signed-in operator with the
  app's review capability — never this token.
- Discovery-listing registration (`discoveryListings.ts`) and the scheduled
  sweep/cron are deployment configuration, not per-user features.

**Pending owner decision — CARA agent-override (turn 32):** the jj-2015
connector sends a browser UA to a host whose WAF accepts browsers and 403s
other agent strings. Genuinely UNRESOLVED whether that is client-compatibility
or an intentional automation restriction. SCHEDULED refresh of jj-2015 is
deferred (`scheduledRefreshDeferred` in `sourceNotices.ts`); manual
operator-authorized import remains. Owner action: confirm the override stays
within "authorized access to a public document" (then clear the flag) —
or instruct removal of the notice + stored text.

## 5. Sequencing (what unlocks what)

1. `PLATFORM_OWNER_EMAIL` + bootstrap → **plan configuration** becomes possible.
   Until plans have prices > 0, every card honestly shows "Configuration
   pending" and nothing is purchasable — that is correct behaviour, not a bug.
2. Test-mode `RAZORPAY_KEY_ID/SECRET` (+ test webhook + matching `RAZORPAY_WEBHOOK_SECRET`) → **test-mode checkout**
   on `/pricing` (purchasingAvailable flips true) and the full payment
   lifecycle tests below.
3. `OPENAI_API_KEY` → bounded AI evaluation with synthetic data (independent
   of payments; can be done in either order).
4. `ADVOKATE_ADVANCED_MODEL` (only if the advanced tier is wanted) → advanced
   tier appears for advanced-tier plans.
5. Full test-mode pass (§6) → owner approval → live keys + live webhook →
   **production activation** (explicitly NOT performed by the agent).

## 6. Verification matrix each item unlocks (run in TEST MODE first)

| Flow | Provider state needed | Where to verify |
|---|---|---|
| Checkout → payment → subscription `active` + activation | Test keys + webhook | `/pricing` → Choose plan → pay link (test card/UPI) → `/billing` shows active; plan entitlements live on `/ai` |
| Duplicate webhook delivery applies exactly once | Test keys + webhook (redeliver the event from dashboard) | `subscriptionInvoices` rows don't duplicate; history single entry |
| Failed payment → `past_due`, honest AI pause | Test keys + webhook | Let a link expire / fail a test payment; `/billing` shows past_due with pay link; `/ai` shows the payment-outstanding banner; workspace intact |
| Manual renewal via payment link → period extension | Test keys + webhook | Pay the renewal link at period end; period end +1 interval; invoice row created |
| Cancellation → runs to period end → grace → read-only | None (no provider) | `/billing` cancel → history; time-advance (or expiry scan) → grace → read-only; export still available |
| Refund (requested → processed/failed) | Firm keys on the FIRM account | Client invoice refund flow in-app (money returns through the ORIGINAL capturing account) |
| AI live checks, bounded | `OPENAI_API_KEY` | `/ai` on a synthetic matter (see §5 of the release checklist) |

## Owner actions summary (exact)

1. Add `PLATFORM_OWNER_EMAIL` (your verified login email) in Keys UI; run the admin bootstrap once.
2. Sign in → `/platform` → Plans → New plan: create the monthly + yearly variants per category (same `planGroup`), set prices in ₹, AI allowance for B/C plans, leave Enterprise price 0.
3. Add test-mode `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`; create the test-mode webhook (URL + 4 events above) on the CJ GLOBAL test dashboard.
4. Add `OPENAI_API_KEY` (test project, spend-capped). Decide later about `ADVOKATE_ADVANCED_MODEL`.
5. Add `SECRET_ENCRYPTION_KEY` (32 random chars) so firms can connect their own accounts.
6. Run the test-mode verification matrix; record results.
7. Only then: owner-approved switch to live keys + live webhook. **Not performed by the agent; nothing live runs before that explicit approval.**
