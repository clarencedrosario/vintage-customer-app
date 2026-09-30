# Razorpay setup — evidence tiers, merchant ownership, keys, verification

Status: **Code complete and fixture-tested (30 Sep 2026); real provider
execution NOT yet verified — test-mode keys are absent.** Every payment
action degrades honestly until keys exist: "Online payments are not
configured yet — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Manual
payment recording stays available." Opening a link or scanning a QR never
marks anything paid; only a signature-verified webhook reconciles money.

---

## 0. Evidence tiers — what is and is not verified

Do not describe this integration as "fully verified end-to-end" until
tiers 2–4 below have actually run. Current honest state:

| Tier | What it covers | Status |
| --- | --- | --- |
| 1. Automated fixture tests | 19 Convex-backend tests in `src/convex/payments.test.ts`: signature rejection, honest 503, reconciliation, same-event-id redelivery, **three event types naming one payment → exactly one record/allocation/journal**, out-of-order arrival, tampered link reference refused, wrong currency refused, capped allocation with tracked excess credit, SaaS renewal deduped across event types, non-money events log-only, full refund lifecycle (requested → processed with books moving only on provider confirmation; provider rejection → `failed` with nothing moved; over-refund refused), **firm collection with NO platform keys present**, **rotation vs different-account semantics + refund through the ORIGINAL capturing account (asserted on the outbound call)**, secret-crypto round-trip/tamper/context-binding. Full suite: 32 files / 525 tests green. | ✅ Done (synthetic data only) |
| 2. Real Razorpay **test-mode** API + webhook | Create a real `rzp_test_…` payment link, receive a real signed webhook at the deployment URL, verify tenant/invoice reconciliation and duplicate-event handling against live payloads, then a real test-mode refund. | ⛔ Blocked — keys absent |
| 3. Browser checkout | Open the hosted link in a browser, complete checkout with Razorpay's test instruments, observe the state changes. | ⛔ Blocked — browser automation unavailable in this environment (see `docs/BROWSER_VERIFICATION.md`, 15 pending steps) |
| 4. Live operation | Live-mode keys, real customers, real money. | ⛔ Not attempted — deliberately out of scope |

**Checkout methods note:** the only collection mechanism implemented is
the Razorpay **payment link** (UPI QR + whatever methods the merchant
account has enabled — card/netbanking/wallet appear per the merchant's
dashboard settings, not per this codebase). No checkout.js integration,
no Razorpay Subscriptions/recurring mandates, and no Route/split payouts
are implemented. Do not claim other methods are available until they are
built and verified.

---

## 1. Merchant ownership — DECIDED (30 Sep 2026), enforcement in code

**Owner decision:** firm money collects through **per-firm merchant
accounts**; CJ GLOBAL's platform account collects only CJ GLOBAL's own
revenue. Enforced in code, not just documented:

| Money flow | Pays to | How enforced |
| --- | --- | --- |
| CJ GLOBAL software subscriptions (section 24) | CJ GLOBAL (deployment keys) | subscription checkout actions use deployment credentials only |
| Promotion purchases (section 23) | CJ GLOBAL (deployment keys) | `createPromotionPaymentLink` uses deployment credentials; the buyer org is identified in notes, never used as merchant |
| Law-firm invoice payments | **The firm's own account** | `createPaymentLink` refuses to run unless the firm has an active `orgMerchants` connection; the link is created with the firm's decrypted credentials |
| Consultation fees | **The firm's own account** | same gate in `createConsultation` |

Mechanics: `orgMerchants` table stores the firm's key id + secret
(encrypted at rest — `encryptSecret` under the platform's
`RAZORPAY_KEY_SECRET` as master key; secrets are never returned to any
client after being set, only ever decrypted server-side inside the Node
action that talks to Razorpay). Connect/rotate/disable lives in Billing →
Payment account (test-mode keys only; live connections are a separate
explicit step). Firm webhooks are verified against the FIRM's own
webhook secret at `POST /webhooks/razorpay/firm/<orgId>` and the
reconciler additionally refuses any event whose target belongs to a
different org (logged as a reconciliation exception). The platform
webhook secret can never verify a firm event and vice versa. Refunds
run on whichever merchant account captured the money; a refund whose
firm account has since been disconnected fails honestly (`failed`,
nothing moved) instead of hanging in `requested`.

---

## 1b. Historical framing (superseded by the decision above)

The original open question, kept for the record:

