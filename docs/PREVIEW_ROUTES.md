# ADVOKATE — Preview routes & workspace demonstration guide

Exact routes in this deployment (verified from `src/main.tsx`). Public routes
need no sign-in; everything under "Authenticated" redirects to `/login` with
the intended path preserved (`RequireAuth`).

## 1. Commercial surfaces

| Flow | Route | What to verify on screen |
|---|---|---|
| Public pricing | `/pricing` | Category sections A–D; monthly/yearly pill selector (enabled only when plans of that cycle exist); price display agrees with server config: priced plans show ₹ figures + yearly rows show the full annual charge with the derived ≈monthly figure and computed savings (only when yearly < 12×monthly); unpriced plans show **"Configuration pending"** (never ₹0, never "unlimited"); manual-renewal + next-billing-period disclosures under "The fine print, in plain sight"; enterprise card links to `#contact` |
| Enterprise contact | `/pricing#contact` | Form validates name/email/≥20-char requirements; success message promises nothing charged; enquiry lands in `/platform` → Enterprise enquiries (admin-only) |
| Checkout | `/pricing` → **Choose this plan** on a purchasable card → `/login` (return path preserved) → post-auth the plan's checkout/payment-link flow opens | With Razorpay unconfigured the button honestly shows "Online purchasing not open yet" / "Configuration pending" — that IS the correct agreement with server state (`purchasable = category≠enterprise && price>0 && keys configured`) |
| Billing management | `/billing` (Settings → Subscription embeds the same `SubscriptionCard`) | Current plan/status badges, seats, **current period end**, the manual-renewal line (payment link at period end, next charge amount, no automatic card charge, 7-day grace → read-only consequences), awaiting-payment badge + "Open payment link" when `past_due`, billing history table |
| Plan changes | `/billing` → per-plan buttons on live subscriptions | **Switch now** confirm states: charged today **₹0.00**, the explicit next charge, effective date, next-billing-period (no-proration) policy, unpaid consequences; **Period end** confirm states the scheduled effective date; a scheduled change is displayed with its date and a **Withdraw scheduled change** button |
| AI usage | `/billing` → `#ai-usage` block, and `/ai` | Tier badge, usage bar, used/reserved/remaining + reset date, specific reason banner when blocked (non-AI plan keeps the full-workspace message), honest `liveConfigured:false` note when no key, available tiers with model ids, aiFeatures list |

## 2. Screen-vs-server agreement checklist (manual, ~10 minutes)

### Routes for CJ GLOBAL platform accounts (owner / workforce)

| Flow | Route | What to verify |
|---|---|---|
| Platform owner console | `/owner` | Renders the actual Operations console when a signed-in platform identity is present: ticket queue with triage actions, health counters, handoff view and operations audit. The per-session MFA challenge card shows for enrolled accounts; the enrollment-required card shows for internal accounts that never enrolled. The bare refusal card (plus the audited self-activation card when the signed-in, email-verified account matches `PLATFORM_OWNER_EMAIL`) shows for everyone else — queue content never renders for them. **Fixed 11 Oct:** the route guard previously bounced ANY non-chamber account (including the platform owner, who holds no `memberships` row) back to `/login` before the page could render; `RequireAuth` now resolves platform identity (`workforce.myPlatformIdentity`) for platform-flagged console routes and lets the page's own server-side gates decide. A masked-eligibility refusal still applies to every non-platform account. |
| Platform subscription console | `/platform` | Section-24 console (chambers, billing config, discovery review, enterprise enquiries) — unchanged; gated by the same server-side `amIPlatformAdmin`. |

### Commercial checklist1. `/platform` (platform admin): note a plan's configured price/interval/AI
   allowance → compare with the same plan's card on `/pricing` — amounts,
   cycle, trial badge, AI line must match `saasPlans` exactly.
2. Toggle the interval selector — only cycles that have configured plans are
   offered; cards re-sort to that cycle's rows.
3. Yearly card savings line must equal `12×monthly − yearly` **exactly** (or
   be absent when the yearly price is not genuinely cheaper).
4. `/billing` "Next charge" figure must equal the current plan's configured
   price; the period-end date must match the subscription row.
5. `/ai` usage numbers must match the entitlement query (used = sum of this
   IST month's completed tokens; reserved = 6,000 × pending jobs).

## 3. Lawyer workspace demonstration (the promised experience)

All routes authenticated. Seed: one matter with documents (incl. one
internal-only), chronology events, an assigned task for the support-staff
member, a linked portal client; owner on an AI plan with allowance.

| Step | Route / action | Acceptance |
|---|---|---|
| Matter workspace | `/matters` → open the matter | Tabs render: command, timeline (chronology), hearings, orders, tasks, requests, documents, time, expenses, invoices, comms, notes, parties (team), issues, review (§32), filing, translations, client updates, docket, audit, ai. Documents/chronology/team/pending tasks each populate from real data |
| Case X-Ray (AI configured) | Matter → **AI** tab → kind "Case X-Ray" → select sources → run | Result appears with analyzed-sources disclosure, citations traceable to the selected sources; second run shows "What changed since the previous X-Ray" (added/changed/removed) and the prior X-Ray is flagged outdated in history; record-not-opinion note present |
| Case X-Ray (AI unconfigured) | Same | Honest banner (no key) / allowance-exhausted banner with reset date and options — never a silent failure, never a charge |
| Drafting | Matter → AI tab → kind "draft" (or `/drafts` for the drafts centre) | Draft generated as review-required output; with missing facts the clarification gate records the question instead of running the model |
| Reply to a notice | Matter → AI tab → kind "email reply" on a filed notice (or comms thread reply) | Reply drafts from the exact filed email; review-required posture |
| Contact a client | Matter → **Comms** tab → new message to the client thread → approve/queue | Message posts to the client's thread; client sees it at `/portal` |
| Restricted staff | Sign in as the support-staff member → same matter | Assigned tasks visible; billing surfaces and internal documents are refused/hidden; `/billing` shows the honest no-permission state |

Executable version: `e2e/workspace.spec.ts` (see `e2e/README.md`) encodes
these steps as Playwright specs — pending execution in a Chromium-capable
environment; execution here was not possible.
