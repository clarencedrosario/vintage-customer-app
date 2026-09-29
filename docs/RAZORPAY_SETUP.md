# Razorpay setup — keys, webhook, verification

Status: **Integration complete and tested (29 Sep 2026); keys pending.**
The code is wired end-to-end; it activates the moment the keys below are
added. Until then every payment action degrades honestly: "Online payments
are not configured yet — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.
Manual payment recording stays available." Opening a link or scanning a QR
never marks anything paid; only a signature-verified webhook reconciles
money.

## 1. Keys to add (Keys/API keys tab)

Add these three names — values never go in chat, source, logs or archives:

| Key name | What it is | Where to get it |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` | Public key id, `rzp_test_…` / `rzp_live_…` | Razorpay Dashboard → Account & Settings → API Keys → Generate Test/Live Key |
| `RAZORPAY_KEY_SECRET` | The secret shown once at key creation | Same dialog — copy it immediately; rotate from the dashboard if exposed |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you type when creating the webhook (step 2) | You choose it when creating the webhook; the dashboard shows it once |

Notes:
- Test-mode keys (`rzp_test_…`) are enough for full verification; no live
  mode, no billing activation happens from this project.
- The runner reads them server-side only (`process.env` inside Convex
  actions); they are never shipped to the browser.

## 2. Webhook configuration (Razorpay Dashboard)

1. Razorpay Dashboard → Settings → Webhooks → **Add New Webhook**.
2. URL: `https://moonlit-elk-307.convex.site/webhooks/razorpay`
   (the deployment's HTTP actions route — `src/convex/http.ts`).
3. Secret: enter the value you will also store as `RAZORPAY_WEBHOOK_SECRET`.
4. Active events: `payment.captured`, `payment_link.paid`,
   `order.paid` (the three that reconcile money) — other events are
   logged but change nothing.
5. Save, then use Razorpay's "Send test event" and confirm a
   `paymentEvents` row appears in the deployment data (invalid
   signatures are rejected with HTTP 400 before any state changes).

## 3. What activates once the keys exist

- **Invoice payment links** (Billing → invoice → Payment link) — UPI +
  all enabled checkout methods; the link URL is stored on the invoice
  and reconciled only by a verified webhook.
- **Consultation fee links** (pending/accepted consultations).
- **Subscription checkout** (plan renewals; read-only-mode chambers can
  self-restore by paying).
- **Promotion package purchases.**
- **Refunds** from recorded Razorpay payments (normal speed).
- `providerStatus` (Billing page) flips to configured; the honest
  "not configured" message disappears.

## 4. Verification checklist (after adding keys — no live charges needed)

1. `bunx convex env list --names-only` lists all three RAZORPAY names.
2. Billing → open a sent invoice → "Payment link": a short URL appears
   on the invoice within seconds (test mode).
3. Open the link in test mode, pay with Razorpay's test instrument
   (e.g. UPI `success@razorpay`), and confirm: invoice shows a payment
   row sourced `razorpay`, status becomes `partially_paid`/`paid`, and
   the audit trail credits "Razorpay webhook" — not the link opening.
4. Re-send the same webhook event (Razorpay dashboard → webhooks →
   resend): the second delivery must change nothing (idempotent).
5. Tamper test: send a request to the webhook URL with a wrong
   signature → HTTP 400, zero state change.

## 5. Security model (already enforced in code — `paymentsProvider.ts`)

- HMAC-SHA256 over the exact raw bytes Razorpay signed, constant-time
  compared against `RAZORPAY_WEBHOOK_SECRET`; invalid signatures never
  reach invoice state.
- Reconciliation is idempotent per provider event id (dedupe on
  `paymentEvents.by_event` / `saasPaymentEvents.by_event`).
- Amounts are capped at the outstanding balance; over-payments never
  create credits.
- SaaS subscription payments (`notes.kind === "saas"`) reconcile in the
  subscription ledger, never into the client-invoice ledger.
- Provider payments post to the finance journal with a per-payment
  dedupe key, so webhook redelivery cannot double-post.

## 6. Test coverage added this turn

`src/convex/payments.test.ts` (6 tests): invalid-signature rejection
with zero state change; honest 503 when the webhook secret is missing;
captured payment → invoice + payments ledger + event log; redelivery
idempotence; over-payment capped at the outstanding balance; SaaS
routing away from the client-invoice ledger. Full suite: 32 files /
512 tests green.
