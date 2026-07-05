# Lago Billing Infrastructure — Design Spec

**Date:** 2026-07-05
**Status:** Approved for planning
**Source doc:** Nexus AI Pricing & Billing Framework (Verbosec internal, undated draft supplied 2026-07-05)

## Scope

This spec covers **only the billing infrastructure layer**: the plumbing connecting LibreChat, Lago (self-hosted), and Stripe. It does not cover the individual product features referenced by the pricing doc (Research Mode, Nexus AI Academic, Creative Studio, video/image/audio generation, chatbot builder, meeting notes, etc.) — those are separate, much larger feature-build projects that mostly don't exist in this codebase yet. Their credit costs (pricing doc Section 7) are treated as configuration data this infrastructure must be able to accept generically, not something hard-coded here.

**In scope for v1:**
- Individual plans only: Free, Premium, Ultimate.
- Customer/subscription provisioning, usage reporting, entitlement sync, checkout.

**Explicitly out of scope for v1:**
- Teams/Business seat-based billing (org membership, seat add/remove, pooled credits). Deferred to a follow-up phase once individual billing is proven. The design should not preclude adding this later, but no org-aware code is being built now.
- Education/Enterprise (custom-negotiated, invoiced manually — no self-serve flow needed).
- Any UI/backend work for features that don't exist yet (Research Mode, Academic workspace, Creative Studio, etc.) — only the one existing usage source (chat/agent messages) is wired up.
- Direct Stripe integration — Lago's built-in Stripe connector handles all payment collection; this codebase never calls the Stripe API directly.

## Context: Existing Systems Being Extended

- **Identity**: Zitadel is already the production SSO provider for LibreChat. The Zitadel user ID is the natural key for a Lago customer's `external_id`. No changes needed to identity — this spec only adds a mapping.
- **Local balance system** (unchanged, extended only in config): `Balance` and `Transaction` models (`packages/data-schemas/src/schema/`), `checkBalance` middleware (`packages/api/src/middleware/checkBalance.ts`), `recordCollectedUsage()` (`packages/api/src/agents/usage.ts`) as the cost-finalization hook point. See the research summary below for exact file/line references.
- **Frontend**: an Account → Billing section already exists (`client/src/components/Nav/Settings/registry.tsx`, `SectionId: 'billing'`), currently showing token-credit balance and auto-refill controls. This is extended, not replaced.
- **Admin panel**: external prebuilt image, no billing surface today, out of scope to change.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Lago primitive for usage limits | **Entitlements**, not Wallets | Entitlements express plan-level allowances/feature access cleanly and fit a system meant to serve multiple Verbosec products, not just prepaid credit balances for one product. |
| Customer identity | Keyed off **Zitadel user ID** | Zitadel is already the shared Verbosec identity/SSO system in production. |
| Request-time enforcement | **Local fast gate + async Lago reporting** | LibreChat's existing `Balance`/`checkBalance` system keeps blocking requests in real time with zero added latency and no new hard dependency on Lago's uptime for the hot path. Lago is the authoritative record for invoicing/cross-product reporting, reconciled asynchronously — not consulted synchronously per request. |
| Stripe integration | **Via Lago's native connector only** | Lago creates Stripe customers/checkout sessions/invoices itself. This codebase never calls the Stripe API directly, and never receives Stripe webhooks directly — only Lago's webhooks. |
| Checkout UI location | **Inside LibreChat's own frontend** | Extends the existing Account → Billing settings section rather than linking out to a hosted portal or a separate site. |
| Lago checkout mechanism | **Hosted Stripe Checkout URL issued by Lago** | Confirmed against Lago's API — LibreChat requests a checkout session from Lago and redirects the browser to the URL Lago returns; no Stripe Elements form is built in this codebase. |
| V1 org/seat scope | **Individual plans only** | Teams/Business seat-based billing (org membership, seat sync, pooled credits) is meaningfully more complex and deferred to a follow-up phase. |
| Lago customer provisioning trigger | **Only on a billing action (upgrade/checkout)** | Free-tier users have no Lago customer at all and are served entirely by LibreChat's existing local defaults. A Lago customer + subscription is created the first time a user actually upgrades. Entitlement/enforcement code must have a clean fallback path for users with no Lago customer yet. |

## Architecture Overview

```
                    ┌─────────────┐
   Zitadel (SSO) ──▶│  LibreChat  │◀── existing Balance/Transaction
                    │             │    (unchanged fast local gate)
                    └──────┬──────┘
                           │
              ┌────────────┼─────────────────┐
              │ (1) upgrade action            │ (2) async usage event
              │ creates customer+subscription │    (fire-and-forget,
              ▼                                ▼    never blocks request)
        ┌───────────────────────────────────────────┐
        │                    Lago                     │
        │  customers · plans · entitlements ·         │
        │  billable metrics · usage aggregation ·     │
        │  invoices                                    │
        └──────────────────┬───────────────────────────┘
                           │ built-in Stripe connector
                           ▼
                       ┌────────┐
                       │ Stripe │  (payment collection only)
                       └────────┘
                           │
              (3) Lago webhook: subscription/invoice/payment events
                           ▼
                    ┌─────────────┐
                    │  LibreChat  │  updates local balance config
                    │  webhook    │  to match new plan
                    │  receiver   │
                    └─────────────┘
```

