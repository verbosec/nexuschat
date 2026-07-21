# Billing: Subscription Management (Invoices, Renewal, Cancel, Richer Plan Comparison)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Settings → Billing tab closer to the Claude-style subscription management UI the user referenced — current plan + billing interval + renewal date, an invoices table (date/total/status/view), a cancel-plan flow, and a richer "Adjust plan" page with per-tier feature bullets and "save X% annually" messaging — all built on top of the existing Lago integration (design: `docs/superpowers/specs/2026-07-05-lago-billing-infrastructure-design.md`; prior plans: `2026-07-07-lago-billing-backend.md`, `2026-07-16-lago-billing-frontend.md`, `2026-07-16-lago-billing-plans-and-links.md`).

**Research done before writing this plan (confirmed against Lago's published API docs):**
- **Invoices** — `GET /api/v1/invoices?external_customer_id=...` returns everything the table needs: `issuing_date`, `total_amount_cents`, `status`/`payment_status`, and a `file_url` that links directly to the invoice PDF (covers the "View" action with zero extra work).
- **Cancel plan** — `DELETE /api/v1/subscriptions/{external_id}` is a real, documented endpoint. It operates on the *subscription's* `external_id` (not the customer's), which our current `getActiveSubscription` lookup doesn't capture yet — this plan extends it to.
- **Payment method** ("Visa •••• 4817", update card) — confirmed **not available** via Lago. The customer object explicitly does not store synced card details, and Lago's own self-serve Customer Portal docs don't mention payment-method management either. Lago does expose `provider_customer_id` (the Stripe customer ID), so this is solvable by integrating directly with Stripe's API — but that's a new dependency separate from the existing Lago connection.
- **Renewal date** — not a plain field on the subscription API response (Lago's own portal appears to compute/display one internally, but it isn't exposed raw).

**Decisions made with the user before writing this plan:**
- Payment method display/update is **out of scope for this plan** (no direct Stripe integration yet) — ship everything else now, revisit payment methods later.
- Renewal date is **computed client-independent, on the backend**, from the subscription's `started_at` plus the plan's billing interval — not fetched from a dedicated Lago field.

---

## Part A — Backend

### Task 1: Extend `getActiveSubscription` with `externalId` and `startedAt`

**Files:**
- Modify: `packages/api/src/billing/lago-client.ts`
- Modify: `packages/api/src/billing/lago-client.spec.ts`

Cancellation (Task 3) needs the subscription's own `external_id`, and renewal-date computation (Task 2) needs `started_at`. Both are already present in the same `GET /api/v1/subscriptions` response `getActiveSubscription` already calls — this only widens what we extract from it.

- [ ] **Step 1: Write the failing test**

Update the existing `"fetches a customer's active subscription plan code"` test in `lago-client.spec.ts` to also assert the new fields:

```ts
it("fetches a customer's active subscription details", async () => {
  nock('http://lago.test')
    .get('/api/v1/subscriptions')
    .query({ external_customer_id: 'user-1', 'status[]': 'active' })
    .reply(200, {
      subscriptions: [
        {
          lago_id: 'sub-1',
          external_id: 'sub-ext-1',
          external_customer_id: 'user-1',
          plan_code: 'nexus_premium',
          status: 'active',
          started_at: '2026-06-11T00:00:00Z',
        },
      ],
    });

  const client = createLagoClient(config);
  const subscription = await client.getActiveSubscription('user-1');

  expect(subscription).toEqual({
    planCode: 'nexus_premium',
    externalId: 'sub-ext-1',
    startedAt: '2026-06-11T00:00:00Z',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: FAIL — the current implementation only returns `{ planCode }`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/api/src/billing/lago-client.ts — replace getActiveSubscription's return shape
async function getActiveSubscription(
  externalCustomerId: string,
): Promise<{ planCode: string; externalId: string; startedAt: string } | null> {
  try {
    const { data } = await http.get('/api/v1/subscriptions', {
      params: { external_customer_id: externalCustomerId, 'status[]': 'active' },
    });
    const subscription = data.subscriptions?.[0];
    return subscription
      ? {
          planCode: subscription.plan_code,
          externalId: subscription.external_id,
          startedAt: subscription.started_at,
        }
      : null;
  } catch (error) {
    logger.error('[lago-client] getActiveSubscription failed', error);
    throw new Error(toErrorMessage(error));
  }
}
```

Update the `LagoClient` interface's `getActiveSubscription` signature to match.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: PASS

- [ ] **Step 5: Add a `terminateSubscription` method (needed by Task 3)**

Write the failing test first:

```ts
it('terminates a subscription by its external_id', async () => {
  nock('http://lago.test').delete('/api/v1/subscriptions/sub-ext-1').reply(200, {
    subscription: { external_id: 'sub-ext-1', status: 'terminated' },
  });

  const client = createLagoClient(config);
  await expect(client.terminateSubscription('sub-ext-1')).resolves.not.toThrow();
});
```

Then implement:

