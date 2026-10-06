# ADVOKATE browser E2E — runnable setup (execution PENDING)

These specs encode the promised product walkthroughs as executable
Playwright tests. They have **not been executed** (the authoring
environment has no browser tooling); run them in any environment that
supports Chromium. They deliberately assert **screen-vs-server
agreement** (prices, entitlements, plan-inclusion, disclosure copy) —
backend unit tests are not evidence for any of it.

## 1. Install (in a Chromium-capable environment)

```bash
cd e2e
npm install
npx playwright install chromium
```

## 2. Point at a running deployment

The suite never starts or stops servers. Provide the app URL:

```bash
export E2E_BASE_URL="http://localhost:5173"   # local dev, or
export E2E_BASE_URL="https://<your-deployment-url>"
```

## 3. Test identities (create in the target deployment first)

| Identity (default email) | Role / state | Purpose |
|---|---|---|
| `owner@e2e-advokate.test` | firm OWNER, active subscription on a `practice_ai`-category plan (AI enabled, allowance ≥ 60,000) | billing mgmt, plan changes, X-Ray, drafting, client comms |
| `associate@e2e-advokate.test` | associate on the same matter | team visibility |
| `clerk@e2e-advokate.test` | support_staff on the same matter | restricted access proof |
| `client@e2e-advokate.test` | portal client on the same matter | authorized client contact |

Seed one matter (reference `E2E/2026/0001`, override with `E2E_MATTER_REF`)
with: 2 uploaded documents (one internal-only), ≥2 chronology events, 1
assigned task for the clerk, and the client linked. Override any identity
email via `E2E_OWNER_EMAIL` / `E2E_ASSOCIATE_EMAIL` / `E2E_CLERK_EMAIL` /
`E2E_CLIENT_EMAIL`.

## 4. OTP handling

Login is real email-OTP (6-digit codes are emailed per sign-in). Capture
the codes for the four inboxes and export them before running:

```bash
export E2E_OTP_JSON='{"owner@e2e-advokate.test":"123456", "clerk@e2e-advokate.test":"234567", "client@e2e-advokate.test":"345678"}'
```

(Use a catch-all inbox on the test domain so codes are retrievable
programmatically. Codes are single-use and short-lived — refresh per run.)

## 5. AI-dependent specs

The X-Ray and drafting specs auto-skip unless the deployment has
`OPENAI_API_KEY` configured **and** you export `E2E_AI_CONFIGURED=1`.
They still verify the honest states otherwise (banners, usage block, no
silent failures).

## 6. Run

```bash
npm test                 # everything
npm run test:pricing     # pricing + billing screens
npm run test:workspace   # lawyer workspace walkthrough
```

Artifacts on failure: trace, video, screenshot (`test-results/`), plus
`results.json`.

## 7. What "passing" proves (and doesn't)

Proves, in a real browser against the target deployment: public pricing
renders per server config; billing confirmations show charged-today ₹0.00
and the explicit next charge; manual-renewal copy is present; matter
documents/chronology/team/pending actions reachable; X-Ray result names
its sources with the record-not-opinion disclosure; drafting produces a
review-required draft; client comms reach the authorized portal account;
restricted staff cannot reach privileged surfaces.

Does NOT prove: provider test-mode money movement (needs Razorpay test
keys + webhook — see `docs/OWNER_SETUP_CHECKLIST.md` §6) or live-model
quality (needs bounded evaluation with synthetic data). Those remain
separate pending items.
