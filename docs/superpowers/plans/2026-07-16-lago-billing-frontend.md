# Lago Billing Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frontend billing UI (plan picker, credit top-up picker, current-plan status) that lets a user actually reach and use the backend billing API built in `docs/superpowers/plans/2026-07-07-lago-billing-backend.md` — extending the existing (currently backend-only) Account → Billing settings section, per `docs/superpowers/specs/2026-07-05-lago-billing-infrastructure-design.md`.

**Architecture:** Follows this codebase's established data flow exactly: `packages/data-provider` (shared types, endpoint URLs, `dataService` functions) → `client/src/data-provider/Billing/` (React Query hooks) → new presentational components under `client/src/components/Nav/SettingsTabs/Billing/` (mirroring the existing `SettingsTabs/Balance/` directory: `TokenCreditsItem.tsx`, `AutoRefillSettings.tsx`) → new container components added directly to the existing `client/src/components/Nav/Settings/BillingControls.tsx` (which already exports `TokenCredits`/`AutoRefill` the same way) → wired into the existing `client/src/components/Nav/Settings/registry.tsx` (Account tab, `billing` section, alongside those same existing entries). No new routes or pages, and no new top-level component directory under `Settings/` — everything follows the container/presentational split this feature already established.

**Tech Stack:** TypeScript, React, `@tanstack/react-query`, Recoil (`store.queriesEnabled` gating, matching every existing query hook), `@librechat/client` (`Button`, `Spinner`, `Label`, `InfoHoverCard`), Jest + React Testing Library (`test/layout-test-utils`).

---

## Scope