```ts
async function terminateSubscription(externalId: string): Promise<void> {
  try {
    await http.delete(`/api/v1/subscriptions/${externalId}`);
  } catch (error) {
    logger.error('[lago-client] terminateSubscription failed', error);
    throw new Error(toErrorMessage(error));
  }
}
```

Add `terminateSubscription` to the `LagoClient` interface and the object `createLagoClient` returns.

- [ ] **Step 6: Add a `listInvoices` method (needed by Task 4)**

Write the failing test first:

```ts
it("lists a customer's invoices", async () => {
  nock('http://lago.test')
    .get('/api/v1/invoices')
    .query({ external_customer_id: 'user-1' })
    .reply(200, {
      invoices: [
        {
          lago_id: 'inv-1',
          issuing_date: '2026-07-11',
          total_amount_cents: 2000,
          currency: 'USD',
          status: 'finalized',
          payment_status: 'succeeded',
          file_url: 'https://billing.example/invoices/inv-1.pdf',
        },
      ],
    });

  const client = createLagoClient(config);
  const invoices = await client.listInvoices('user-1');

  expect(invoices).toEqual([
    {
      id: 'inv-1',
      issuingDate: '2026-07-11',
      totalCents: 2000,
      currency: 'USD',
      status: 'finalized',
      paymentStatus: 'succeeded',
      fileUrl: 'https://billing.example/invoices/inv-1.pdf',
    },
  ]);
});
```

Then implement:

```ts
async function listInvoices(externalCustomerId: string): Promise<LagoInvoice[]> {
  try {
    const { data } = await http.get('/api/v1/invoices', {
      params: { external_customer_id: externalCustomerId },
    });
    return (data.invoices ?? []).map(
      (invoice: {
        lago_id: string;
        issuing_date: string;
        total_amount_cents: number;
        currency: string;
        status: string;
        payment_status: string;
        file_url: string;
      }) => ({
        id: invoice.lago_id,
        issuingDate: invoice.issuing_date,
        totalCents: invoice.total_amount_cents,
        currency: invoice.currency,
        status: invoice.status,
        paymentStatus: invoice.payment_status,
        fileUrl: invoice.file_url,
      }),
    );
  } catch (error) {
    logger.error('[lago-client] listInvoices failed', error);
    throw new Error(toErrorMessage(error));
  }
}
```

Add `LagoInvoice` to `packages/api/src/billing/types.ts`:

```ts
export interface LagoInvoice {
  id: string;
  issuingDate: string;
  totalCents: number;
  currency: string;
  status: string;
  paymentStatus: string;
  fileUrl: string;
}
```

Add `listInvoices` to the `LagoClient` interface and returned object.

- [ ] **Step 7: Run the full lago-client suite**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: PASS (all cases, old and new)

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/billing/lago-client.ts packages/api/src/billing/lago-client.spec.ts packages/api/src/billing/types.ts
git commit -m "feat(billing): add subscription termination and invoice listing to the Lago client"
```

---

### Task 2: Renewal-date computation utility

**Files:**
- Create: `packages/api/src/billing/renewal.ts`
- Test: `packages/api/src/billing/renewal.spec.ts`
- Modify: `packages/api/src/billing/index.ts`

A small, pure function: given a subscription's `startedAt` and the plan's `interval` (`'monthly' | 'annual'`), return the next renewal date — the next `startedAt`-anniversary (day-of-month for monthly, day-of-year for annual) that is still in the future relative to "now."

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/src/billing/renewal.spec.ts
import { computeNextRenewalDate } from './renewal';

describe('computeNextRenewalDate', () => {
  it('advances a monthly subscription to next month when today is past this month\'s anniversary', () => {
    const startedAt = '2026-01-11T00:00:00Z';
    const now = new Date('2026-07-15T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'monthly', now)).toEqual(
      new Date('2026-08-11T00:00:00Z'),
    );
  });

  it('keeps this month\'s anniversary when today is before it', () => {
    const startedAt = '2026-01-11T00:00:00Z';
    const now = new Date('2026-07-05T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'monthly', now)).toEqual(
      new Date('2026-07-11T00:00:00Z'),
    );
  });

  it('advances an annual subscription to next year when today is past this year\'s anniversary', () => {
    const startedAt = '2025-08-11T00:00:00Z';
    const now = new Date('2026-07-15T00:00:00Z');
    expect(computeNextRenewalDate(startedAt, 'annual', now)).toEqual(
      new Date('2026-08-11T00:00:00Z'),
    );
  });

  it('returns null when startedAt is missing or interval is unrecognized', () => {
    expect(computeNextRenewalDate(undefined, 'monthly', new Date())).toBeNull();
    expect(computeNextRenewalDate('2026-01-11T00:00:00Z', undefined, new Date())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/renewal.spec.ts`