With the current single-set-of-keys design, **one Razorpay account (CJ
GLOBAL's) receives every rupee**, because `RAZORPAY_KEY_ID`/`SECRET` are
deployment-wide and all four flows create payment links on that account:

| Money flow | Who pays | Lands in whose account today | Unresolved question |
| --- | --- | --- | --- |
| CJ GLOBAL software subscriptions (section 24) | Law firms / lawyers to CJ GLOBAL | CJ GLOBAL's Razorpay account | ✅ Correct — this is CJ GLOBAL's own revenue |
| Promotion purchases (section 23) | Firms buying visibility | CJ GLOBAL's Razorpay account | Probably correct (CJ GLOBAL sells the promo), but confirm |
| Law-firm invoice payments (Billing module) | Firms' clients | **CJ GLOBAL's Razorpay account** | ❌ **This is the firms' own professional-fee revenue** — collecting it through CJ GLOBAL's account is client-money commingling by CJ GLOBAL and creates settlement/tax/refund liabilities for a party that is not the firm's counterparty |
| Consultation fees | Clients booking lawyers | **CJ GLOBAL's Razorpay account** | ❌ Same problem — this is the lawyer's fee |

**This must not stay as-is for firm/lawyer revenue.** The material
business decision (owner must choose; do not enable real collection for
invoices/consultations until decided):

1. **Separate merchant connections per firm** — each firm onboards its
   own Razorpay account; Advokate stores per-org key references
   (encrypted at rest) and creates links against the firm's account.
   Firm money never touches CJ GLOBAL. Requires key-management work and
   firm-side onboarding.
2. **Linked-account / aggregator arrangement on Razorpay Route
   (Marketplace)** — CJ GLOBAL's account is the platform account; each
   firm is a linked sub-merchant; payments settle directly (or
   split automatically) to the firm. Requires a Razorpay Route
   agreement, KYC for every linked firm, and route-aware link creation
   (`transfers`/`route` fields — not implemented today).
3. **Collections disabled for firm money** — invoice/consultation
   payment links stay off; firms record manual payments only; only
   CJ GLOBAL's own subscriptions and promotions collect online.

What changed after the decision: option 1 (per-firm merchant
connections) is implemented and enforced; option 2 (Razorpay Route/
Marketplace) was NOT chosen and is not implemented; the old single-
account collection path for firm money no longer exists in code.

---

---

## 2. Configuration requirements — exactly what each flow needs

Two independent credential sets exist. A firm does NOT need the platform
keys; the platform does NOT need any firm's keys.

**A. Firm-money flows (client invoices, consultation fees) — per-firm:**

1. A merchant connection for the firm: Billing → Payment account →
   connect the FIRM's own Razorpay test keys (key id + secret, plus the
   firm's webhook secret). Stored encrypted in the deployment database;
   test-mode only (`rzp_test_…` enforced).
2. The deployment master key for credential encryption:
   `SECRET_ENCRYPTION_KEY` (32-byte hex/base64) — one deployment-wide
   secret, never leaves the server. Until it (or the legacy fallback) is
   set, connecting a firm fails honestly instead of storing plaintext.
3. The firm's Razorpay dashboard webhook pointed at
   `https://moonlit-elk-307.convex.site/webhooks/razorpay/firm/<orgId>`
   with the firm's webhook secret.

Platform Razorpay keys (`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`)
are NOT required for these flows — verified by test ("collects for a
connected firm with NO platform Razorpay keys present").

**B. CJ GLOBAL money flows (software subscriptions, promotion purchases)
— platform-only:**

1. `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` on the deployment
   (test mode).
2. `RAZORPAY_WEBHOOK_SECRET` and the platform Razorpay dashboard
   webhook → `https://moonlit-elk-307.convex.site/webhooks/razorpay`.

**Refund requirement:** a payment is refundable through the account that
CAPTURED it — a firm payment needs that firm's merchant row to still
resolve (rotation is fine; disconnection is fine; a *different* account
is never used), and a platform payment needs the deployment keys.

**Missing-credential behavior (no silent failure paths):** invoice link
creation and consultation charging refuse until the firm connects its
own account; connection refuses until the encryption master key exists;
refunds fail honestly when the capturing account cannot be resolved.
Platform keys alone never enable collection for any firm.

## 2b. Credential encryption — review notes

Implementation: `src/convex/crypto.ts`, built ONLY on maintained,
reviewed libraries — `@noble/ciphers` (AES-256-GCM) and
`@noble/hashes` (SHA-256, SHA-1, HMAC, HKDF, CSPRNG). An earlier
hand-rolled construction was removed in favor of these; no custom
cryptographic primitives exist in the codebase.

- **Primitive:** AES-256-GCM (authenticated encryption); tag verified
  on decryption — tampering fails closed.
- **Nonce/IV:** 96-bit random per encryption from the library's CSPRNG
  (`randomBytes(12)`). Appropriate at credential-storage volume;
  every connect/rotate writes a fresh ciphertext under a fresh nonce.
- **Key derivation:** HKDF-SHA256 (RFC 5869) — master key +
  salt `"advokate-secret-enc-v1"` + `info` = the per-row context
  string, producing a unique AES-256 key per purpose/row.
- **Authentication & binding:** the GCM tag covers the context string
  (`"orgMerchant:<orgId>:<merchantRowId>:secret" | ":webhook"`) as
  associated data: a ciphertext cannot be decrypted under a different
  row, org, or purpose, nor after any byte of it is modified.
- **Server-side key storage:** the master key lives ONLY in the
  deployment environment (`SECRET_ENCRYPTION_KEY`; legacy fallback:
  the platform `RAZORPAY_KEY_SECRET`, so pre-existing connections keep
  working). Plaintext credentials exist only transiently inside the
  Node action that calls Razorpay; they are never returned to any
  client, never logged, never rendered in the UI (the Billing dialog
  shows only the key's last 4 characters).
- **Key rotation:** rotating a FIRM's Razorpay credentials = Billing →
  Payment account → connect again with the same merchant reference —
  the row is re-encrypted in place under a fresh nonce. Rotating the
  deployment MASTER key = set the new `SECRET_ENCRYPTION_KEY`, then
  re-save each firm's credentials (each connect re-encrypts); rows not
  re-saved fail closed (undecryptable) rather than leaking.

Secrets are never printed anywhere in this documentation, in logs, or
in test output.

## 2c. Merchant rotation vs a different account — semantics

- **Rotation (same merchant):** Billing → Payment account → connect
  with the SAME merchant reference (returned by the connect call and
  shown in status). Credentials and webhook secret are replaced in
  place; the merchant identity (row id + `merchantRef`) and all
  history are preserved. Old credentials are considered revoked at the
  provider; a webhook signed with a replaced secret fails closed.
- **A DIFFERENT account:** connect without that reference — a NEW
  merchant identity is created; the previous row is superseded
  (inactive) and retained forever.
- **Historical transactions keep their account:** every payments row
  records the capturing merchant (`merchantId` + `capturedMerchantRef`);
  every refund request FREEZES that merchant at request time. Refunds
  always authenticate against the ORIGINAL account — after rotation it
  uses that account's current credentials; after a switch to a
  different account it still uses the OLD account's row — never the
  newly connected account (tested: the outbound HTTP call's
  authorization is asserted to be the original account and explicitly
  not the new one).
- **Pending webhooks during rotation:** the verifier accepts signatures
  from the ACTIVE row first, then recently superseded rows — a provider
  still delivering with the previous secret during a switch is
  legitimately signed; every accepted event still passes full
  tenant/association validation before any money moves. Secrets
  replaced by an in-place rotation verify nowhere.
- **Disconnection:** disable stops NEW collection (links/consultations
  refuse; `providerStatus` flips for the firm) and disables the
  credential for future captures — but captured money remains
  refundable through the disabled row; refunds resolve it by identity,
  not by "what is connected now". If a merchant row cannot be resolved
  at all, the refund request fails honestly (`failed`, nothing moves)
  rather than being rerouted.

## 3. Webhook configuration (test mode, after keys exist)

1. Razorpay Dashboard → Settings → Webhooks → **Add New Webhook**.
2. URL: `https://moonlit-elk-307.convex.site/webhooks/razorpay`
3. Secret: the same value stored as `RAZORPAY_WEBHOOK_SECRET`.
4. Active events: `payment.captured`, `payment_link.paid`,
   `order.paid` (these reconcile money). Optional but logged:
   `payment.failed`, `refund.processed`, `refund.failed`,
   `refund.created` (audit-only; they never move invoice state).
5. Save; use "Send test event" and confirm a `paymentEvents` row
   appears (invalid signatures are rejected with HTTP 400 before any
   state change).

## 4. Real test-mode verification checklist (tier 2 — run when keys exist)

**Provider execution, automated tests, and browser verification are
labelled separately at every step. Nothing below uses live mode or makes
real charges.**

### 4a. Configuration steps (plain language, in order)

1. Set `SECRET_ENCRYPTION_KEY` (any 32-byte random hex/base64 value) in
   the deployment env — this encrypts firm credentials at rest.
2. [Platform + browser] Add the three platform keys
   (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
   from a CJ GLOBAL test-mode account, and create its dashboard webhook
   → `https://moonlit-elk-307.convex.site/webhooks/razorpay` (events:
   payment.captured, payment_link.paid, order.paid).
3. [Firm + browser] Sign in as each pilot firm → Billing → Payment
   account → connect THE FIRM's own test-mode keys and webhook secret.
4. [Firm] In the FIRM's own Razorpay dashboard, create its webhook →
   `https://moonlit-elk-307.convex.site/webhooks/razorpay/firm/<orgId>`.
5. Verify presence without leaking values:
   `bunx convex env list --names-only` shows SECRET_ENCRYPTION_KEY and
   the three platform RAZORPAY names.

### 4b. Provider-execution checks (curl / dashboard-driven)

1. Create an invoice payment link as a connected firm; confirm the link
   id exists on the firm's Razorpay dashboard (not the platform's).
2. Pay it with a test instrument (UPI `success@razorpay`).
3. Confirm reconciliation: payments row sourced `razorpay` bound to the
   capturing merchant, provider currency/method recorded, invoice
   `partially_paid`/`paid`, one journal, audit trail credits the
   webhook.
4. Duplicate handling: resend the same webhook event (dashboard →
   resend) → no change; deliver all three event types for one payment →
   exactly one record.
5. Tamper test: wrong signature → HTTP 400, zero state change.
6. Refund: partial refund → `requested` → provider confirms →
   `processed`, books unwound; a forced failure → `failed`, books
   untouched. Confirm on the FIRM's dashboard that the refund appears
   on the firm's account.
7. [Platform flows] subscription checkout + a promotion purchase on the
   CJ GLOBAL test account; confirm they reconcile in the SaaS ledger
   and never touch firm invoices.
8. **Only after 1–7:** record tier-2 as verified with dates and event
   ids (evidence stored outside the repo).

### 4c. Browser checks (pending — automation unavailable)

See `docs/BROWSER_VERIFICATION.md` (15 steps). Razorpay-specific browser
additions when the environment allows: hosted-link checkout renders and
completes for a firm link; the Billing → Payment account dialog connect
→ rotate → disable journey; provider status line updates after connect.
All remain PENDING until browser verification is possible.

## 5. Security and correctness model (enforced in code, fixture-tested)

- HMAC-SHA256 over the exact raw bytes Razorpay signed, constant-time
  comparison; invalid signatures never reach state (HTTP 400).
- **Two dedupe layers:** per provider *event* id (redelivery) AND per
  provider *payment* id across `payment.captured` / `payment_link.paid`
  / `order.paid` (exactly one payments row, one allocation, one journal,
  whichever event arrives first). Duplicate events are still logged in
  `paymentEvents` with a note — the audit shows everything received.
- **Signature ≠ authorization:** association is accepted only through
  server-side records — the invoice's stored `paymentLinkId` /
  `paymentOrderId` must agree with the event, or the `reference_id` must
  name the invoice number. A mismatched link/order is recorded as a
  RECONCILIATION EXCEPTION in the invoice audit and applies nothing. The
  event's currency must equal the organization's billing currency.
- **Excess money is never discarded:** the invoice allocation is capped
  at the outstanding balance; the remainder is an `unappliedCredits` row
  (`excess_received`) plus a liability journal (Bank Dr / Unapplied
  Customer Credits Cr, account 2400) — visible, tracked, refundable on
  request.
- **Refund state machine:** `requestRefund` (billing.payment capability)
  creates a `refundRequests` row (`requested`) and marks the payment
  `refund_pending` *before* the provider call; books move only when the
  provider confirms (`processed`, journal per refund-request id); a
  provider rejection records `failed` with the reason and moves nothing.
  Partial refunds and repeated retries are supported; over-refunding is
  refused against remaining refundable amounts.
- Non-money events (`payment.failed`, `refund.*`) are audit-logged only.
- SaaS subscription payments (`notes.kind === "saas"`) reconcile in the
  subscription ledger, never the client-invoice ledger, with the same
  cross-event-type dedupe (three event types → one renewal).

## 6. Renewals: manual links, not recurring subscriptions

Renewals today are **manual one-time payment links** created per period
(or by the member from Billing). There is **no** Razorpay Subscriptions
integration: no mandates, no `subscription.charged` lifecycle, no
auto-debit. The subscription lifecycle states (`trialing → active →
past_due → grace → read_only → cancelled`) are driven by period-end
checks plus one verified payment link per renewal. If recurring
auto-debit is ever wanted, Razorpay Subscriptions (Plans, `subscription.
charged`/`subscription.halted`/etc. events) must be integrated and the
reconciler extended — ordinary payment events alone are not sufficient
for a compliant recurring setup.

## 7. Test coverage (tier 1)

`src/convex/payments.test.ts` — 19 tests, all green (see tier table in
section 0; the merchant-ownership block covers encrypted storage,
connection-gated link creation, firm-webhook verification + cross-tenant
refusal, rotation vs different-account semantics, refund-to-original-
account routing, platform-key independence for firms, and the
secret-crypto round-trip/tamper cases). Full suite at time of writing:
32 files / 525 tests.
