# Billing: Plan Curation, Own Settings Tab, and Public Plan Links

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the just-shipped billing UI (design: `docs/superpowers/specs/2026-07-05-lago-billing-infrastructure-design.md`; backend plan: `docs/superpowers/plans/2026-07-07-lago-billing-backend.md`; frontend plan: `docs/superpowers/plans/2026-07-16-lago-billing-frontend.md`) with:

1. A curated, env-configured plan/add-on list (not "whatever Lago returns"), replacing the two hardcoded lookup tables that currently live only in `BillingWebhooks.js`.
2. A real subscription lookup (the current `getSubscription` handler is a stand-in that just checks whether the user has an `openidId` at all, not whether they have an active Lago subscription — everyone via SSO would incorrectly read as subscribed).
3. Billing promoted to its own top-level Settings tab, positioned after **Data & Privacy** and before **Account** (currently nested inside Account → Billing).
4. Two new direct-link routes for use from the website: `/plans` (all curated plans, monthly/annual switcher) and `/plans/:planCode` (single-plan page, same switcher scoped to that plan's tier). **These require authentication** — visiting either route while logged out redirects to `/login` (same as the existing `ChatRoute` pattern), not a public marketing page.

**Decisions made with the user before writing this plan:**
- Plan-to-credit-allowance mapping and the curated plan/add-on list are configured via **environment variables** (JSON), not a static code file or Lago plan metadata.
- The direct single-plan link shows a **plan detail page first** (with a Subscribe button), rather than redirecting straight into Lago checkout.
- The plan pages require login (updated after initial review) — so there is no logged-out state to design for on these routes; a visitor without a session is redirected to `/login` before the page ever renders.

**Confirmed via codebase research — no new code needed:**
- Free-tier limits are already handled by LibreChat's existing `balance.startBalance` config in `librechat.yaml`. The design spec already states free-tier users have no Lago customer at all and are served entirely by the existing local `Balance`/`checkBalance` system. Nothing in this plan changes that — it's purely documented here for clarity, since the user asked how free-tier limits are set.

---

## Part A — Backend: curated config, plan enrichment, real subscription lookup

### Task 1: Curated plan/add-on config from environment variables

**Files:**
- Create: `packages/api/src/billing/plans-config.ts`
- Test: `packages/api/src/billing/plans-config.spec.ts`
- Modify: `packages/api/src/billing/types.ts` (extend `LagoPlan`, `LagoAddOn`)
- Modify: `packages/api/src/billing/index.ts` (barrel export)
- Modify: `.env.example`, `.env`

This introduces the single source of truth for "which plans/add-ons are real and displayable" and "how many token credits each one grants" — replacing the two ad hoc lookup tables that currently live inline in `BillingWebhooks.js` (`getPlanCreditsAllowance`, `getAddOnCreditsValue`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/billing/plans-config.spec.ts
import { getCuratedPlans, getCuratedAddOns } from './plans-config';

describe('getCuratedPlans', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('parses LAGO_PLANS_CONFIG into curated plan entries', () => {
    process.env.LAGO_PLANS_CONFIG = JSON.stringify([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
      { code: 'nexus_premium_annual', tier: 'premium', interval: 'annual', tokenCredits: 5000 },
      { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
      { code: 'nexus_ultimate_annual', tier: 'ultimate', interval: 'annual', tokenCredits: 30000 },
    ]);

    expect(getCuratedPlans()).toEqual([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
      { code: 'nexus_premium_annual', tier: 'premium', interval: 'annual', tokenCredits: 5000 },
      { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
      { code: 'nexus_ultimate_annual', tier: 'ultimate', interval: 'annual', tokenCredits: 30000 },
    ]);
  });

  it('returns an empty array when LAGO_PLANS_CONFIG is unset', () => {
    delete process.env.LAGO_PLANS_CONFIG;
    expect(getCuratedPlans()).toEqual([]);
  });

  it('returns an empty array when LAGO_PLANS_CONFIG is invalid JSON', () => {
    process.env.LAGO_PLANS_CONFIG = 'not json';
    expect(getCuratedPlans()).toEqual([]);
  });
});

describe('getCuratedAddOns', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('parses LAGO_ADDONS_CONFIG into curated add-on entries', () => {
    process.env.LAGO_ADDONS_CONFIG = JSON.stringify([
      { code: 'starter', tokenCredits: 1000 },
      { code: 'growth', tokenCredits: 2500 },
      { code: 'power', tokenCredits: 7500 },
    ]);

    expect(getCuratedAddOns()).toEqual([
      { code: 'starter', tokenCredits: 1000 },
      { code: 'growth', tokenCredits: 2500 },
      { code: 'power', tokenCredits: 7500 },
    ]);
  });

  it('returns an empty array when LAGO_ADDONS_CONFIG is unset', () => {
    delete process.env.LAGO_ADDONS_CONFIG;
    expect(getCuratedAddOns()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/plans-config.spec.ts`
Expected: FAIL — `./plans-config` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// packages/api/src/billing/plans-config.ts
import { logger } from '@librechat/data-schemas';

export interface CuratedPlan {
  code: string;
  tier: string;
  interval: 'monthly' | 'annual';
  tokenCredits: number;
}

export interface CuratedAddOn {
  code: string;
  tokenCredits: number;
}

/**
 * `LAGO_PLANS_CONFIG` / `LAGO_ADDONS_CONFIG` are the single source of truth for
 * which Lago plans/add-ons are curated for display and how many token credits
 * each grants. This replaces the hardcoded lookup tables that used to live
 * directly in BillingWebhooks.js. Malformed or unset config degrades to an
 * empty list rather than throwing, so a misconfigured deployment shows no
 * plans instead of crashing (mirrors getBillingConfig's optional-feature
 * pattern elsewhere in this module).
 */
export function getCuratedPlans(): CuratedPlan[] {
  const raw = process.env.LAGO_PLANS_CONFIG;
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as CuratedPlan[];
  } catch (error) {
    logger.error('[plans-config] Failed to parse LAGO_PLANS_CONFIG', error);
    return [];
  }
}

export function getCuratedAddOns(): CuratedAddOn[] {
  const raw = process.env.LAGO_ADDONS_CONFIG;
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as CuratedAddOn[];
  } catch (error) {
    logger.error('[plans-config] Failed to parse LAGO_ADDONS_CONFIG', error);
    return [];
  }
}
```

Check the exact `logger` import path other files in `packages/api/src/billing/` use (e.g. `webhooks.ts`) before finalizing — match it exactly rather than assuming `@librechat/data-schemas`.

Extend `LagoPlan`/`LagoAddOn` in `types.ts` with the fields the frontend needs to render the switcher and credit info:

```ts
// additions to packages/api/src/billing/types.ts
export interface LagoPlan {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
  tier?: string;
  interval?: 'monthly' | 'annual';
  tokenCredits?: number;
}

export interface LagoAddOn {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
  tokenCredits?: number;
}
```

(Optional here because `listPlans()`/`listAddOns()` still return Lago's raw shape without this metadata — Task 2 is what merges the curated config in.)

Add to `packages/api/src/billing/index.ts`:

```ts
export * from './plans-config';
```

Add to `.env.example` and `.env`:

```
# Curated, ordered list of Lago plans to expose in the UI, and how many
# token credits each grants. Only plans listed here are shown — any other
# plan that exists in Lago is ignored by the app.
LAGO_PLANS_CONFIG=[{"code":"nexus_premium","tier":"premium","interval":"monthly","tokenCredits":5000},{"code":"nexus_premium_annual","tier":"premium","interval":"annual","tokenCredits":5000},{"code":"nexus_ultimate","tier":"ultimate","interval":"monthly","tokenCredits":30000},{"code":"nexus_ultimate_annual","tier":"ultimate","interval":"annual","tokenCredits":30000}]

# Curated list of Lago add-ons (credit top-ups) to expose, and how many
# token credits each grants.
LAGO_ADDONS_CONFIG=[{"code":"starter","tokenCredits":1000},{"code":"growth","tokenCredits":2500},{"code":"power","tokenCredits":7500}]
```

Note for implementer: the `growth`/`starter`/`power` add-on codes and the `nexus_premium`/`nexus_ultimate` plan codes are carried over from the values already used in `BillingWebhooks.js` (see Task 3) and the live-tested Lago instance — confirm against the real Lago dashboard before deploying, since `BillingWebhooks.js`'s own comment already flags that only `nexus_historical_order` currently exists as a real add-on in Lago as of 2026-07-15, and Starter/Growth/Power still need to be created there.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/plans-config.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/plans-config.ts packages/api/src/billing/plans-config.spec.ts packages/api/src/billing/types.ts packages/api/src/billing/index.ts .env.example .env
git commit -m "feat(billing): add env-configured curated plan/add-on lists"
```

---

### Task 2: Enrich and filter `getPlans`/`getTopups` with the curated config

**Files:**
- Modify: `packages/api/src/billing/lago-client.ts` (or wherever `listPlans`/`listAddOns` map Lago's response — confirm exact location before editing)
- Modify: `api/server/controllers/Billing.js`
- Test: `packages/api/src/billing/lago-client.spec.ts` (extend) and/or a new `Billing.spec.js` addition

Today `getPlans`/`getTopups` in `Billing.js` do `await lagoClient.listPlans()` / `listAddOns()` and return Lago's answer completely unfiltered — showing every plan/add-on that exists in Lago, including ones not meant for display (the concern the user raised directly: "We don't need to display all plans from Lago").

- [ ] **Step 1: Write the failing test**

Add a test asserting `getPlans`/`getTopups` filter to only curated codes, attach `tier`/`interval`/`tokenCredits` from the curated config, and preserve curated-config ordering even if Lago returns them in a different order:

```js
// addition to api/server/controllers/__tests__/Billing.spec.js (match its existing mocking style —
// re-require mocked modules inside beforeEach per this file's established jest.resetModules() pattern)
it('getPlans filters to curated plans, enriches with tier/interval/tokenCredits, and preserves curated order', async () => {
  mockListPlans.mockResolvedValue([
    { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD' },
    { code: 'some_internal_test_plan', name: 'Internal', amountCents: 100, amountCurrency: 'USD' },
    { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
  ]);
  process.env.LAGO_PLANS_CONFIG = JSON.stringify([
    { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
    { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
  ]);

  const req = {};
  const res = { json: jest.fn() };
  await getPlans(req, res);

  expect(res.json).toHaveBeenCalledWith([
    {
      code: 'nexus_premium',
      name: 'Nexus Premium',
      amountCents: 2000,
      amountCurrency: 'USD',
      tier: 'premium',
      interval: 'monthly',
      tokenCredits: 5000,
    },
    {
      code: 'nexus_ultimate',
      name: 'Nexus Ultimate',
      amountCents: 10000,
      amountCurrency: 'USD',
      tier: 'ultimate',
      interval: 'monthly',
      tokenCredits: 30000,
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/controllers/__tests__/Billing.spec.js`
Expected: FAIL — curation/enrichment isn't implemented yet, so the unfiltered Lago response (3 plans, no `tier`/`interval`/`tokenCredits`) is returned instead.

- [ ] **Step 3: Write the implementation**

```js
// api/server/controllers/Billing.js — modify getPlans/getTopups
const { getCuratedPlans, getCuratedAddOns } = require('@librechat/api');

async function getPlans(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const [lagoPlans, curated] = await Promise.all([lagoClient.listPlans(), getCuratedPlans()]);
  const lagoPlansByCode = new Map(lagoPlans.map((plan) => [plan.code, plan]));
  const plans = curated
    .map((entry) => {
      const lagoPlan = lagoPlansByCode.get(entry.code);
      if (!lagoPlan) {
        return null;
      }
      return { ...lagoPlan, tier: entry.tier, interval: entry.interval, tokenCredits: entry.tokenCredits };
    })
    .filter(Boolean);
  res.json(plans);
}

async function getTopups(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const [lagoAddOns, curated] = await Promise.all([lagoClient.listAddOns(), getCuratedAddOns()]);
  const lagoAddOnsByCode = new Map(lagoAddOns.map((addOn) => [addOn.code, addOn]));
  const topups = curated
    .map((entry) => {
      const lagoAddOn = lagoAddOnsByCode.get(entry.code);
      if (!lagoAddOn) {
        return null;
      }
      return { ...lagoAddOn, tokenCredits: entry.tokenCredits };
    })
    .filter(Boolean);
  res.json(topups);
}
```

Note: `getCuratedPlans`/`getCuratedAddOns` are synchronous (Task 1), so `Promise.all` here is only pairing them with the async Lago calls for readability — confirm this still reads cleanly to the implementer, or simplify to sequential calls if a linter flags `Promise.all` with a non-promise member.

A plan/add-on listed in `LAGO_PLANS_CONFIG`/`LAGO_ADDONS_CONFIG` that doesn't (yet) exist in Lago is silently dropped from the response rather than erroring — this matters during rollout, since Task 1's `.env.example` values already reference `starter`/`growth`/`power` add-on codes that don't exist in Lago yet per the existing `BillingWebhooks.js` TODO comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/controllers/__tests__/Billing.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/Billing.js api/server/controllers/__tests__/Billing.spec.js
git commit -m "feat(billing): curate and enrich plans/add-ons from env config"
```

---

### Task 3: Source `BillingWebhooks.js`'s credit lookups from the same curated config

**Files:**
- Modify: `api/server/controllers/BillingWebhooks.js`
- Test: existing webhook test file (locate via `Glob` for `*BillingWebhooks*` or `*webhooks*.spec.js` before editing — do not assume a filename)

Removes the duplicated, now-stale hardcoded tables (`getPlanCreditsAllowance`, `getAddOnCreditsValue`) in favor of the single source of truth from Task 1.

- [ ] **Step 1: Write the failing test**

Extend the existing webhook handler test (find it first) with a case asserting the plan-code → credits and add-on-code → credits lookups now come from `LAGO_PLANS_CONFIG`/`LAGO_ADDONS_CONFIG` rather than a hardcoded table — e.g. set `LAGO_PLANS_CONFIG` to a plan code/credit pair NOT in the old hardcoded table and confirm it resolves correctly.

- [ ] **Step 2: Run test to verify it fails**

Run the located test file. Expected: FAIL, since the hardcoded table doesn't know about the new test's plan code.

- [ ] **Step 3: Write the implementation**

```js
// api/server/controllers/BillingWebhooks.js — replace the two inline lookup tables
const { getCuratedPlans, getCuratedAddOns } = require('@librechat/api');

// inside the handleLagoWebhook deps object:
getPlanCreditsAllowance: (planCode) => {
  const match = getCuratedPlans().find((plan) => plan.code === planCode);
  return match?.tokenCredits ?? 0;
},
getAddOnCreditsValue: (addOnCode) => {
  const match = getCuratedAddOns().find((addOn) => addOn.code === addOnCode);
  return match?.tokenCredits ?? 0;
},
```

Delete the old inline `allowances`/`values` object literals and their comments entirely — they're now redundant with `.env.example`'s `LAGO_PLANS_CONFIG`/`LAGO_ADDONS_CONFIG`.

- [ ] **Step 4: Run test to verify it passes**

Run the located test file. Expected: PASS, plus re-run the full existing suite for this file to confirm no regression on the original passing cases.

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/BillingWebhooks.js <the located test file>
git commit -m "refactor(billing): source webhook credit lookups from curated plan config"
```

---

### Task 4: Real subscription lookup (fix `getSubscription`)

**Files:**
- Modify: `packages/api/src/billing/lago-client.ts` (add a method to fetch a customer's active subscription)
- Modify: `packages/api/src/billing/types.ts` (if a new response shape is needed)
- Modify: `api/server/controllers/Billing.js`
- Test: `packages/api/src/billing/lago-client.spec.ts` (extend) and `Billing.spec.js` (extend)

Today's `getSubscription` handler:

```js
async function getSubscription(req, res) {
  ...
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  res.json(user?.openidId ? { plan: 'active-lago-subscription' } : { plan: 'free' });
}
```

This is wrong: it checks whether the user *has an SSO identity at all*, not whether they have an active Lago subscription. Every SSO user — including ones who never subscribed to anything — currently reads as `'active-lago-subscription'`. This must be replaced with a real lookup against Lago.

- [ ] **Step 1: Write the failing test**

```ts
// addition to packages/api/src/billing/lago-client.spec.ts
it("fetches a customer's active subscription plan code", async () => {
  nock('http://lago.test')
    .get('/api/v1/subscriptions?external_customer_id=user-1&status[]=active')
    .reply(200, {
      subscriptions: [
        { lago_id: 'sub-1', external_customer_id: 'user-1', plan_code: 'nexus_premium', status: 'active' },
      ],
    });

  const client = createLagoClient(config);
  const subscription = await client.getActiveSubscription('user-1');

  expect(subscription?.planCode).toBe('nexus_premium');
});

it('returns null when the customer has no active subscription', async () => {
  nock('http://lago.test')
    .get('/api/v1/subscriptions?external_customer_id=user-2&status[]=active')
    .reply(200, { subscriptions: [] });

  const client = createLagoClient(config);
  const subscription = await client.getActiveSubscription('user-2');

  expect(subscription).toBeNull();
});
```

**Verified against the real Lago docs (`https://getlago.com/docs/api-reference/subscriptions/get-all.md`):** `GET /api/v1/subscriptions` accepts `external_customer_id` and `status[]` query params exactly as hypothesized above, and the response shape is `{ subscriptions: [{ plan_code, status, ... }] }`. No changes needed from the original draft.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: FAIL — `getActiveSubscription` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// addition to packages/api/src/billing/lago-client.ts
async function getActiveSubscription(externalCustomerId: string): Promise<{ planCode: string } | null> {
  const { data } = await http.get('/api/v1/subscriptions', {
    params: { external_customer_id: externalCustomerId, 'status[]': 'active' },
  });
  const subscription = data.subscriptions?.[0];
  return subscription ? { planCode: subscription.plan_code } : null;
}
```

Wire `getActiveSubscription` into the object `createLagoClient` returns, alongside the existing methods.

Update `Billing.js`:

```js
async function getSubscription(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.json({ plan: 'free' });
  }
  const subscription = await lagoClient.getActiveSubscription(user.openidId);
  res.json({ plan: subscription?.planCode ?? 'free' });
}
```

This changes `TBillingSubscription.plan`'s real-world values from the old placeholder strings (`'free' | 'active-lago-subscription'`) to `'free'` or an actual curated plan code (e.g. `'nexus_premium'`). Task 8 in Part B updates `SubscriptionStatusItem` to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts` then `cd api && npx jest server/controllers/__tests__/Billing.spec.js`
Expected: PASS

- [ ] **Step 5: Manual verification against the real Lago instance**

Given Step 1's endpoint shape is unverified, this task is not done until confirmed live: call `GET /api/billing/subscription` as a real logged-in test user with an active subscription in the live Lago instance, and confirm the returned `plan` matches their actual plan code (not `'free'`, not a crash). This mirrors the live-testing discipline used for the original checkout/webhook work.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/billing/lago-client.ts packages/api/src/billing/lago-client.spec.ts api/server/controllers/Billing.js api/server/controllers/__tests__/Billing.spec.js
git commit -m "fix(billing): look up the user's real active Lago subscription"
```

---

## Part B — Frontend: Billing as its own Settings tab

### Task 5: Add a `BILLING` tab value

**Files:**
- Modify: `packages/data-provider/src/config.ts` (`SettingsTabValues` enum)
- Rebuild: `npm run build:data-provider`

- [ ] **Step 1: No test** — this is a single enum member addition; behavior is exercised by Task 6/7's changes.
- [ ] **Step 2: N/A**
- [ ] **Step 3: Add the enum value**

```ts
// packages/data-provider/src/config.ts, alongside the existing SettingsTabValues members
/**
 * Tab for Billing Settings
 */
BILLING = 'billing',
```

Add it after `ACCOUNT` in the enum declaration (enum member order doesn't affect the UI tab order — that's driven entirely by `TABS` array order in Task 6 — but keeping it near `ACCOUNT` keeps the enum readable).

- [ ] **Step 4: Rebuild data-provider**

Run: `npm run build:data-provider` from the repo root.

- [ ] **Step 5: Commit**

```bash
git add packages/data-provider/src/config.ts
git commit -m "feat(billing): add a dedicated Billing settings tab value"
```

---

### Task 6: Give Billing its own top-level tab (after Data & Privacy, before Account)

**Files:**
- Modify: `client/src/components/Nav/Settings/types.ts`

- [ ] **Step 1: No test** — `types.ts` is a config/type declaration file; behavior is exercised by manual verification in Task 7.
- [ ] **Step 2: N/A**
- [ ] **Step 3: Update the file**

Add `SettingsTabValues.BILLING` to the `SettingsTab` union:

```ts
export type SettingsTab =
  | SettingsTabValues.GENERAL
  | SettingsTabValues.CHAT
  | SettingsTabValues.SPEECH
  | SettingsTabValues.DATA
  | SettingsTabValues.BILLING
  | SettingsTabValues.ACCOUNT
  | SettingsTabValues.ABOUT;
```

Remove `'billing'` from `ACCOUNT`'s `sections` in the `TABS` array (it moves to its own tab, not a subsection of Account anymore) and insert a new `BILLING` tab entry between `DATA` and `ACCOUNT`:

```ts
  {
    id: SettingsTabValues.DATA,
    // ...unchanged...
  },
  {
    id: SettingsTabValues.BILLING,
    labelKey: 'com_nav_setting_billing',
    icon: createElement(CreditCard, { className: 'icon-sm', 'aria-hidden': true }),
    sections: [{ id: 'billing', labelKey: 'com_ui_settings_section_billing' }],
  },
  {
    id: SettingsTabValues.ACCOUNT,
    labelKey: 'com_nav_setting_account',
    icon: createElement(UserIcon),
    sections: [
      { id: 'profile', labelKey: 'com_ui_settings_section_profile' },
      { id: 'security', labelKey: 'com_ui_settings_section_security' },
      { id: 'danger', labelKey: 'com_ui_settings_section_danger_zone', danger: true },
    ],
  },
```

Add the `CreditCard` import from `lucide-react` alongside the existing `MessageSquare, Info` import. Verify `CreditCard` is the icon this codebase already uses elsewhere for billing/credits (grep for existing `CreditCard` usage in `client/src` first) — fall back to a different lucide icon only if `CreditCard` isn't already established, to keep icon choices consistent with the rest of the app.

Reuse the existing `com_ui_settings_section_billing` translation key for the section label (already added when Billing lived under Account) and add one new key, `com_nav_setting_billing`, for the tab label itself (Task 9).

- [ ] **Step 4: N/A** (verified in Task 7 alongside the registry move)
- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/Settings/types.ts
git commit -m "feat(billing): give Billing its own top-level Settings tab"
```

---

### Task 7: Move billing entries out of Account into the new Billing tab

**Files:**
- Modify: `client/src/components/Nav/Settings/registry.tsx`

- [ ] **Step 1: No new test** — matches Task 12 of the frontend plan's established precedent (registry entries have no dedicated test; covered by the underlying components' own tests plus manual verification).
- [ ] **Step 2: N/A**
- [ ] **Step 3: Move the entries**

Change `tab: ACCOUNT` to `tab: BILLING` for all five entries currently under the `// Account · Billing` comment (`tokenCredits`, `autoRefill`, `subscriptionStatus`, `plans`, `topups`), and move that whole block out from between `security`/`danger` in the Account group to its own place in the array (position within the array doesn't affect the Sidebar order — tab order is driven by `TABS` in `types.ts` — but keep the five entries grouped together for readability, right after the `DATA` tab's entries and before the remaining `ACCOUNT` entries, matching the file's existing "group by tab, comment each subsection" convention). Update the `// Account · Billing` comment to `// Billing`.

```typescript
const { GENERAL, CHAT, SPEECH, DATA, BILLING, ACCOUNT, ABOUT } = SettingsTabValues;
```

- [ ] **Step 4: Manual verification**

Run the dev servers, open Settings, and confirm: a new "Billing" tab appears between "Data & Privacy" and "Account" in the sidebar, containing Token balance, Auto Refill, Current Plan, Available Plans, and Buy Credits — and that the Account tab no longer shows any billing content.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/Settings/registry.tsx
git commit -m "feat(billing): move billing settings into their own tab"
```

---

### Task 8: Reflect the real subscription plan code in `SubscriptionStatusItem`

**Files:**
- Modify: `client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx`
- Modify: `client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx`
- Modify: `client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx` (mark the user's current plan)
- Modify: `client/src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx`
- Modify: `client/src/components/Nav/Settings/BillingControls.tsx` (`Plans` container passes the real current plan through)

Part A, Task 4 changes `TBillingSubscription.plan` from the placeholder `'free' | 'active-lago-subscription'` to `'free'` or a real curated plan code (e.g. `'nexus_premium'`). The Settings UI needs updating to match, and — per the user's "users will be managing their existing plan with option to upgrade" ask — `PlanList` should mark whichever plan the user is currently on instead of showing an identical "Subscribe" button for it.

- [ ] **Step 1: Write the failing tests**

Update `SubscriptionStatusItem.spec.tsx`: replace the `'active-lago-subscription'` test case with one passing a real plan code (e.g. `plan="nexus_premium"`) and asserting a human-readable label is shown (not the raw code) — the component will need a `planName` lookup or simply display the raw code if no curated display-name mapping is available client-side; decide based on whether `TBillingSubscription` should also carry a display name (see Step 3 note below) rather than just the code.

Update `PlanList.spec.tsx`: add a `currentPlanCode` prop and a test asserting the matching plan renders a disabled "Current Plan" indicator instead of an active "Subscribe" button, while other plans still show "Subscribe".

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing --testTimeout=30000 --coverage=false`
Expected: FAIL on the new/changed assertions.

- [ ] **Step 3: Write the implementation**

Simplest correct option: since `PlanList` already receives the full curated `plans` array (each with `code`/`name`), `SubscriptionStatusItem` and `Plans` can both resolve a human-readable name by matching `data?.plan` against that same list client-side — no backend response shape change needed. Wire `Plans` (in `BillingControls.tsx`) to pass `useGetBillingSubscriptionQuery()`'s `data?.plan` down to `PlanList` as `currentPlanCode`, and have `PlanList` compare `plan.code === currentPlanCode` to render a disabled "Current Plan" state instead of the Subscribe button for that entry.

For `SubscriptionStatusItem`, either keep displaying the raw plan code (simplest, ships correctly, just less pretty — e.g. "nexus_premium" instead of "Nexus Premium") or thread the curated plans list into it the same way. Recommend starting with the raw code and revisiting only if it reads poorly in the live UI — avoid adding a second lookup path for the same data this early.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing --testTimeout=30000 --coverage=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/ client/src/components/Nav/Settings/BillingControls.tsx
git commit -m "feat(billing): show the user's real current plan and mark it in the plan list"
```

---

### Task 9: Translation keys for the new tab

**Files:**
- Modify: `client/src/locales/en/translation.json`

- [ ] **Step 1: No test** — translation JSON has no runtime logic.
- [ ] **Step 2: N/A**
- [ ] **Step 3: Add the key**

```json
"com_nav_setting_billing": "Billing",
```

Add it alongside the other `com_nav_setting_*` tab-label keys (e.g. near `com_nav_setting_account`).

- [ ] **Step 4: Manual verification** — covered by Task 7's manual check.
- [ ] **Step 5: Commit**

```bash
git add client/src/locales/en/translation.json
git commit -m "feat(billing): add the Billing tab translation key"
```

---

## Part C — Public plan pages (`/plans`, `/plans/:planCode`)

### Task 10: `PlanIntervalSwitcher` component (monthly/annual toggle)

**Files:**
- Create: `client/src/components/Plans/PlanIntervalSwitcher.tsx`
- Test: `client/src/components/Plans/__tests__/PlanIntervalSwitcher.spec.tsx`

A small, reusable tab-style toggle between `'monthly'` and `'annual'`, used by both new routes.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Plans/__tests__/PlanIntervalSwitcher.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import PlanIntervalSwitcher from '../PlanIntervalSwitcher';

describe('PlanIntervalSwitcher', () => {
  it('renders Monthly and Annual tabs', () => {
    const { getByRole } = render(<PlanIntervalSwitcher interval="monthly" onChange={jest.fn()} />);
    expect(getByRole('tab', { name: 'Monthly' })).toBeInTheDocument();
    expect(getByRole('tab', { name: 'Annual' })).toBeInTheDocument();
  });

  it('marks the active interval as selected', () => {
    const { getByRole } = render(<PlanIntervalSwitcher interval="annual" onChange={jest.fn()} />);
    expect(getByRole('tab', { name: 'Annual' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked interval', () => {
    const onChange = jest.fn();
    const { getByRole } = render(<PlanIntervalSwitcher interval="monthly" onChange={onChange} />);
    fireEvent.click(getByRole('tab', { name: 'Annual' }));
    expect(onChange).toHaveBeenCalledWith('annual');
  });
});
```

Check whether `@librechat/client` already exports a tab-list primitive (grep for an existing `Tabs`/`TabList` component) before hand-rolling one with plain buttons — reuse it if present, for visual consistency with the rest of the app.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Plans/__tests__/PlanIntervalSwitcher.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Plans/PlanIntervalSwitcher.tsx
import { useLocalize } from '~/hooks';

type Interval = 'monthly' | 'annual';

type PlanIntervalSwitcherProps = {
  interval: Interval;
  onChange: (interval: Interval) => void;
};

export default function PlanIntervalSwitcher({ interval, onChange }: PlanIntervalSwitcherProps) {
  const localize = useLocalize();

  return (
    <div role="tablist" className="inline-flex rounded-lg border border-border-light p-1">
      {(['monthly', 'annual'] as const).map((value) => (
        <button
          key={value}
          role="tab"
          type="button"
          aria-selected={interval === value}
          className={
            interval === value
              ? 'rounded-md bg-surface-active px-4 py-1.5 text-sm font-medium text-text-primary'
              : 'rounded-md px-4 py-1.5 text-sm font-medium text-text-secondary'
          }
          onClick={() => onChange(value)}
        >
          {localize(value === 'monthly' ? 'com_ui_billing_interval_monthly' : 'com_ui_billing_interval_annual')}
        </button>
      ))}
    </div>
  );
}
```

Adjust class names to whatever `@librechat/client`'s actual surface/border tokens are if the reused-component check in Step 1 turns up an existing tab primitive to build on instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Plans/__tests__/PlanIntervalSwitcher.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Plans/PlanIntervalSwitcher.tsx client/src/components/Plans/__tests__/PlanIntervalSwitcher.spec.tsx
git commit -m "feat(billing): add monthly/annual plan interval switcher"
```

---

### Task 11: `PlansView` page (backs both `/plans` and `/plans/:planCode`, auth required)

**Files:**
- Create: `client/src/components/Plans/PlansView.tsx`
- Test: `client/src/components/Plans/__tests__/PlansView.spec.tsx`

Renders the curated plan list grouped by `tier`, filtered to the selected interval via `PlanIntervalSwitcher`. When given a `planCode` param (the `/plans/:planCode` case), narrows to just that plan's tier. This component only ever renders for an authenticated user — Task 12's route wrapper gates access with `useAuthRedirect`, mirroring `ChatRoute`'s existing pattern — so `PlansView` itself has no logged-out state to handle: Subscribe always calls the checkout mutation directly.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Plans/__tests__/PlansView.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import {
  useGetBillingPlansQuery,
  useBillingCheckoutMutation,
} from '~/data-provider';
import PlansView from '../PlansView';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetBillingPlansQuery: jest.fn(),
  useBillingCheckoutMutation: jest.fn(),
}));

const mockPlansQuery = useGetBillingPlansQuery as jest.Mock;
const mockCheckoutMutation = useBillingCheckoutMutation as jest.Mock;

const PLANS = [
  { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
  { code: 'nexus_premium_annual', name: 'Nexus Premium (Annual)', amountCents: 20000, amountCurrency: 'USD', tier: 'premium', interval: 'annual', tokenCredits: 5000 },
  { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
  { code: 'nexus_ultimate_annual', name: 'Nexus Ultimate (Annual)', amountCents: 100000, amountCurrency: 'USD', tier: 'ultimate', interval: 'annual', tokenCredits: 30000 },
];

describe('PlansView', () => {
  beforeEach(() => {
    mockPlansQuery.mockReturnValue({ data: PLANS, isLoading: false, isError: false });
    mockCheckoutMutation.mockReturnValue({ mutateAsync: jest.fn(), isLoading: false });
  });

  it('shows only monthly plans by default', () => {
    const { getByText, queryByText } = render(<PlansView />);
    expect(getByText('Nexus Premium')).toBeInTheDocument();
    expect(getByText('Nexus Ultimate')).toBeInTheDocument();
    expect(queryByText('Nexus Premium (Annual)')).not.toBeInTheDocument();
  });

  it('switches to annual plans when the Annual tab is clicked', () => {
    const { getByRole, getByText, queryByText } = render(<PlansView />);
    fireEvent.click(getByRole('tab', { name: 'Annual' }));
    expect(getByText('Nexus Premium (Annual)')).toBeInTheDocument();
    expect(queryByText('Nexus Premium')).not.toBeInTheDocument();
  });

  it('narrows to a single tier when planCode is provided', () => {
    const { getByText, queryByText } = render(<PlansView planCode="nexus_ultimate" />);
    expect(getByText('Nexus Ultimate')).toBeInTheDocument();
    expect(queryByText('Nexus Premium')).not.toBeInTheDocument();
  });

  it('still offers the annual switch when narrowed to a single tier', () => {
    const { getByRole, getByText } = render(<PlansView planCode="nexus_ultimate" />);
    fireEvent.click(getByRole('tab', { name: 'Annual' }));
    expect(getByText('Nexus Ultimate (Annual)')).toBeInTheDocument();
  });

  it('calls checkout directly on Subscribe (no auth branching — this page is already gated)', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ url: 'https://stripe.example/checkout/abc' });
    mockCheckoutMutation.mockReturnValue({ mutateAsync, isLoading: false });
    const { getAllByRole } = render(<PlansView planCode="nexus_ultimate" />);
    fireEvent.click(getAllByRole('button', { name: 'Subscribe' })[0]);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('nexus_ultimate'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Plans/__tests__/PlansView.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Plans/PlansView.tsx
import { useState } from 'react';
import { useGetBillingPlansQuery, useBillingCheckoutMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';
import PlanIntervalSwitcher from './PlanIntervalSwitcher';

type PlansViewProps = {
  planCode?: string;
};

export default function PlansView({ planCode }: PlansViewProps) {
  const localize = useLocalize();
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const { data: plans, isLoading, isError } = useGetBillingPlansQuery();
  const { mutateAsync: checkout, isLoading: isSubscribing } = useBillingCheckoutMutation();

  const tier = planCode ? plans?.find((plan) => plan.code === planCode)?.tier : undefined;

  const visiblePlans = (plans ?? []).filter((plan) => {
    if (plan.interval !== interval) {
      return false;
    }
    return tier ? plan.tier === tier : true;
  });

  const handleSubscribe = async (code: string) => {
    const { url } = await checkout(code);
    window.location.href = url;
  };

  if (isLoading) {
    return <div className="text-sm text-text-secondary">{localize('com_ui_billing_plans_loading')}</div>;
  }

  if (isError) {
    return <div className="text-sm text-red-500">{localize('com_ui_billing_plans_error')}</div>;
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-12">
      <PlanIntervalSwitcher interval={interval} onChange={setInterval} />
      <div className="grid w-full gap-4 sm:grid-cols-2">
        {visiblePlans.map((plan) => (
          <div key={plan.code} className="rounded-xl border border-border-light p-6 text-center">
            <div className="text-lg font-semibold text-text-primary">{plan.name}</div>
            <div className="mt-2 text-2xl font-bold text-text-primary">
              {(plan.amountCents / 100).toFixed(2)} {plan.amountCurrency}
            </div>
            {plan.tokenCredits !== undefined ? (
              <div className="mt-1 text-sm text-text-secondary">
                {plan.tokenCredits.toLocaleString()} {localize('com_ui_billing_credits_per_period')}
              </div>
            ) : null}
            <button
              type="button"
              disabled={isSubscribing}
              onClick={() => handleSubscribe(plan.code)}
              className="mt-4 w-full rounded-lg bg-surface-submit px-4 py-2 text-sm font-medium text-white"
            >
              {localize('com_ui_billing_subscribe')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Before finalizing, check whether `@librechat/client`'s `Button` component (used throughout the Settings billing components in the frontend plan) should be reused here instead of a raw `<button>` — likely yes, for visual consistency; the raw markup above is a starting sketch, not a mandate. Replace with `<Button>` matching its established prop signature (`size`, `disabled`, `onClick`) if so.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Plans/__tests__/PlansView.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Plans/PlansView.tsx client/src/components/Plans/__tests__/PlansView.spec.tsx
git commit -m "feat(billing): add plans view backing the /plans direct-link routes"
```

---

### Task 12: Wire `/plans` and `/plans/:planCode` routes (auth-gated)

**Files:**
- Create: `client/src/routes/Plans.tsx` (route wrapper: auth-gates via `useAuthRedirect`, reads `:planCode` from params)
- Modify: `client/src/routes/index.tsx`

These routes require a logged-in session — a visitor without one is redirected to `/login` and never sees plan content. `ChatRoute.tsx` is the existing precedent for this exact pattern: call `useAuthRedirect()` (which navigates to `/login` after a short delay if unauthenticated) and `return null` until `isAuthenticated` is true. The route is nested under the same protected tree as `/agents`, `/skills`, `/projects` (children of `Root`), not a top-level entry like `share/:shareId` — that entry is a deliberately public route and is the wrong model to copy now that this plan page is auth-required.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/routes/__tests__/Plans.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import { useParams } from 'react-router-dom';
import useAuthRedirect from '../useAuthRedirect';
import Plans from '../Plans';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn(),
}));
jest.mock('../useAuthRedirect');
jest.mock('~/components/Plans/PlansView', () => ({
  __esModule: true,
  default: ({ planCode }: { planCode?: string }) => <div>PlansView:{planCode ?? 'all'}</div>,
}));

const mockUseParams = useParams as jest.Mock;
const mockUseAuthRedirect = useAuthRedirect as jest.Mock;

describe('Plans route', () => {
  it('renders nothing while unauthenticated (redirect in flight)', () => {
    mockUseParams.mockReturnValue({});
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: false });
    const { container } = render(<Plans />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders PlansView with no planCode for the bare /plans route once authenticated', () => {
    mockUseParams.mockReturnValue({});
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: true });
    const { getByText } = render(<Plans />);
    expect(getByText('PlansView:all')).toBeInTheDocument();
  });

  it('passes planCode through for /plans/:planCode once authenticated', () => {
    mockUseParams.mockReturnValue({ planCode: 'nexus_ultimate' });
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: true });
    const { getByText } = render(<Plans />);
    expect(getByText('PlansView:nexus_ultimate')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/routes/__tests__/Plans.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — `../Plans` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/routes/Plans.tsx
import { useParams } from 'react-router-dom';
import PlansView from '~/components/Plans/PlansView';
import useAuthRedirect from './useAuthRedirect';

export default function Plans() {
  const { planCode } = useParams();
  const { isAuthenticated } = useAuthRedirect();

  if (!isAuthenticated) {
    return null;
  }

  return <PlansView planCode={planCode} />;
}
```

Add to `client/src/routes/index.tsx`, as a new child of the protected `Root` route (alongside `agents`, `skills`, `projects` — **not** alongside the top-level `share/:shareId` entry):

```tsx
import Plans from './Plans';

// ...inside the Root route's children array:
{
  path: 'plans/:planCode?',
  element: <Plans />,
},
```

An optional `:planCode?` param on a single route (rather than two separate entries for `plans` and `plans/:planCode`) keeps this to one router entry — `useParams().planCode` is simply `undefined` for the bare `/plans` case, which is exactly the prop shape `PlansView` already expects. No `errorElement` needed here since it's a child of `Root`, which is already covered by the outer route tree's `errorElement`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/routes/__tests__/Plans.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (3 tests)

- [ ] **Step 5: Manual verification**

With both dev servers running:
1. Visit `http://localhost:3090/plans` while logged out — confirm it redirects to `/login`, and after logging in, lands back on `/plans` showing the monthly plan cards with a working Annual toggle.
2. Visit `http://localhost:3090/plans/nexus_ultimate` while logged in — confirm only the Ultimate tier's monthly/annual cards render, and Subscribe redirects straight to the real Lago/Stripe checkout URL.

- [ ] **Step 6: Commit**

```bash
git add client/src/routes/Plans.tsx client/src/routes/index.tsx client/src/routes/__tests__/Plans.spec.tsx
git commit -m "feat(billing): add auth-gated /plans and /plans/:planCode routes"
```

---

## Self-Review Notes

**Spec coverage against the user's ask:**
- "Add billing after Data & Privacy so it has its own section": Tasks 5-7.
- "How do we link plans to limits — env file or what": Task 1 (env-configured curation, per the user's explicit choice), replacing the old hardcoded tables in Tasks 2-3.
- "We don't need to display all plans from Lago": Task 2 (filter to curated codes only).
- "Direct link which we can directly use to send clients from our website", `/plans` with monthly/annual switcher, `/plans/:planCode` single-plan: Tasks 10-12.
- "Users will be managing their existing plan with option to upgrade": Task 8 (real subscription lookup + current-plan marking in the list) plus the pre-existing `Plans`/`Topups` Settings containers from the frontend plan.
- "Free users get no plan / limits for free users": confirmed as already-existing `balance.startBalance` behavior, no new code — called out explicitly at the top of this plan rather than silently assumed.

**Resolved during execution:** Task 4's `getActiveSubscription` endpoint/query-param shape was confirmed against Lago's published API docs (`GET /api/v1/subscriptions?external_customer_id=...&status[]=active`) before implementation — matched the original hypothesis exactly, no changes needed. Step 5's live check against the real running instance is still worth doing post-deploy as a final sanity check, same as any other integration point.

**Deliberately deferred, not silently dropped:**
- `SubscriptionStatusItem` showing a real display name instead of a raw plan code (Task 8) — starting with the raw code to avoid a second lookup path; revisit if it reads poorly live.
- Whether `@librechat/client` already has a tab-list primitive worth reusing instead of the hand-rolled `PlanIntervalSwitcher` buttons (Task 10) — left as an implementer check rather than assumed either way.

**Updated after initial review:** the user clarified the `/plans` pages should require login rather than being public marketing pages. This removed the need for `PublicPlansView`'s logged-out branch, `buildLoginRedirectUrl` handling inside the component, and intent-storage to resume checkout post-login — `PlansView` (renamed from `PublicPlansView`) now assumes it only ever renders authenticated, and `Plans.tsx` gates access with `useAuthRedirect()` exactly like the existing `ChatRoute`, nested under the same protected route tree as `/agents`/`/skills`/`/projects` rather than the public `share/:shareId` pattern.
