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
| 1. Automated fixture tests | 13 Convex-backend tests in `src/convex/payments.test.ts` (signature rejection, honest 503, reconciliation, same-event-id redelivery, **three event types naming one payment → exactly one record/allocation/journal**, out-of-order arrival, tampered link reference, wrong currency, capped allocation with tracked excess credit, SaaS renewal deduped across event types, non-money events log-only, refund requested → processed with books moving only on provider confirmation, provider rejection → `failed` with nothing moved, over-refund refusal). Full suite: 32 files / 519 tests green. | ✅ Done (synthetic data only) |
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

## 1. Merchant ownership — DECISION REQUIRED BEFORE ENABLING COLLECTION

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

What is safe today: tiers 1–3 verification with **test-mode** keys uses
fake money, so verification may proceed before the decision. What is not
safe: enabling live collection of invoice/consultation payments under
option 3's current code path (single CJ GLOBAL account) — that would
silently route client money through CJ GLOBAL.

---

## 2. Keys and the exact secret store

- **Secret store:** the Convex deployment's environment variables on
  **moonlit-elk-307** — set from the platform Keys/API keys tab (the
  platform copies them into the deployment) or directly in the Convex
  dashboard: moonlit-elk-307 → Settings → Environment Variables. Verify
  presence without leaking values: `bunx convex env list --names-only`
  (never run the plain `env list`; it prints secret VALUES).
- Backend-only: read via `process.env` inside `"use node"` actions;
  never shipped to the browser, never logged, never written to
  source/docs/chat/archives.

| Key name | What it is |
| --- | --- |
| `RAZORPAY_KEY_ID` | `rzp_test_…` (test mode only for now) |
| `RAZORPAY_KEY_SECRET` | Shown once at key creation; rotate from the dashboard if exposed |
| `RAZORPAY_WEBHOOK_SECRET` | The string you type when creating the webhook (step 3) |

Test mode only. No live keys, no `rzp_live_…`, no live charges from this
project.

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

1. `bunx convex env list --names-only` lists all three RAZORPAY names.
2. Billing → open a sent invoice → create the payment link; the stored
   `paymentLinkId` appears on the invoice.
3. Pay the link with a test instrument (UPI `success@razorpay`).
4. Confirm reconciliation: payments row sourced `razorpay` with the
   provider's currency/method recorded, invoice `partially_paid`/`paid`,
   one journal (Bank Dr / AR Cr), audit trail credits the webhook.
5. Duplicate handling: resend the same webhook (dashboard → resend) →
   no change; then verify via a second test payment that the three
   event types for one payment still produce exactly one record.
6. Tamper test: wrong signature → HTTP 400, zero state change.
7. Refund: request a partial refund from the payment row → status
   `requested` → provider confirms → `processed`, books unwound; then
   trigger a failure (e.g. expired test credentials) → `failed`, books
   untouched.
8. **Only after steps 1–7:** record tier-2 as verified with dates and
   evidence (event ids, screenshots stored outside the repo).

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

`src/convex/payments.test.ts` — 13 tests, all green (see tier table in
section 0). Full suite at time of writing: 32 files / 519 tests.
