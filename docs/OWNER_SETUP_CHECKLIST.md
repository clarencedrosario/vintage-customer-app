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
| Model API key | `OPENAI_API_KEY` | Keys / API keys UI → backend reads `process.env.OPENAI_API_KEY` (only reader: `aiRunner.ts`) | Start with a project **test key with a hard monthly spend limit** (e.g. $5–10). Production: same key form, raise the cap only after bounded evaluation | Live AI everywhere: Case X-Ray, research, drafting, replies, briefings. The UI flips from honest "AI is not configured on this deployment" to live tiers |
| Advanced tier model id | `ADVOKATE_ADVANCED_MODEL` | Same Keys UI (a plain string, not a secret) | Test: leave unset — the Advanced tier must NOT appear. Production: set only when you have chosen and benchmarked the model (e.g. an OpenAI model id) | The Advanced tier option in `/ai` — offered **only** when this names a real model (plan permission alone never advertises it) |

Verification step unlocked: bounded real-AI checks (§5 of the release
checklist) — synthetic matter data, source-backed answers, unsupported-jurisdiction
refusal, drafting with missing facts.

## 2. Payments — Razorpay (CJ GLOBAL subscription account)

| Item | Name (exact) | Where | Test / Production | Unlocks |
|---|---|---|---|---|
| Key id | `RAZORPAY_KEY_ID` | Keys / API keys UI → server-side checkout + payment links | **Test mode first** (`rzp_test_…`). Switch to `rzp_live_…` keys only after the full test-mode pass below AND an explicit owner approval | `purchasingAvailable: true` on `/pricing`; checkout and renewal payment links |
| Key secret | `RAZORPAY_KEY_SECRET` | Keys / API keys UI | Test-mode secret first; live secret later (never in chat) | Signature-verified webhooks and provider calls |
| Webhook (test mode) | Dashboard → Settings → Webhooks → **`https://moonlit-elk-307.convex.cloud/webhooks/razorpay`** | Razorpay dashboard (NOT in-app) | Test mode: create on the test dashboard; event subscription: `payment.captured`, `payment_link.paid`, `order.paid`, `payment.failed` | Automatic reconciliation: checkout → activation, renewal → period extension, idempotent duplicate handling |
| Webhook (production) | Same URL, created on the LIVE dashboard | Razorpay dashboard | Live mode: repeat the webhook creation on the live account before live keys are installed | Live-mode reconciliation |
| Encryption master key | `SECRET_ENCRYPTION_KEY` | Keys / API keys UI | A 32-char random string; required for FIRM merchant credential encryption (see §3) | Firm in-app merchant connect (invoice payment links) — independent of platform keys |

Note: the deployment URL above is the current dev deployment
(moonlit-elk-307). If the production deployment differs, the webhook URL must
point at that deployment's `…/webhooks/razorpay` path (platform account) — the
firm webhook path is `/webhooks/razorpay/firm/<orgId>` and is configured
per-firm from the app, not by the platform owner.

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

## 5. Sequencing (what unlocks what)

1. `PLATFORM_OWNER_EMAIL` + bootstrap → **plan configuration** becomes possible.
   Until plans have prices > 0, every card honestly shows "Configuration
   pending" and nothing is purchasable — that is correct behaviour, not a bug.
2. Test-mode `RAZORPAY_KEY_ID/SECRET` (+ test webhook) → **test-mode checkout**
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