Expected: FAIL — `./renewal` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// packages/api/src/billing/renewal.ts
export function computeNextRenewalDate(
  startedAt: string | undefined,
  interval: 'monthly' | 'annual' | undefined,
  now: Date,
): Date | null {
  if (!startedAt || !interval) {
    return null;
  }

  const started = new Date(startedAt);
  const candidate = new Date(started);
  const step = interval === 'monthly' ? 1 : 12;

  while (candidate.getTime() <= now.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + step);
  }

  return candidate;
}
```

Add to `packages/api/src/billing/index.ts`:

```ts
export * from './renewal';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/renewal.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/renewal.ts packages/api/src/billing/renewal.spec.ts packages/api/src/billing/index.ts
git commit -m "feat(billing): compute subscription renewal dates from started_at and interval"
```

---

### Task 3: `getSubscription` returns renewal info; add `DELETE /api/billing/subscription`

**Files:**
- Modify: `api/server/controllers/Billing.js`
- Modify: `api/server/controllers/Billing.spec.js`
- Modify: `api/server/routes/billing/index.js`

- [ ] **Step 1: Write the failing tests**

Update `getSubscription`'s existing "returns the real active plan code" test to assert the enriched shape, and add a cancel test:

```js
it('getSubscription returns the plan, interval, and computed renewal date for a subscribed user', async () => {
  configureBilling();
  const { findUser } = require('~/models');
  findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
  createLagoClient.mockReturnValue({
    listPlans: jest.fn(),
    listAddOns: jest.fn(),
    getActiveSubscription: jest.fn().mockResolvedValue({
      planCode: 'nexus_premium',
      externalId: 'sub-ext-1',
      startedAt: '2026-06-11T00:00:00Z',
    }),
    terminateSubscription: jest.fn(),
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
  });
  getCuratedPlans.mockReturnValue([
    { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
  ]);
  const { getSubscription } = require('./Billing');
  const req = { user: { id: 'user-1' } };
  const res = buildRes();

  await getSubscription(req, res);

  expect(res.json).toHaveBeenCalledWith({
    plan: 'nexus_premium',
    interval: 'monthly',
    renewalDate: expect.any(String),
  });
});

it('deleteSubscription terminates the active subscription and returns success', async () => {
  configureBilling();
  const { findUser } = require('~/models');
  findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
  const terminateSubscription = jest.fn().mockResolvedValue(undefined);
  createLagoClient.mockReturnValue({
    listPlans: jest.fn(),
    listAddOns: jest.fn(),
    getActiveSubscription: jest.fn().mockResolvedValue({
      planCode: 'nexus_premium',
      externalId: 'sub-ext-1',
      startedAt: '2026-06-11T00:00:00Z',
    }),
    terminateSubscription,
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
  });
  const { deleteSubscription } = require('./Billing');
  const req = { user: { id: 'user-1' } };
  const res = buildRes();

  await deleteSubscription(req, res);

  expect(terminateSubscription).toHaveBeenCalledWith('sub-ext-1');
  expect(res.json).toHaveBeenCalledWith({ success: true });
});

it('deleteSubscription returns 404 when there is no active subscription to cancel', async () => {
  configureBilling();
  const { findUser } = require('~/models');
  findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
  createLagoClient.mockReturnValue({
    listPlans: jest.fn(),
    listAddOns: jest.fn(),
    getActiveSubscription: jest.fn().mockResolvedValue(null),
    terminateSubscription: jest.fn(),
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
  });
  const { deleteSubscription } = require('./Billing');
  const req = { user: { id: 'user-1' } };
  const res = buildRes();

  await deleteSubscription(req, res);

  expect(res.status).toHaveBeenCalledWith(404);
});
```

Note: the existing `getSubscription` tests for the free-plan and no-active-subscription cases need their expected `res.json` payloads updated too — those should become `{ plan: 'free', interval: null, renewalDate: null }` for consistency (confirm the exact null-vs-undefined shape reads cleanly against Task 5's frontend consumer before finalizing).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: FAIL — `getSubscription`'s current shape is just `{ plan }`, and `deleteSubscription` doesn't exist.

- [ ] **Step 3: Write the implementation**

```js
// api/server/controllers/Billing.js
const { getCuratedPlans, getCuratedAddOns, computeNextRenewalDate } = require('@librechat/api');

async function getSubscription(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.json({ plan: 'free', interval: null, renewalDate: null });
  }
  const subscription = await lagoClient.getActiveSubscription(user.openidId);
  if (!subscription) {
    return res.json({ plan: 'free', interval: null, renewalDate: null });
  }
  const curatedPlan = getCuratedPlans().find((plan) => plan.code === subscription.planCode);
  const renewalDate = computeNextRenewalDate(
    subscription.startedAt,
    curatedPlan?.interval,
    new Date(),
  );
  res.json({
    plan: subscription.planCode,
    interval: curatedPlan?.interval ?? null,
    renewalDate: renewalDate ? renewalDate.toISOString() : null,
  });
}