## Components

### a. Lago client — `packages/api/src/billing/lago-client.ts`
Thin, typed wrapper around Lago's API (evaluate Lago's official SDK for quality/completeness first; fall back to a typed HTTP client if it's inadequate). Exposes only typed functions: `createCustomer`, `createSubscription`, `getPlan`, `sendUsageEvent`, `createCheckoutSession`, etc. No other module in the codebase talks to Lago's API directly.

### b. Customer/subscription provisioning — `packages/api/src/billing/provisioning.ts`
- `ensureLagoCustomer(zitadelUserId)` — idempotent get-or-create, called only when a billing action starts. Must be safe against concurrent/double-click calls.
- `createSubscription(customerId, planCode)` — called after checkout completes.

### c. Usage event emission — `packages/api/src/billing/usage-events.ts`
Hooks into the existing `recordCollectedUsage()` (`packages/api/src/agents/usage.ts`), immediately after `spendTokens`/`spendStructuredTokens` succeeds locally. Sends the Lago usage event asynchronously (fire-and-forget); failures are logged, never thrown, never block the response.

Durability without a message queue: add `lagoSyncedAt` / `lagoSyncError` fields to the existing `Transaction` schema (`packages/data-schemas/src/schema/transaction.ts`), plus a periodic sweep job that re-sends any transaction missing `lagoSyncedAt`. This gives eventual-consistency reporting to Lago, appropriate since Lago's copy is for invoicing/reporting, not enforcement. The sweep job's own failures must be logged/counted so silent pile-up is visible.

### d. Entitlement/plan sync (webhook receiver) — `packages/api/src/billing/webhooks.ts` + thin route `api/server/routes/billing/webhooks.js`
- Verifies Lago's webhook signature; rejects invalid/unsigned payloads with 401 and a logged security event.
- Handles `subscription.started` / `subscription.updated` / `subscription.terminated` (exact Lago event names to confirm during implementation).
- On a plan change, reads the plan's entitlement value for the credits allowance and updates the user's local `Balance` record (`refillAmount`, `refillIntervalUnit`, `autoRefillEnabled`, resets `tokenCredits`), using the credits-unit conversion rate (see Open Questions).
- Must be idempotent (Lago may redeliver) and must guard against out-of-order delivery (e.g., a delayed `started` event overwriting a newer `terminated` state) using event timestamp/sequence.
- Cancellation/payment-failure grace-period behavior (immediate cutoff vs. riding out the paid period) to be confirmed against Lago's actual subscription-state model during implementation.

### e. Local enforcement — unchanged
Existing `checkBalance` / `Balance` / `Transaction` system keeps working exactly as today. Free-tier users are entirely unaffected — no Lago customer, no new code path.