**In scope:**
- List available plans (from the already-working `GET /api/billing/plans`) and let the user click "Subscribe" → redirect to the returned Stripe checkout URL.
- List available credit top-ups (`GET /api/billing/topups`) and let the user click "Buy" → redirect to checkout.
- Show current plan status (`GET /api/billing/subscription`) using its existing simple response shape.
- Loading, empty, and error states for all three (per this project's testing philosophy: cover loading/success/error, not just the happy path).

**Explicitly out of scope** (matches the backend spec's own scope boundaries):
- Invoice history (no backend endpoint for it yet).
- Improving `GET /api/billing/subscription`'s response to show the real plan name/details from Lago — it currently returns only `{ plan: 'free' }` or `{ plan: 'active-lago-subscription' }`. Making that richer means adding a new Lago API call we haven't tested live yet (risk of the same trial-and-error we hit with `checkout_url`). Flagged as a follow-up, not blocking this plan — the UI will just display "Free" vs. "Active subscription" for now.
- Teams/Business seat UI, since the backend doesn't support seat-based billing yet either.
- A custom post-checkout success/cancel page — Stripe/Lago's own default post-payment page handles that today; our `createCheckoutSession` call doesn't pass `success_url`/`cancel_url` and checkout already works end-to-end without them (confirmed live).

---

## File Structure

**New files:**
- `client/src/data-provider/Billing/queries.ts` — `useGetBillingPlansQuery`, `useGetBillingTopupsQuery`, `useGetBillingSubscriptionQuery`
- `client/src/data-provider/Billing/mutations.ts` — `useBillingCheckoutMutation`, `useBillingTopupCheckoutMutation`
- `client/src/data-provider/Billing/index.ts` — barrel export
- `client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx` — presentational: lists plans + a Subscribe button per plan, calls an `onSubscribe(planCode)` prop
- `client/src/components/Nav/SettingsTabs/Billing/TopupList.tsx` — presentational: lists add-ons + a Buy button per add-on, calls an `onBuy(addOnCode)` prop
- `client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx` — presentational: renders the current plan label
- `client/src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx`
- `client/src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx`
- `client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx`

**Modified files:**
- `packages/data-provider/src/types/queries.ts` — add `TBillingPlan`, `TBillingTopup`, `TBillingSubscription`, `TBillingCheckoutResponse` types
- `packages/data-provider/src/api-endpoints.ts` — add `billingPlans`, `billingTopups`, `billingSubscription`, `billingCheckout`, `billingTopupCheckout` endpoint functions
- `packages/data-provider/src/keys.ts` — add `QueryKeys.billingPlans`/`billingTopups`/`billingSubscription`, `MutationKeys.billingCheckout`/`billingTopupCheckout`
- `packages/data-provider/src/data-service.ts` — add `getBillingPlans`, `getBillingTopups`, `getBillingSubscription`, `postBillingCheckout`, `postBillingTopupCheckout`
- `client/src/data-provider/index.ts` — add `export * from './Billing';`
- `client/src/components/Nav/Settings/BillingControls.tsx` — add three new container components (`Plans`, `Topups`, `SubscriptionStatus`) alongside the existing `TokenCredits`/`AutoRefill`, each wiring a query/mutation hook to its presentational counterpart, exactly like `TokenCredits` wraps `TokenCreditsItem`
- `client/src/components/Nav/Settings/registry.tsx` — extend the existing `import { TokenCredits, AutoRefill } from './BillingControls';` line and add 3 new `SettingEntry` objects under `tab: ACCOUNT, section: 'billing'`
- `client/src/locales/en/translation.json` — add new `com_ui_billing_*` keys

---

## Task 1: Data-provider types

**Files:**
- Modify: `packages/data-provider/src/types/queries.ts`
- Test: `packages/data-provider/src/types/queries.spec.ts`

- [ ] **Step 1: Write the failing test**

Check whether `packages/data-provider/src/types/queries.ts` has any existing `.spec.ts` sibling testing type-only exports (types can't usually be tested directly with runtime assertions) — if not, skip a dedicated type-test and instead let Task 4's `data-service.spec.ts` be the first thing that exercises these types by importing them. Do not invent a placeholder test for pure type declarations with no runtime behavior.

- [ ] **Step 2: N/A (no runtime behavior to fail)**

- [ ] **Step 3: Add the types**

Add to `packages/data-provider/src/types/queries.ts`:

```typescript
export type TBillingPlan = {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
};

export type TBillingTopup = {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
};

export type TBillingSubscription = {
  plan: string;
};

export type TBillingCheckoutResponse = {
  url: string;
};
```

- [ ] **Step 4: N/A**

- [ ] **Step 5: Commit**

```bash
git add packages/data-provider/src/types/queries.ts
git commit -m "feat(billing): add billing response types"
```

---

## Task 2: API endpoint constants

**Files:**
- Modify: `packages/data-provider/src/api-endpoints.ts`
- Test: `packages/data-provider/src/api-endpoints.spec.ts`

- [ ] **Step 1: Write the failing test**

First check whether `api-endpoints.ts` already has a `.spec.ts` sibling — if one exists, add to it; if not, create it fresh (this file is simple enough that a first test file here is reasonable, matching how `balance` and similar single-purpose endpoint functions are trivially testable):

```typescript
// packages/data-provider/src/api-endpoints.spec.ts (create if it doesn't already exist; otherwise add these cases to the existing file)
import { billingPlans, billingTopups, billingSubscription, billingCheckout, billingTopupCheckout } from './api-endpoints';

describe('billing endpoints', () => {
  it('builds the correct URLs', () => {
    expect(billingPlans()).toMatch(/\/api\/billing\/plans$/);
    expect(billingTopups()).toMatch(/\/api\/billing\/topups$/);
    expect(billingSubscription()).toMatch(/\/api\/billing\/subscription$/);
    expect(billingCheckout()).toMatch(/\/api\/billing\/checkout$/);
    expect(billingTopupCheckout()).toMatch(/\/api\/billing\/topups\/checkout$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-provider && npx jest src/api-endpoints.spec.ts`
Expected: FAIL — `billingPlans` etc. are not exported yet.

- [ ] **Step 3: Add the endpoint functions**

Add to `packages/data-provider/src/api-endpoints.ts`, near the existing `balance` function:

```typescript
export const billingPlans = () => `${BASE_URL}/api/billing/plans`;

export const billingTopups = () => `${BASE_URL}/api/billing/topups`;

export const billingSubscription = () => `${BASE_URL}/api/billing/subscription`;

export const billingCheckout = () => `${BASE_URL}/api/billing/checkout`;

export const billingTopupCheckout = () => `${BASE_URL}/api/billing/topups/checkout`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-provider && npx jest src/api-endpoints.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/data-provider/src/api-endpoints.ts packages/data-provider/src/api-endpoints.spec.ts
git commit -m "feat(billing): add billing API endpoint constants"
```

---

## Task 3: QueryKeys and MutationKeys

**Files:**
- Modify: `packages/data-provider/src/keys.ts`

- [ ] **Step 1: No dedicated test** — these are plain string enum members with no independent runtime behavior; they're exercised for real by Task 5/6's query/mutation hook tests, which would fail to import a non-existent key. Adding a standalone test asserting `QueryKeys.billingPlans === 'billingPlans'` would be exactly the kind of low-value, tautological test this project's philosophy (real logic over checking constants) argues against.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the keys**

Add to the `QueryKeys` enum in `packages/data-provider/src/keys.ts` (near `balance = 'balance'`):

```typescript
  billingPlans = 'billingPlans',
  billingTopups = 'billingTopups',
  billingSubscription = 'billingSubscription',
```

Add to the `MutationKeys` enum (near the other mutation keys):

```typescript
  billingCheckout = 'billingCheckout',
  billingTopupCheckout = 'billingTopupCheckout',
```

- [ ] **Step 4: N/A**

- [ ] **Step 5: Commit**

```bash
git add packages/data-provider/src/keys.ts
git commit -m "feat(billing): add billing query/mutation keys"
```

---

## Task 4: data-service functions

**Files:**
- Modify: `packages/data-provider/src/data-service.ts`
- Test: `packages/data-provider/src/data-service.spec.ts`

- [ ] **Step 1: Write the failing test**

First check whether `data-service.ts` already has a `.spec.ts` sibling covering similar `request.get`/`request.post` wrapper functions (e.g. one testing `getUserBalance`) and match its exact mocking style for `request`. If none exists, write:

```typescript
// packages/data-provider/src/data-service.spec.ts (add to existing file if one covers this module; adjust the request mock below to match its established pattern if different)
jest.mock('./request', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import request from './request';
import {
  getBillingPlans,
  getBillingTopups,
  getBillingSubscription,
  postBillingCheckout,
  postBillingTopupCheckout,
} from './data-service';

describe('billing data-service functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getBillingPlans calls GET /api/billing/plans', async () => {
    (request.get as jest.Mock).mockResolvedValue([{ code: 'nexus_premium' }]);
    const result = await getBillingPlans();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/plans'));
    expect(result).toEqual([{ code: 'nexus_premium' }]);
  });

  it('getBillingTopups calls GET /api/billing/topups', async () => {
    (request.get as jest.Mock).mockResolvedValue([{ code: 'growth' }]);
    const result = await getBillingTopups();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/topups'));
    expect(result).toEqual([{ code: 'growth' }]);
  });

  it('getBillingSubscription calls GET /api/billing/subscription', async () => {
    (request.get as jest.Mock).mockResolvedValue({ plan: 'free' });
    const result = await getBillingSubscription();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/subscription'));
    expect(result).toEqual({ plan: 'free' });
  });

  it('postBillingCheckout calls POST /api/billing/checkout with the plan code', async () => {
    (request.post as jest.Mock).mockResolvedValue({ url: 'https://stripe.example/checkout/abc' });
    const result = await postBillingCheckout('nexus_premium');
    expect(request.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/checkout'),
      { planCode: 'nexus_premium' },
    );
    expect(result).toEqual({ url: 'https://stripe.example/checkout/abc' });
  });

  it('postBillingTopupCheckout calls POST /api/billing/topups/checkout with the add-on code', async () => {
    (request.post as jest.Mock).mockResolvedValue({ url: 'https://stripe.example/checkout/topup' });
    const result = await postBillingTopupCheckout('growth');
    expect(request.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/topups/checkout'),
      { addOnCode: 'growth' },
    );
    expect(result).toEqual({ url: 'https://stripe.example/checkout/topup' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-provider && npx jest src/data-service.spec.ts`
Expected: FAIL — the new functions aren't exported yet.

- [ ] **Step 3: Add the functions**

Add to `packages/data-provider/src/data-service.ts`, near `getUserBalance`:

```typescript
export function getBillingPlans(): Promise<t.TBillingPlan[]> {
  return request.get(endpoints.billingPlans());
}

export function getBillingTopups(): Promise<t.TBillingTopup[]> {
  return request.get(endpoints.billingTopups());
}

export function getBillingSubscription(): Promise<t.TBillingSubscription> {
  return request.get(endpoints.billingSubscription());
}

export function postBillingCheckout(planCode: string): Promise<t.TBillingCheckoutResponse> {
  return request.post(endpoints.billingCheckout(), { planCode });
}

export function postBillingTopupCheckout(addOnCode: string): Promise<t.TBillingCheckoutResponse> {
  return request.post(endpoints.billingTopupCheckout(), { addOnCode });
}
```

(`t` here refers to whatever the file's existing type-namespace import alias is — check the top of `data-service.ts` for how `TBalanceResponse` etc. are referenced and match it exactly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-provider && npx jest src/data-service.spec.ts`
Expected: PASS (5 new tests, plus any pre-existing tests in that file still passing)

- [ ] **Step 5: Commit**

```bash
git add packages/data-provider/src/data-service.ts packages/data-provider/src/data-service.spec.ts
git commit -m "feat(billing): add billing data-service functions"
```

---

## Task 5: Billing query hooks

**Files:**
- Create: `client/src/data-provider/Billing/queries.ts`
- Test: `client/src/data-provider/Billing/__tests__/queries.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/data-provider/Billing/__tests__/queries.spec.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import {
  useGetBillingPlansQuery,
  useGetBillingTopupsQuery,
  useGetBillingSubscriptionQuery,
} from '../queries';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    getBillingPlans: jest.fn(),
    getBillingTopups: jest.fn(),
    getBillingSubscription: jest.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('Billing queries', () => {
  it('useGetBillingPlansQuery fetches plans', async () => {
    (dataService.getBillingPlans as jest.Mock).mockResolvedValue([
      { code: 'nexus_premium', name: 'Premium', amountCents: 2000, amountCurrency: 'USD' },
    ]);
    const { result } = renderHook(() => useGetBillingPlansQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('useGetBillingTopupsQuery fetches top-ups', async () => {
    (dataService.getBillingTopups as jest.Mock).mockResolvedValue([
      { code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' },
    ]);
    const { result } = renderHook(() => useGetBillingTopupsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('useGetBillingSubscriptionQuery fetches the current subscription', async () => {
    (dataService.getBillingSubscription as jest.Mock).mockResolvedValue({ plan: 'free' });
    const { result } = renderHook(() => useGetBillingSubscriptionQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ plan: 'free' });
  });
});
```

Before finalizing this test, check an existing simple query-hook test in this codebase (e.g. anything testing `useGetUserBalance` or `useGetBannerQuery`) for the established `renderHook`/`QueryClientProvider` wrapper convention — this codebase may already have a shared test wrapper utility instead of hand-rolling one; use it if so instead of the inline `wrapper` function above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/data-provider/Billing --testTimeout=30000`
Expected: FAIL — `../queries` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/data-provider/Billing/queries.ts
import { useRecoilValue } from 'recoil';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import store from '~/store';

export const useGetBillingPlansQuery = (
  config?: UseQueryOptions<t.TBillingPlan[]>,
): QueryObserverResult<t.TBillingPlan[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingPlan[]>(
    [QueryKeys.billingPlans],
    () => dataService.getBillingPlans(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetBillingTopupsQuery = (
  config?: UseQueryOptions<t.TBillingTopup[]>,
): QueryObserverResult<t.TBillingTopup[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingTopup[]>(
    [QueryKeys.billingTopups],
    () => dataService.getBillingTopups(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetBillingSubscriptionQuery = (
  config?: UseQueryOptions<t.TBillingSubscription>,
): QueryObserverResult<t.TBillingSubscription> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingSubscription>(
    [QueryKeys.billingSubscription],
    () => dataService.getBillingSubscription(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/data-provider/Billing --testTimeout=30000`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/data-provider/Billing/queries.ts client/src/data-provider/Billing/__tests__/queries.spec.ts
git commit -m "feat(billing): add billing query hooks"
```

---

## Task 6: Billing mutation hooks

**Files:**
- Create: `client/src/data-provider/Billing/mutations.ts`
- Test: `client/src/data-provider/Billing/__tests__/mutations.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/data-provider/Billing/__tests__/mutations.spec.ts
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import { useBillingCheckoutMutation, useBillingTopupCheckoutMutation } from '../mutations';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    postBillingCheckout: jest.fn(),
    postBillingTopupCheckout: jest.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('Billing mutations', () => {
  it('useBillingCheckoutMutation calls postBillingCheckout with the plan code', async () => {
    (dataService.postBillingCheckout as jest.Mock).mockResolvedValue({
      url: 'https://stripe.example/checkout/abc',
    });
    const { result } = renderHook(() => useBillingCheckoutMutation(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync('nexus_premium');
    });

    expect(dataService.postBillingCheckout).toHaveBeenCalledWith('nexus_premium');
    expect(response).toEqual({ url: 'https://stripe.example/checkout/abc' });
  });

  it('useBillingTopupCheckoutMutation calls postBillingTopupCheckout with the add-on code', async () => {
    (dataService.postBillingTopupCheckout as jest.Mock).mockResolvedValue({
      url: 'https://stripe.example/checkout/topup',
    });
    const { result } = renderHook(() => useBillingTopupCheckoutMutation(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync('growth');
    });

    expect(dataService.postBillingTopupCheckout).toHaveBeenCalledWith('growth');
    expect(response).toEqual({ url: 'https://stripe.example/checkout/topup' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/data-provider/Billing/__tests__/mutations.spec.ts --testTimeout=30000`
Expected: FAIL — `../mutations` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// client/src/data-provider/Billing/mutations.ts
import { useMutation } from '@tanstack/react-query';
import { MutationKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';

export const useBillingCheckoutMutation = (): UseMutationResult<
  t.TBillingCheckoutResponse,
  unknown,
  string,
  unknown
> => {
  return useMutation([MutationKeys.billingCheckout], {
    mutationFn: (planCode: string) => dataService.postBillingCheckout(planCode),
  });
};

export const useBillingTopupCheckoutMutation = (): UseMutationResult<
  t.TBillingCheckoutResponse,
  unknown,
  string,
  unknown
> => {
  return useMutation([MutationKeys.billingTopupCheckout], {
    mutationFn: (addOnCode: string) => dataService.postBillingTopupCheckout(addOnCode),
  });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/data-provider/Billing/__tests__/mutations.spec.ts --testTimeout=30000`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/data-provider/Billing/mutations.ts client/src/data-provider/Billing/__tests__/mutations.spec.ts
git commit -m "feat(billing): add billing mutation hooks"
```

---

## Task 7: Barrel export and wiring

**Files:**
- Create: `client/src/data-provider/Billing/index.ts`
- Modify: `client/src/data-provider/index.ts`

- [ ] **Step 1: No new test** — a barrel file with no logic; already exercised transitively by every test in Tasks 5/6/8/9/10 that imports through `~/data-provider`.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Create the barrel and wire it in**

```typescript
// client/src/data-provider/Billing/index.ts
export * from './queries';
export * from './mutations';
```

Add to `client/src/data-provider/index.ts`, matching the existing `export * from './Misc';` line style:

```typescript
export * from './Billing';
```

- [ ] **Step 4: Run the full Billing test directory to confirm the barrel resolves cleanly**

Run: `cd client && npx jest src/data-provider/Billing --testTimeout=30000`
Expected: PASS (5 tests total: 3 query + 2 mutation)

- [ ] **Step 5: Commit**

```bash
git add client/src/data-provider/Billing/index.ts client/src/data-provider/index.ts
git commit -m "feat(billing): wire up Billing data-provider barrel"
```

---

## Task 8: PlanList presentational component

**Files:**
- Create: `client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx`
- Test: `client/src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx`

This mirrors `SettingsTabs/Balance/TokenCreditsItem.tsx` and `AutoRefillSettings.tsx`: a pure presentational component that receives already-fetched data and callbacks as props. It does not call any query/mutation hook itself — that lives in the Task 11 container (`BillingControls.tsx`), matching how `TokenCredits` (the container) owns `useBalance()` and `TokenCreditsItem` (the presentational component) just renders.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import PlanList from '../PlanList';

describe('PlanList', () => {
  it('shows a loading spinner while plans are fetching', () => {
    const { getByTestId } = render(
      <PlanList plans={undefined} isLoading isError={false} onSubscribe={jest.fn()} isSubscribing={false} />,
    );
    expect(getByTestId('billing-plans-loading')).toBeInTheDocument();
  });

  it('shows an error message when the plans query fails', () => {
    const { getByText } = render(
      <PlanList plans={undefined} isLoading={false} isError onSubscribe={jest.fn()} isSubscribing={false} />,
    );
    expect(getByText('Unable to load plans.')).toBeInTheDocument();
  });

  it('lists each plan with a Subscribe button', () => {
    const { getByText, getAllByRole } = render(
      <PlanList
        plans={[
          { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
          { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD' },
        ]}
        isLoading={false}
        isError={false}
        onSubscribe={jest.fn()}
        isSubscribing={false}
      />,
    );
    expect(getByText('Nexus Premium')).toBeInTheDocument();
    expect(getByText('Nexus Ultimate')).toBeInTheDocument();
    expect(getAllByRole('button', { name: 'Subscribe' })).toHaveLength(2);
  });

  it('calls onSubscribe with the plan code when Subscribe is clicked', () => {
    const onSubscribe = jest.fn();
    const { getByRole } = render(
      <PlanList
        plans={[{ code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' }]}
        isLoading={false}
        isError={false}
        onSubscribe={onSubscribe}
        isSubscribing={false}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Subscribe' }));
    expect(onSubscribe).toHaveBeenCalledWith('nexus_premium');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx --testTimeout=30000`
Expected: FAIL — `../PlanList` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Match `ApiKeys/List.tsx`'s established loading/error/list structure and its exact `Spinner`/`Button` usage:

```tsx
// client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx
import { Button, Spinner } from '@librechat/client';
import type { TBillingPlan } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type PlanListProps = {
  plans: TBillingPlan[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isSubscribing: boolean;
  onSubscribe: (planCode: string) => void;
};

export default function PlanList({
  plans,
  isLoading,
  isError,
  isSubscribing,
  onSubscribe,
}: PlanListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div
        data-testid="billing-plans-loading"
        className="flex items-center justify-center rounded-xl border border-border-light py-12"
      >
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-red-500">{localize('com_ui_billing_plans_error')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {(plans ?? []).map((plan) => (
        <div key={plan.code} className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">{plan.name}</div>
            <div className="text-xs text-text-secondary">
              {(plan.amountCents / 100).toFixed(2)} {plan.amountCurrency}
            </div>
          </div>
          <Button size="sm" disabled={isSubscribing} onClick={() => onSubscribe(plan.code)}>
            {localize('com_ui_billing_subscribe')}
          </Button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx --testTimeout=30000`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/PlanList.tsx client/src/components/Nav/SettingsTabs/Billing/__tests__/PlanList.spec.tsx
git commit -m "feat(billing): add PlanList component"
```

---

## Task 9: TopupList presentational component

**Files:**
- Create: `client/src/components/Nav/SettingsTabs/Billing/TopupList.tsx`
- Test: `client/src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx`

- [ ] **Step 1: Write the failing test**

Mirror Task 8's test, substituting top-up naming and props throughout:

```tsx
// client/src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import TopupList from '../TopupList';

describe('TopupList', () => {
  it('shows a loading spinner while top-ups are fetching', () => {
    const { getByTestId } = render(
      <TopupList topups={undefined} isLoading isError={false} onBuy={jest.fn()} isBuying={false} />,
    );
    expect(getByTestId('billing-topups-loading')).toBeInTheDocument();
  });

  it('shows an error message when the top-ups query fails', () => {
    const { getByText } = render(
      <TopupList topups={undefined} isLoading={false} isError onBuy={jest.fn()} isBuying={false} />,
    );
    expect(getByText('Unable to load credit top-ups.')).toBeInTheDocument();
  });

  it('lists each top-up with a Buy button', () => {
    const { getByText, getByRole } = render(
      <TopupList
        topups={[{ code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' }]}
        isLoading={false}
        isError={false}
        onBuy={jest.fn()}
        isBuying={false}
      />,
    );
    expect(getByText('Growth')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Buy' })).toBeInTheDocument();
  });

  it('calls onBuy with the add-on code when Buy is clicked', () => {
    const onBuy = jest.fn();
    const { getByRole } = render(
      <TopupList
        topups={[{ code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' }]}
        isLoading={false}
        isError={false}
        onBuy={onBuy}
        isBuying={false}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Buy' }));
    expect(onBuy).toHaveBeenCalledWith('growth');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx --testTimeout=30000`
Expected: FAIL — `../TopupList` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/TopupList.tsx
import { Button, Spinner } from '@librechat/client';
import type { TBillingTopup } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type TopupListProps = {
  topups: TBillingTopup[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isBuying: boolean;
  onBuy: (addOnCode: string) => void;
};

export default function TopupList({ topups, isLoading, isError, isBuying, onBuy }: TopupListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div
        data-testid="billing-topups-loading"
        className="flex items-center justify-center rounded-xl border border-border-light py-12"
      >
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-sm text-red-500">{localize('com_ui_billing_topups_error')}</div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {(topups ?? []).map((topup) => (
        <div key={topup.code} className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">{topup.name}</div>
            <div className="text-xs text-text-secondary">
              {(topup.amountCents / 100).toFixed(2)} {topup.amountCurrency}
            </div>
          </div>
          <Button size="sm" disabled={isBuying} onClick={() => onBuy(topup.code)}>
            {localize('com_ui_billing_buy')}
          </Button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx --testTimeout=30000`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/TopupList.tsx client/src/components/Nav/SettingsTabs/Billing/__tests__/TopupList.spec.tsx
git commit -m "feat(billing): add TopupList component"
```

---

## Task 10: SubscriptionStatusItem presentational component

**Files:**
- Create: `client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx`
- Test: `client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import SubscriptionStatusItem from '../SubscriptionStatusItem';

describe('SubscriptionStatusItem', () => {
  it('shows a loading spinner', () => {
    const { getByTestId } = render(<SubscriptionStatusItem plan={undefined} isLoading isError={false} />);
    expect(getByTestId('billing-subscription-loading')).toBeInTheDocument();
  });

  it('shows an error message', () => {
    const { getByText } = render(<SubscriptionStatusItem plan={undefined} isLoading={false} isError />);
    expect(getByText('Unable to load your plan.')).toBeInTheDocument();
  });

  it('shows "Free" for the free plan', () => {
    const { getByText } = render(<SubscriptionStatusItem plan="free" isLoading={false} isError={false} />);
    expect(getByText('Free')).toBeInTheDocument();
  });

  it('shows "Active subscription" for a paid plan', () => {
    const { getByText } = render(
      <SubscriptionStatusItem plan="active-lago-subscription" isLoading={false} isError={false} />,
    );
    expect(getByText('Active subscription')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx --testTimeout=30000`
Expected: FAIL — `../SubscriptionStatusItem` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```tsx
// client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx
import { Label, InfoHoverCard, ESide, Spinner } from '@librechat/client';
import { useLocalize } from '~/hooks';

type SubscriptionStatusItemProps = {
  plan: string | undefined;
  isLoading: boolean;
  isError: boolean;
};

export default function SubscriptionStatusItem({ plan, isLoading, isError }: SubscriptionStatusItemProps) {
  const localize = useLocalize();

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

  const label =
    plan === 'free' ? localize('com_ui_billing_plan_free') : localize('com_ui_billing_plan_active');

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Label className="font-light">{localize('com_ui_settings_label_subscription_status')}</Label>
        <InfoHoverCard side={ESide.Bottom} text={localize('com_ui_billing_subscription_info')} />
      </div>
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200" role="note">
        {label}
      </span>
    </div>
  );
}
```

This matches `TokenCreditsItem.tsx`'s exact `Label`/`InfoHoverCard`/right-aligned-value layout, since both render a single labeled value in the same Billing section.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx --testTimeout=30000`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx client/src/components/Nav/SettingsTabs/Billing/__tests__/SubscriptionStatusItem.spec.tsx
git commit -m "feat(billing): add SubscriptionStatusItem component"
```

---

## Task 11: Container components in BillingControls.tsx

**Files:**
- Modify: `client/src/components/Nav/Settings/BillingControls.tsx`

This task adds `Plans`, `Topups`, and `SubscriptionStatus` container components to the same file that already exports `TokenCredits`/`AutoRefill`, following the exact same shape: own the query/mutation hooks, pass plain data + callbacks down to the Task 8-10 presentational components.

- [ ] **Step 1: No new test** — matches the existing precedent: `TokenCredits`/`AutoRefill` (the two containers already in this file) have no dedicated test of their own; they're covered by their presentational components' tests (Tasks 8-10) plus the Task 12 manual verification. Introducing a test only for the new containers while the existing two have none would be an inconsistent, arbitrary line to draw.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the containers**

```tsx
// additions to client/src/components/Nav/Settings/BillingControls.tsx
import {
  useGetBillingPlansQuery,
  useGetBillingTopupsQuery,
  useGetBillingSubscriptionQuery,
  useBillingCheckoutMutation,
  useBillingTopupCheckoutMutation,
} from '~/data-provider';
import PlanList from '../SettingsTabs/Billing/PlanList';
import TopupList from '../SettingsTabs/Billing/TopupList';
import SubscriptionStatusItem from '../SettingsTabs/Billing/SubscriptionStatusItem';

export function Plans() {
  const { data: plans, isLoading, isError } = useGetBillingPlansQuery();
  const { mutateAsync: checkout, isLoading: isSubscribing } = useBillingCheckoutMutation();

  const handleSubscribe = async (planCode: string) => {
    const { url } = await checkout(planCode);
    window.location.href = url;
  };

  return (
    <PlanList
      plans={plans}
      isLoading={isLoading}
      isError={isError}
      isSubscribing={isSubscribing}
      onSubscribe={handleSubscribe}
    />
  );
}

export function Topups() {
  const { data: topups, isLoading, isError } = useGetBillingTopupsQuery();
  const { mutateAsync: checkout, isLoading: isBuying } = useBillingTopupCheckoutMutation();

  const handleBuy = async (addOnCode: string) => {
    const { url } = await checkout(addOnCode);
    window.location.href = url;
  };

  return (
    <TopupList topups={topups} isLoading={isLoading} isError={isError} isBuying={isBuying} onBuy={handleBuy} />
  );
}

export function SubscriptionStatus() {
  const { data, isLoading, isError } = useGetBillingSubscriptionQuery();
  return <SubscriptionStatusItem plan={data?.plan} isLoading={isLoading} isError={isError} />;
}
```

Place these after the existing `AutoRefill` export, in the same file — do not create a separate container file, matching this file's established role as the single home for all Billing-tab container components.

- [ ] **Step 4: N/A** (covered by Tasks 8-10's component tests; manual verification happens in Task 12)

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/Settings/BillingControls.tsx
git commit -m "feat(billing): add Plans, Topups, and SubscriptionStatus containers"
```

---

## Task 12: Wire into the Settings registry

**Files:**
- Modify: `client/src/components/Nav/Settings/registry.tsx`

- [ ] **Step 1: No new test** — `registry.tsx` is a declarative data array with no logic of its own; the existing Settings dialog's own tests (if any) exercise it by rendering the full dialog. Adding entries here is analogous to the existing `tokenCredits`/`autoRefill` entries already in the file, which have no dedicated registry-level test either.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the entries**

In `client/src/components/Nav/Settings/registry.tsx`, extend the existing import (currently `import { TokenCredits, AutoRefill } from './BillingControls';`):

```typescript
import { TokenCredits, AutoRefill, Plans, Topups, SubscriptionStatus } from './BillingControls';
```

Then add three new entries immediately after the existing `autoRefill` entry (same `tab: ACCOUNT, section: 'billing'`):

```typescript
  {
    id: 'subscriptionStatus',
    tab: ACCOUNT,
    section: 'billing',
    labelKey: 'com_ui_settings_label_subscription_status',
    Component: SubscriptionStatus,
  },
  {
    id: 'plans',
    tab: ACCOUNT,
    section: 'billing',
    labelKey: 'com_ui_settings_label_plans',
    Component: Plans,
  },
  {
    id: 'topups',
    tab: ACCOUNT,
    section: 'billing',
    labelKey: 'com_ui_settings_label_topups',
    Component: Topups,
  },
```

Note: unlike `tokenCredits`/`autoRefill`, these three entries have no `show:` guard. Confirmed against `Content.tsx`/`Dialog.tsx`/`Sidebar.tsx` (`!entry.show || entry.show(ctx)`) that an entry with no `show` function is always rendered — exactly what's wanted here, since Lago billing is a separate system from the local token-credit `balanceEnabled` flag and should be reachable regardless of it.

- [ ] **Step 4: Manual verification**

Run the dev servers (`npm run backend:dev` + `npm run frontend:dev`), open Settings → Account, confirm the Billing section now shows: current plan status, then the plan list with Subscribe buttons, then the top-up list with Buy buttons, alongside the pre-existing token-credit balance/auto-refill controls.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Nav/Settings/registry.tsx
git commit -m "feat(billing): wire billing components into Account settings"
```

---

## Task 13: Translation keys

**Files:**
- Modify: `client/src/locales/en/translation.json`

- [ ] **Step 1: No test** — translation JSON has no runtime logic; missing keys would surface as literal untranslated key names in Task 12's manual verification, which is the actual check here.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the keys**

Add to `client/src/locales/en/translation.json` (find the existing `com_ui_settings_label_credits` entry and add these alongside it, keeping alphabetical/logical grouping consistent with the surrounding keys):

```json
"com_ui_settings_label_subscription_status": "Current Plan",
"com_ui_settings_label_plans": "Available Plans",
"com_ui_settings_label_topups": "Buy Credits",
"com_ui_billing_plans_error": "Unable to load plans.",
"com_ui_billing_subscribe": "Subscribe",
"com_ui_billing_topups_error": "Unable to load credit top-ups.",
"com_ui_billing_buy": "Buy",
"com_ui_billing_subscription_error": "Unable to load your plan.",
"com_ui_billing_subscription_info": "Your current Nexus AI subscription plan.",
"com_ui_billing_plan_free": "Free",
"com_ui_billing_plan_active": "Active subscription",
```

Note: no `com_ui_billing_*_loading` keys are needed — per Tasks 8-10, all three loading states render a bare `Spinner` with no accompanying text (matching `ApiKeys/List.tsx`'s loading state, which is icon-only), so there's no loading copy to localize.

Per CLAUDE.md: only update the English locale file — other languages are automated externally.

- [ ] **Step 4: Re-run the full Billing component test suite to confirm real translated strings render (not raw keys)**

Run: `cd client && npx jest src/components/Nav/SettingsTabs/Billing --testTimeout=30000`
Expected: PASS (all 12 tests across PlanList/TopupList/SubscriptionStatusItem)

- [ ] **Step 5: Commit**

```bash
git add client/src/locales/en/translation.json
git commit -m "feat(billing): add billing translation keys"
```

---

## Self-Review Notes

**Spec coverage:**
- Plan list + subscribe → checkout redirect: Tasks 5, 6, 8, 11.
- Top-up list + buy → checkout redirect: Tasks 5, 6, 9, 11.
- Current plan display: Tasks 5, 10, 11.
- Settings integration: Task 12.
- i18n: Task 13.
- Not covered here (explicitly out of scope, see Scope section): invoice history, richer subscription details, Teams/seat UI, custom post-checkout pages.

**Corrections made during self-review** (before this plan was ever executed): the original draft invented a new `Nav/Settings/Billing/` component directory and had each component call its own query/mutation hooks directly. Checking the actual codebase turned up an existing `client/src/components/Nav/Settings/BillingControls.tsx` that already contains the sibling `TokenCredits`/`AutoRefill` containers, plus a `client/src/components/Nav/SettingsTabs/Balance/` directory holding their presentational counterparts (`TokenCreditsItem.tsx`, `AutoRefillSettings.tsx`). The plan was rewritten (now Tasks 8-11) to extend those two existing locations instead of introducing a parallel structure. `Button` component props (`size="sm"`, no `variant` for primary actions, `variant="outline"` for secondary) and the loading-spinner style (bordered box + `Spinner`, no text) were taken directly from `client/src/components/Nav/SettingsTabs/ApiKeys/List.tsx`, the closest existing analog (async list + primary action button + loading/error/empty states) rather than guessed.

**Verified, not assumed:** registry entries with no `show` guard render unconditionally — confirmed via `!entry.show || entry.show(ctx)` in `Content.tsx`, `Dialog.tsx`, and `Sidebar.tsx` (Task 12). `BASE_URL` string-concatenation convention in `api-endpoints.ts` confirmed directly (Task 2). No existing test file covers `BillingControls.tsx`'s current containers, confirming Task 11's "no dedicated container test" call is consistent with existing precedent, not a coverage gap being introduced.

**Still open for the implementer:** whether `test/layout-test-utils`'s `render` wraps `QueryClientProvider`/Recoil by default (check before assuming, relevant to Tasks 5-6's hook tests) — the `ApiKeys` test suite referenced throughout this plan relies on it, so it very likely does, but confirm before writing Task 5's tests.