async function deleteSubscription(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.status(404).json({ error: 'No active subscription to cancel' });
  }
  const subscription = await lagoClient.getActiveSubscription(user.openidId);
  if (!subscription) {
    return res.status(404).json({ error: 'No active subscription to cancel' });
  }
  await lagoClient.terminateSubscription(subscription.externalId);
  res.json({ success: true });
}
```

Add `deleteSubscription` to `module.exports`.

Wire the route in `api/server/routes/billing/index.js` — confirmed existing style is `router.get('/subscription', requireJwtAuth, getSubscription);`, so add:

```js
router.delete('/subscription', requireJwtAuth, deleteSubscription);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/Billing.js api/server/controllers/Billing.spec.js api/server/routes/billing/index.js
git commit -m "feat(billing): return renewal info from getSubscription and add subscription cancellation"
```

---

### Task 4: `GET /api/billing/invoices`

**Files:**
- Modify: `api/server/controllers/Billing.js`
- Modify: `api/server/controllers/Billing.spec.js`
- Modify: `api/server/routes/billing/index.js`

- [ ] **Step 1: Write the failing test**

```js
it('getInvoices returns the mapped invoice list for the current user', async () => {
  configureBilling();
  const { findUser } = require('~/models');
  findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
  createLagoClient.mockReturnValue({
    listPlans: jest.fn(),
    listAddOns: jest.fn(),
    getActiveSubscription: jest.fn(),
    terminateSubscription: jest.fn(),
    listInvoices: jest.fn().mockResolvedValue([
      {
        id: 'inv-1',
        issuingDate: '2026-07-11',
        totalCents: 2000,
        currency: 'USD',
        status: 'finalized',
        paymentStatus: 'succeeded',
        fileUrl: 'https://billing.example/invoices/inv-1.pdf',
      },
    ]),
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
  });
  const { getInvoices } = require('./Billing');
  const req = { user: { id: 'user-1' } };
  const res = buildRes();

  await getInvoices(req, res);

  expect(res.json).toHaveBeenCalledWith([
    {
      id: 'inv-1',
      issuingDate: '2026-07-11',
      totalCents: 2000,
      currency: 'USD',
      status: 'finalized',
      paymentStatus: 'succeeded',
      fileUrl: 'https://billing.example/invoices/inv-1.pdf',
    },
  ]);
});