### f. Checkout & billing UI — extends `client/src/components/Nav/Settings/registry.tsx` (Account → Billing section)
New entries: plan picker, checkout trigger (redirects to Lago's hosted Stripe Checkout URL), current-plan/usage summary, invoice history. Backend surface:
- `GET /api/billing/plans` — proxies Lago's plan definitions (Lago stays the single source of truth for plan copy/pricing, avoiding drift from a hardcoded frontend list).
- `POST /api/billing/checkout` — ensures a Lago customer exists, requests a hosted checkout session, returns the redirect URL.
- `GET /api/billing/subscription` — current user's plan/entitlement state, for the UI to display and to poll briefly after redirect-back while waiting for the webhook to land.

## Key Data Flows

### Flow 1 — User upgrades to Premium
1. Frontend: user picks "Premium" → `POST /api/billing/checkout { planCode: 'premium' }`.
2. Backend: `ensureLagoCustomer(zitadelUserId)`, then requests a hosted checkout session from Lago for that plan.
3. Backend returns the hosted Stripe Checkout URL; frontend redirects the browser there.
4. User pays on Stripe's hosted page → Stripe confirms to Lago → Lago activates the subscription.
5. Lago fires a `subscription.started` webhook → webhook receiver updates local `Balance` using the credits-unit conversion rate.
6. User is redirected back to LibreChat; frontend re-fetches `GET /api/billing/subscription`. Since the webhook and the redirect-back can race, the UI shows a brief "activating..." state rather than assuming instant consistency.

### Flow 2 — User sends a chat message (normal usage)
1. Request flows through the existing agents endpoint as today.
2. `recordCollectedUsage()` computes cost, calls `spendTokens`, persists a `Transaction`, decrements local `Balance` — entirely unchanged, entirely synchronous, entirely local.
3. Immediately after: fire-and-forget send of the usage event to Lago, tagged with the Zitadel user ID. Success marks the `Transaction` synced; failure is logged and left for the sweep job.
4. Response returns to the user with zero added latency from any billing plumbing.

### Flow 3 — Plan change / cancellation / payment failure
1. Any subscription-state change in Lago fires a webhook.
2. Webhook receiver verifies signature, looks up the local user by the Lago customer's `external_id` (Zitadel user ID), updates local `Balance` config to match.
3. Cancellation/payment-failure grace-period handling: see Open Questions.

## Error Handling & Edge Cases

- **Lago/Stripe unreachable during checkout**: `POST /api/billing/checkout` fails clearly and visibly ("billing temporarily unavailable") — the one place a Lago outage is user-visible, by design.
- **Webhook signature verification**: reject unsigned/invalid webhooks with 401 and a logged security event.
- **Webhook idempotency**: handlers must be safe to run twice (check current state before reapplying, dedupe by Lago's event ID).
- **Out-of-order webhooks**: guard against a stale event overwriting newer state using timestamp/sequence.
- **Double-checkout / concurrent customer creation**: `ensureLagoCustomer` must use get-or-create semantics, not blind create.
- **Stale entitlement window**: local `Balance` can briefly lag Lago's actual state during plan changes — accepted tradeoff of the enforcement-model decision, not a bug.
- **Silent sweep-job failure**: must be logged/counted so un-synced transactions piling up is visible, not silent.
- **Credit-unit conversion changes**: if the marketed-credit ↔ `tokenCredits` multiplier ever changes, existing balances must not silently jump — treat as a deliberate migration.

## Testing Approach

Following the project's existing testing philosophy (real logic over mocks; mock only what you cannot control): Lago and Stripe are external HTTP APIs and are the only things mocked, at the HTTP boundary. Everything else runs against real logic with `mongodb-memory-server`.

- `lago-client.ts`: HTTP-level mocking (e.g. `nock`) for success/error/timeout cases.
- Webhook receiver: real Express handler + real Mongo, fabricated webhook payloads (valid and invalid signatures), assert `Balance` updates correctly.
- Usage event emission: regression-test that `recordCollectedUsage()`'s existing behavior is unchanged; verify the new async hook sends the right payload and marks `Transaction.lagoSyncedAt` correctly against a mocked Lago endpoint.
- Sweep job: seed un-synced `Transaction` docs, run against a mocked Lago endpoint, assert they get marked synced.
- Real end-to-end checkout (actual Stripe hosted page) stays a manual/staging verification step, not automated in CI.

## Open Questions to Resolve During Implementation

1. **Credits-unit conversion rate**: a fixed multiplier between the pricing doc's marketed "credits" (Section 6/7) and LibreChat's internal `tokenCredits` unit (1,000 `tokenCredits` = $0.001) needs to be pinned down and configured.
2. **Exact Lago webhook event names/payload shapes** for subscription lifecycle — confirm against the self-hosted Lago instance's actual event catalogue.
3. **Cancellation/payment-failure grace period**: does access drop immediately or ride out the remaining paid period? Likely maps to a `terminated` vs `pending_termination` distinction in Lago — confirm exact semantics.
4. **Lago SDK quality**: evaluate the official Node/JS SDK before committing to it vs. a hand-rolled typed HTTP client.

## Research Reference (from prior codebase exploration)

- `Balance` schema: `packages/data-schemas/src/schema/balance.ts:5-46`. `Transaction` schema/methods: `packages/data-schemas/src/schema/transaction.ts`, `packages/data-schemas/src/methods/transaction.ts`.
- Cost finalization: `recordCollectedUsage()`, `packages/api/src/agents/usage.ts:513-680`; bottoms out in `spendTokens`/`spendStructuredTokens`, `packages/data-schemas/src/methods/spendTokens.ts:41-158`.
- Balance gating middleware: `checkBalance()`, `packages/api/src/middleware/checkBalance.ts:153-176` (delegates to `checkBalanceRecord()`, lines 48-147). Note: the modern Agents endpoint currently has **no pre-flight balance check** (only post-hoc decrement) — irrelevant to this spec's chosen enforcement model, but worth knowing for context.
- Frontend billing section: `client/src/components/Nav/Settings/registry.tsx:535-551` (existing `tokenCredits`/`autoRefill` entries), `client/src/components/Nav/Settings/types.ts:16-34` (`SectionId` already includes `'billing'`), `client/src/components/Nav/Settings/BillingControls.tsx:1-61`.
- Admin panel: external image (`registry.librechat.ai/clickhouse/librechat-admin-panel:latest`), no in-repo billing surface; only in-repo code is SSO/auth plumbing (`api/server/routes/admin/auth.js`).
- No existing Stripe/payment/subscription code anywhere in the repo — confirmed clean slate.