it('getInvoices returns an empty list for a free-tier user with no Lago customer', async () => {
  configureBilling();
  const { findUser } = require('~/models');
  findUser.mockResolvedValue({});
  const { getInvoices } = require('./Billing');
  const req = { user: { id: 'user-1' } };
  const res = buildRes();

  await getInvoices(req, res);

  expect(res.json).toHaveBeenCalledWith([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: FAIL — `getInvoices` doesn't exist.

- [ ] **Step 3: Write the implementation**

```js
async function getInvoices(req, res) {
  if (!requireBillingConfigured(res)) {
    return;
  }
  const user = await findUser({ _id: req.user.id }, ['openidId']);
  if (!user?.openidId) {
    return res.json([]);
  }
  const invoices = await lagoClient.listInvoices(user.openidId);
  res.json(invoices);
}
```

Add to `module.exports`. Wire the route:

```js
router.get('/invoices', requireJwtAuth, getInvoices);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/Billing.js api/server/controllers/Billing.spec.js api/server/routes/billing/index.js
git commit -m "feat(billing): add invoice listing endpoint"
```

---

## Part B — Frontend

### Task 5: Data-provider types, endpoints, keys, data-service, hooks

**Files:**
- Modify: `packages/data-provider/src/types/queries.ts`
- Modify: `packages/data-provider/src/api-endpoints.ts` (+ spec)
- Modify: `packages/data-provider/src/keys.ts`
- Modify: `packages/data-provider/src/data-service.ts` (+ spec)
- Modify: `client/src/data-provider/Billing/queries.ts` (+ test)
- Modify: `client/src/data-provider/Billing/mutations.ts` (+ test)

Follows the exact same pattern established in the earlier frontend billing plan (`2026-07-16-lago-billing-frontend.md`, Tasks 1-7) — extend each of those same files rather than introducing new ones.

- [ ] **Step 1-4 (TDD per file, mirroring the earlier plan's Tasks 1-7 exactly):**

`packages/data-provider/src/types/queries.ts`:

```ts
export type TBillingSubscription = {
  plan: string;
  interval: 'monthly' | 'annual' | null;
  renewalDate: string | null;
};

export type TBillingInvoice = {
  id: string;
  issuingDate: string;
  totalCents: number;
  currency: string;
  status: string;
  paymentStatus: string;
  fileUrl: string;
};
```

(This replaces the old, narrower `TBillingSubscription` shape from the earlier plan — a breaking but intentional change; Task 8 updates every consumer.)

`packages/data-provider/src/api-endpoints.ts`:

```ts
export const billingInvoices = () => `${BASE_URL}/api/billing/invoices`;
```

(`billingSubscription()` already exists and is reused for both GET and the new DELETE.)

`packages/data-provider/src/keys.ts`:

```ts
billingInvoices = 'billingInvoices',
```

(add to `QueryKeys`; no new `MutationKeys` entry needed — cancellation reuses a `useMutation` keyed off `MutationKeys.billingCheckout`'s sibling pattern, see below)

```ts
billingCancelSubscription = 'billingCancelSubscription',
```

(add this one to `MutationKeys`)

`packages/data-provider/src/data-service.ts`:

```ts
export function getBillingInvoices(): Promise<q.TBillingInvoice[]> {
  return request.get(endpoints.billingInvoices());
}

export function deleteBillingSubscription(): Promise<{ success: boolean }> {
  return request.delete(endpoints.billingSubscription());
}
```

`client/src/data-provider/Billing/queries.ts` — add `useGetBillingInvoicesQuery`, matching `useGetBillingSubscriptionQuery`'s exact shape (`refetchOnWindowFocus: true`, `refetchOnReconnect: true` — invoices should feel fresh, same rationale as subscription status).

`client/src/data-provider/Billing/mutations.ts` — add `useCancelSubscriptionMutation`:

```ts
export const useCancelSubscriptionMutation = (): UseMutationResult<
  { success: boolean },
  unknown,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation([MutationKeys.billingCancelSubscription], {
    mutationFn: () => dataService.deleteBillingSubscription(),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.billingSubscription]);
    },
  });
};
```

(invalidating `billingSubscription` on success ensures `SubscriptionStatusItem` immediately reflects `'free'` after a successful cancellation, without a manual refetch)

- [ ] **Tests:** one test per new/changed function, following the exact structure of the equivalent tests in the earlier frontend plan (`api-endpoints.spec.ts`, `data-service.spec.ts`, `Billing/__tests__/queries.spec.tsx`, `Billing/__tests__/mutations.spec.tsx`) — write each failing test first, confirm red, implement, confirm green.

- [ ] **Commit:**

```bash
git add packages/data-provider/src client/src/data-provider/Billing
git commit -m "feat(billing): add invoice listing and subscription cancellation to data-provider"
```

---

### Task 6: `InvoiceList` component

**Files:**
- Create: `client/src/components/Nav/SettingsTabs/Billing/InvoiceList.tsx`
- Test: `client/src/components/Nav/SettingsTabs/Billing/__tests__/InvoiceList.spec.tsx`

A presentational table: Date / Total / Status / Actions, matching `PlanList`/`TopupList`'s loading/error/empty conventions exactly.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/__tests__/InvoiceList.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import InvoiceList from '../InvoiceList';

const INVOICES = [
  {
    id: 'inv-1',
    issuingDate: '2026-07-11',
    totalCents: 2000,
    currency: 'USD',
    status: 'finalized',
    paymentStatus: 'succeeded',
    fileUrl: 'https://billing.example/invoices/inv-1.pdf',
  },
  {
    id: 'inv-2',
    issuingDate: '2026-06-09',
    totalCents: 2000,
    currency: 'USD',
    status: 'finalized',
    paymentStatus: 'failed',
    fileUrl: 'https://billing.example/invoices/inv-2.pdf',
  },
];

describe('InvoiceList', () => {
  it('shows a loading spinner while invoices are fetching', () => {
    const { getByTestId } = render(<InvoiceList invoices={undefined} isLoading isError={false} />);
    expect(getByTestId('billing-invoices-loading')).toBeInTheDocument();
  });

  it('shows an error message when the invoices query fails', () => {
    const { getByText } = render(<InvoiceList invoices={undefined} isLoading={false} isError />);
    expect(getByText('Unable to load invoices.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no invoices yet', () => {
    const { getByText } = render(<InvoiceList invoices={[]} isLoading={false} isError={false} />);
    expect(getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('renders a row per invoice with date, total, status, and a View link', () => {
    const { getByText, getAllByRole } = render(
      <InvoiceList invoices={INVOICES} isLoading={false} isError={false} />,
    );
    expect(getByText('20.00 USD')).toBeInTheDocument();
    expect(getByText('Paid')).toBeInTheDocument();
    expect(getByText('Failed')).toBeInTheDocument();
    const viewLinks = getAllByRole('link', { name: 'View' });
    expect(viewLinks).toHaveLength(2);
    expect(viewLinks[0]).toHaveAttribute('href', 'https://billing.example/invoices/inv-1.pdf');
    expect(viewLinks[0]).toHaveAttribute('target', '_blank');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/InvoiceList.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — component doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/InvoiceList.tsx
import { Spinner } from '@librechat/client';
import type { TBillingInvoice } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type InvoiceListProps = {
  invoices: TBillingInvoice[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

const PAYMENT_STATUS_LABEL_KEYS: Record<string, string> = {
  succeeded: 'com_ui_billing_invoice_status_paid',
  failed: 'com_ui_billing_invoice_status_failed',
  pending: 'com_ui_billing_invoice_status_pending',
};

export default function InvoiceList({ invoices, isLoading, isError }: InvoiceListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div
        data-testid="billing-invoices-loading"
        className="flex items-center justify-center rounded-xl border border-border-light py-12"
      >
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-red-500">{localize('com_ui_billing_invoices_error')}</div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="text-sm text-text-secondary">{localize('com_ui_billing_invoices_empty')}</div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-text-secondary">
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_date')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_total')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_status')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_actions')}</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr key={invoice.id} className="border-t border-border-light">
            <td className="py-2 text-text-primary">
              {new Date(invoice.issuingDate).toLocaleDateString()}
            </td>
            <td className="py-2 text-text-primary">
              {(invoice.totalCents / 100).toFixed(2)} {invoice.currency}
            </td>
            <td className="py-2 text-text-primary">
              {localize(
                PAYMENT_STATUS_LABEL_KEYS[invoice.paymentStatus] ??
                  'com_ui_billing_invoice_status_pending',
              )}
            </td>
            <td className="py-2">
              <a
                href={invoice.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {localize('com_ui_billing_invoice_view')}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Add translation keys: `com_ui_billing_invoices_error` ("Unable to load invoices."), `com_ui_billing_invoices_empty` ("No invoices yet."), `com_ui_billing_invoice_date` ("Date"), `com_ui_billing_invoice_total` ("Total"), `com_ui_billing_invoice_status` ("Status"), `com_ui_billing_invoice_actions` ("Actions"), `com_ui_billing_invoice_view` ("View"), `com_ui_billing_invoice_status_paid` ("Paid"), `com_ui_billing_invoice_status_failed` ("Failed"), `com_ui_billing_invoice_status_pending` ("Pending").

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/InvoiceList.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/InvoiceList.tsx client/src/components/Nav/SettingsTabs/Billing/__tests__/InvoiceList.spec.tsx client/src/locales/en/translation.json
git commit -m "feat(billing): add InvoiceList component"
```

---

### Task 7: Enrich `SubscriptionStatusItem` with interval + renewal date, and add a cancel-plan dialog

**Files:**
- Modify: `client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx`
- Modify: `client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx`
- Modify: `client/src/components/Nav/Settings/BillingControls.tsx`

- [ ] **Step 1: Write the failing tests**

Update `SubscriptionStatusItem.spec.tsx`'s props to the new `TBillingSubscription` shape (`{ plan, interval, renewalDate }` instead of a bare string) and add cases for the renewal-date text and the cancel button/dialog:

```tsx
it('shows the plan, interval, and renewal date for an active subscription', () => {
  const { getByText } = render(
    <SubscriptionStatusItem
      subscription={{ plan: 'nexus_premium', interval: 'monthly', renewalDate: '2026-08-11T00:00:00.000Z' }}
      isLoading={false}
      isError={false}
      onCancel={jest.fn()}
      isCancelling={false}
    />,
  );
  expect(getByText('Active subscription')).toBeInTheDocument();
  expect(getByText(/Monthly/)).toBeInTheDocument();
  expect(getByText(/renew/i)).toBeInTheDocument();
});

it('shows a Cancel plan button only for an active (non-free) subscription', () => {
  const { getByRole, rerender } = render(
    <SubscriptionStatusItem
      subscription={{ plan: 'nexus_premium', interval: 'monthly', renewalDate: null }}
      isLoading={false}
      isError={false}
      onCancel={jest.fn()}
      isCancelling={false}
    />,
  );
  expect(getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
});

it('calls onCancel after the confirm dialog is accepted', async () => {
  const onCancel = jest.fn();
  const { getByRole, findByRole } = render(
    <SubscriptionStatusItem
      subscription={{ plan: 'nexus_premium', interval: 'monthly', renewalDate: null }}
      isLoading={false}
      isError={false}
      onCancel={onCancel}
      isCancelling={false}
    />,
  );
  fireEvent.click(getByRole('button', { name: 'Cancel plan' }));
  const confirmButton = await findByRole('button', { name: 'Confirm cancellation' });
  fireEvent.click(confirmButton);
  expect(onCancel).toHaveBeenCalled();
});
```

(Import `fireEvent` alongside the existing `render` import at the top of the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — current props/shape don't match.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx
import { useState } from 'react';
import {
  Label,
  InfoHoverCard,
  ESide,
  Spinner,
  Button,
  OGDialog,
  OGDialogTrigger,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import type { TBillingSubscription } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type SubscriptionStatusItemProps = {
  subscription: TBillingSubscription | undefined;
  isLoading: boolean;
  isError: boolean;
  onCancel: () => void;
  isCancelling: boolean;
};

export default function SubscriptionStatusItem({
  subscription,
  isLoading,
  isError,
  onCancel,
  isCancelling,
}: SubscriptionStatusItemProps) {
  const localize = useLocalize();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <div data-testid="billing-subscription-loading" className="flex items-center gap-2">
        <Spinner className="h-4 w-4 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-red-500">{localize('com_ui_billing_subscription_error')}</div>
    );
  }

  const plan = subscription?.plan;
  const isFree = !plan || plan === 'free';
  const label = isFree
    ? localize('com_ui_billing_plan_free')
    : localize('com_ui_billing_plan_active');
  const intervalLabel =
    subscription?.interval === 'monthly'
      ? localize('com_ui_billing_interval_monthly')
      : subscription?.interval === 'annual'
        ? localize('com_ui_billing_interval_annual')
        : null;
  const renewalText = subscription?.renewalDate
    ? localize('com_ui_billing_renews_on', {
        date: new Date(subscription.renewalDate).toLocaleDateString(),
      })
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Label className="font-light">{localize('com_ui_settings_label_subscription_status')}</Label>
          <InfoHoverCard side={ESide.Bottom} text={localize('com_ui_billing_subscription_info')} />
        </div>
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200" role="note">
          {label}
          {intervalLabel ? ` · ${intervalLabel}` : ''}
        </span>
      </div>
      {renewalText ? (
        <div className="text-xs text-text-secondary">{renewalText}</div>
      ) : null}
      {!isFree && (
        <OGDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <OGDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="w-fit">
              {localize('com_ui_billing_cancel_plan')}
            </Button>
          </OGDialogTrigger>
          <OGDialogContent className="w-11/12 max-w-md">
            <OGDialogHeader>
              <OGDialogTitle>{localize('com_ui_billing_cancel_confirm_title')}</OGDialogTitle>
            </OGDialogHeader>
            <p className="text-sm text-text-secondary">
              {localize('com_ui_billing_cancel_confirm_body')}
            </p>
            <Button
              variant="destructive"
              disabled={isCancelling}
              onClick={() => {
                onCancel();
                setConfirmOpen(false);
              }}
            >
              {localize('com_ui_billing_cancel_confirm_button')}
            </Button>
          </OGDialogContent>
        </OGDialog>
      )}
    </div>
  );
}
```

Confirmed `useLocalize`'s interpolation syntax against existing usage (e.g. `localize('com_citation_more_details', { label: domain })` with translation string `"More details about {{label}}"`) — `localize('com_ui_billing_renews_on', { date: ... })` above matches this exactly.

Add translation keys: `com_ui_billing_renews_on` ("Renews on {{date}}"), `com_ui_billing_cancel_plan` ("Cancel plan"), `com_ui_billing_cancel_confirm_title` ("Cancel your subscription?"), `com_ui_billing_cancel_confirm_body` ("You'll keep access until the end of your current billing period. This can't be undone from here — you'll need to resubscribe to regain access to paid features."), `com_ui_billing_cancel_confirm_button` ("Confirm cancellation").

Update `BillingControls.tsx`'s `SubscriptionStatus` container:

```tsx
export function SubscriptionStatus() {
  const { data, isLoading, isError } = useGetBillingSubscriptionQuery();
  const { mutate: cancelSubscription, isLoading: isCancelling } = useCancelSubscriptionMutation();
  return (
    <SubscriptionStatusItem
      subscription={data}
      isLoading={isLoading}
      isError={isError}
      onCancel={cancelSubscription}
      isCancelling={isCancelling}
    />
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing --testTimeout=30000 --coverage=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx client/src/components/Nav/Settings/BillingControls.tsx client/src/locales/en/translation.json
git commit -m "feat(billing): show renewal date and add a cancel-plan flow"
```

---

### Task 8: Wire `InvoiceList` into Settings, update every `TBillingSubscription` consumer

**Files:**
- Modify: `client/src/components/Nav/Settings/BillingControls.tsx`
- Modify: `client/src/components/Nav/Settings/registry.tsx`
- Modify: `client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx` (uses `currentPlanCode` from `subscription?.plan`, no shape change needed there)
- Modify: `client/src/components/Plans/PlansView.tsx` (same — already reads `.plan` off the query result; confirm it still compiles against the new shape)

- [ ] **Step 1: No new test** — matches the established precedent for container/registry wiring (Task 11/12 of the frontend plan).

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the `Invoices` container and registry entry**

```tsx
// addition to BillingControls.tsx
import InvoiceList from '../SettingsTabs/Billing/InvoiceList';
import { useGetBillingInvoicesQuery } from '~/data-provider';

export function Invoices() {
  const { data: invoices, isLoading, isError } = useGetBillingInvoicesQuery();
  return <InvoiceList invoices={invoices} isLoading={isLoading} isError={isError} />;
}
```

Add to `registry.tsx`, right after the `topups` entry:

```tsx
{
  id: 'invoices',
  tab: BILLING,
  section: 'billing',
  labelKey: 'com_ui_settings_label_invoices',
  Component: Invoices,
},
```

Add `Invoices` to the import from `./BillingControls`, and the translation key `com_ui_settings_label_invoices` ("Invoices").

Double-check `Plans` (the container passing `currentPlanCode={subscription?.plan}`) still type-checks — `subscription` is now `TBillingSubscription | undefined` with a `.plan: string` field unchanged, so this should need no code change, only a typecheck confirmation.

- [ ] **Step 4: Manual verification**

Run the dev servers, open Settings → Billing, confirm: Current Plan now shows interval + renewal date + a working Cancel plan button (with confirm dialog), followed by Available Plans (still marking the current plan), Buy Credits, and a new Invoices table at the bottom.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/Settings/BillingControls.tsx client/src/components/Nav/Settings/registry.tsx client/src/locales/en/translation.json
git commit -m "feat(billing): wire the invoices table into Settings"
```

---

### Task 9: Richer `/plans` copy — feature bullets and "billed annually" framing

**Files:**
- Modify: `client/src/components/Plans/PlansView.tsx`
- Modify: `client/src/components/Plans/__tests__/PlansView.spec.tsx`
- Modify: `.env.example`, `.env` (extend `LAGO_PLANS_CONFIG` — see below)
- Modify: `packages/api/src/billing/plans-config.ts` (+ spec)
- Modify: `api/server/controllers/Billing.js` (+ spec) — pass through the new fields
- Modify: `packages/data-provider/src/types/queries.ts` (`TBillingPlan` gains `features?: string[]`)

The Claude mockup's per-tier bullet list ("Everything in Free and: ...") is content, not derived data — it needs to live in the same curated config that already drives which plans show up. Extends `CuratedPlan`/`LAGO_PLANS_CONFIG` with an optional `features: string[]`.

- [ ] **Step 1: Write the failing tests**

Extend `plans-config.spec.ts`'s parsing test to include a `features` array in the input/output fixtures. Extend `Billing.spec.js`'s `getPlans` enrichment test to assert `features` passes through onto each returned plan. Extend `PlansView.spec.tsx` with:

```tsx
it('renders each plan\'s feature bullets when provided', () => {
  const { getByText } = render(
    <PlansView />,
  );
  // assuming a plan fixture in this test file is updated to include:
  // features: ['Higher usage limits', 'Priority support']
  expect(getByText('Higher usage limits')).toBeInTheDocument();
  expect(getByText('Priority support')).toBeInTheDocument();
});

it('shows a savings note on the annual tab when an annual plan costs less per year than 12x the monthly price', () => {
  const { getByRole, getByText } = render(<PlansView />);
  fireEvent.click(getByRole('tab', { name: 'Annual' }));
  expect(getByText(/save/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run each affected suite (`plans-config.spec.ts`, `Billing.spec.js`, `PlansView.spec.tsx`) and confirm the new assertions fail while everything else still passes.

- [ ] **Step 3: Write the implementation**

`plans-config.ts`: widen `CuratedPlan` with `features?: string[]`.

`.env.example`/`.env`: extend each plan entry in `LAGO_PLANS_CONFIG` with a `features` array, e.g.:

```json
{"code":"nexus_premium","tier":"premium","interval":"monthly","tokenCredits":5000,"features":["Everything in Free","Higher usage limits","Priority support"]}
```

`Billing.js`'s `getPlans`: include `features: entry.features` in the enriched object returned per plan.

`TBillingPlan` (data-provider): add `features?: string[]`.

`PlansView.tsx`: render `plan.features` as a bullet list under the price, and compute a savings note for the annual tab by comparing an annual plan's `amountCents` against `12 * ` its sibling monthly plan's `amountCents` (matched by `tier`):

```tsx
const monthlyEquivalent = (plan: TBillingPlan) =>
  visiblePlans === undefined
    ? null
    : (plans ?? []).find((p) => p.tier === plan.tier && p.interval === 'monthly');

// inside the annual card's render, when interval === 'annual':
const monthly = (plans ?? []).find((p) => p.tier === plan.tier && p.interval === 'monthly');
const savingsPercent =
  monthly && monthly.amountCents > 0
    ? Math.round((1 - plan.amountCents / (monthly.amountCents * 12)) * 100)
    : null;
```

Render `{savingsPercent}% {localize('com_ui_billing_annual_savings')}` under the price when `savingsPercent` is a positive number. Add the `com_ui_billing_annual_savings` translation key ("savings vs. monthly").

- [ ] **Step 4: Run tests to verify they pass**

Run all three affected suites again.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/plans-config.ts packages/api/src/billing/plans-config.spec.ts api/server/controllers/Billing.js api/server/controllers/Billing.spec.js packages/data-provider/src/types/queries.ts client/src/components/Plans/PlansView.tsx client/src/components/Plans/__tests__/PlansView.spec.tsx .env.example .env
git commit -m "feat(billing): add per-plan feature bullets and annual savings messaging"
```

---

## Self-Review Notes

**Coverage against the user's mockup:**
- "Pro plan / Monthly" + renewal date: Tasks 2, 3, 7.
- Invoices table (date/total/status/View): Tasks 1 (Step 6), 4, 6, 8.
- "Cancel plan": Tasks 1 (Step 5), 3, 7.
- "Adjust plan" richer comparison page: Task 9 (extends the existing `/plans` page from the prior plan rather than building a new one).
- Payment method ("Visa •••• 4817", update card): **explicitly out of scope**, per the user's own choice — no code in this plan touches it.

**Breaking change flagged, not silently introduced:** `TBillingSubscription`'s shape changes from `{ plan: string }` to `{ plan, interval, renewalDate }`. Task 8 explicitly re-checks every existing consumer (`PlanList`'s `currentPlanCode`, `PlansView`) rather than assuming they still compile.

**Deliberately simple, not a gap:** renewal-date computation (Task 2) assumes no manual proration/plan-change history — it purely projects forward from `started_at` on a fixed cadence. This matches the user's own choice ("compute it ourselves") and is called out as an assumption rather than hidden.

**Resolved during planning, not left as guesses:** `useLocalize`'s interpolation syntax (`{{date}}`, confirmed against existing `com_citation_more_details` usage) and the router registration style in `api/server/routes/billing/index.js` (confirmed: `router.get('/subscription', requireJwtAuth, getSubscription);` is the existing pattern, all new routes in Tasks 3-4 follow it exactly) — both checked against the real files before this plan was finalized.
