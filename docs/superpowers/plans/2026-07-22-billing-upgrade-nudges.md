# Billing Upgrade Nudges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a path to upgrading when they hit their token limit (a link on the existing "Insufficient Funds" error) or are approaching it (a new persistent sidebar badge), per `docs/superpowers/specs/2026-07-22-billing-upgrade-nudges-design.md`.

**Architecture:** Two independent, additive frontend changes — no new backend endpoints or queries. (1) `Error.tsx`'s existing `token_balance` error case gains an "Upgrade your plan" link. (2) A new `CreditsBadge` component reads the same `useGetUserBalance()` data already used elsewhere in Settings, computing a percentage-used figure client-side, and is wired into the sidebar footer.

**Tech Stack:** TypeScript, React, `react-router-dom` (`useNavigate`), `@librechat/client` (`TooltipAnchor`), Jest + React Testing Library (`test/layout-test-utils`).

**Note on one design deviation, found while mapping file structure below:** the spec described the proactive badge as a colored *text pill* (e.g. `"73% used"`). Reading the actual sidebar component (`UnifiedSidebar/ExpandedPanel.tsx`) shows it's a **narrow icon-only rail** — every other item in that footer (`NewChatButton`, `NavIconButton`, the sidebar-toggle button, `AccountSettings`) is a `h-9 w-9` icon button with a `TooltipAnchor` for its label, not inline text. A wide text pill would break that layout. Task 2 below builds the badge as a color-coded icon (reusing the `CreditCard` icon already used for the Billing tab, for a visual link between the two) with the percentage shown on hover via `TooltipAnchor` — same underlying data/logic/thresholds/hide-conditions as the spec, different visual form to fit the actual component it lives in. Flag this to the user before/while implementing in case they'd rather revisit the placement instead.

---

## File Structure

**New files:**
- `client/src/components/Nav/CreditsBadge.tsx` — the proactive sidebar badge.
- `client/src/components/Nav/__tests__/CreditsBadge.spec.tsx`
- `client/src/components/Messages/Content/__tests__/Error.spec.tsx` — first test file for `Error.tsx`, which currently has none.

**Modified files:**
- `client/src/components/Messages/Content/Error.tsx` — `token_balance` case gains an upgrade link.
- `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` — renders `CreditsBadge` in the footer.
- `client/src/locales/en/translation.json` — two new keys.

---

## Task 1: Reactive — "Upgrade your plan" link on the insufficient-funds error

**Files:**
- Modify: `client/src/components/Messages/Content/Error.tsx`
- Create: `client/src/components/Messages/Content/__tests__/Error.spec.tsx`

`Error.tsx` currently has no test file at all. This task's test covers both the pre-existing behavior (so a future change can't silently break it) and the new link.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Messages/Content/__tests__/Error.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import { ViolationTypes } from 'librechat-data-provider';
import Error from '../Error';

describe('Error', () => {
  it('shows the insufficient-funds message and an Upgrade link for a token_balance violation', () => {
    const json = {
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 0,
      tokenCost: 120,
      promptTokens: 100,
    };
    const { getByText, getByRole } = render(<Error text={JSON.stringify(json)} />);

    expect(
      getByText('Insufficient Funds! Balance: 0. Prompt tokens: 100. Cost: 120.'),
    ).toBeInTheDocument();

    const link = getByRole('link', { name: 'Upgrade your plan' });
    expect(link).toHaveAttribute('href', '/plans');
  });

  it('still renders generations output for a token_balance violation that includes them', () => {
    const json = {
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 0,
      tokenCost: 120,
      promptTokens: 100,
      generations: [{ text: 'partial output' }],
    };
    const { getByText } = render(<Error text={JSON.stringify(json)} />);
    expect(getByText(/partial output/)).toBeInTheDocument();
  });

  it('falls back to the default message for a non-JSON error string', () => {
    const { getByText } = render(<Error text="plain text failure" />);
    expect(
      getByText(
        "Something went wrong. Here's the specific error message we encountered: plain text failure",
      ),
    ).toBeInTheDocument();
  });
});
```

Check `test/layout-test-utils`'s `render` wraps a router (confirmed earlier in this project's billing work — it wraps `QueryClientProvider`, `RecoilRoot`, `Router`, `AuthContextProvider`), so the `getByRole('link', ...)` query against an `<a href="/plans">` works without extra setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Messages/Content/__tests__/Error.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — the first test's `getByRole('link', { name: 'Upgrade your plan' })` finds nothing yet. The other two tests should already pass (they cover existing behavior), confirming this task doesn't touch anything else.

- [ ] **Step 3: Add the translation key**

Add to `client/src/locales/en/translation.json`, alongside the other `com_ui_billing_*` keys (e.g. near `com_ui_billing_subscribe`):

```json
"com_ui_billing_upgrade_plan": "Upgrade your plan",
```

- [ ] **Step 4: Add the link to the `token_balance` case**

```tsx
// client/src/components/Messages/Content/Error.tsx
token_balance: (json: TTokenBalance, localize: LocalizeFunction) => {
  const { balance, tokenCost, promptTokens, generations } = json;
  const message = `Insufficient Funds! Balance: ${balance}. Prompt tokens: ${promptTokens}. Cost: ${tokenCost}.`;
  return (
    <>
      {message}
      <br />
      <a href="/plans" className="text-blue-600 underline hover:text-blue-700">
        {localize('com_ui_billing_upgrade_plan')}
      </a>
      {generations && (
        <>
          <br />
          <br />
        </>
      )}
      {generations && (
        <CodeBlock
          lang="Generations"
          error={true}
          codeChildren={formatJSON(JSON.stringify(generations))}
        />
      )}
    </>
  );
},
```

This changes the `token_balance` entry's signature from `(json: TTokenBalance)` to `(json: TTokenBalance, localize: LocalizeFunction)` to match the other functions in this same object (e.g. `MISSING_MODEL`, `EXPIRED_USER_KEY`) that already take `(json, localize)` — the `Error` component already calls every entry as `errorMessages[errorKey](json, localize)` (see the existing `if (keyExists && typeof errorMessages[errorKey] === 'function')` branch), so no caller changes are needed; `token_balance` was just the one case not using its second argument yet.

A plain `<a>` tag is used here (not `react-router-dom`'s `Link`) because `token_balance` is a plain function in a lookup object, not a component — it has no hook access. A full page navigation to `/plans` is an acceptable cost for an error-recovery click (the user is already leaving their broken conversation state behind).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx jest src/components/Messages/Content/__tests__/Error.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Messages/Content/Error.tsx client/src/components/Messages/Content/__tests__/Error.spec.tsx client/src/locales/en/translation.json
git commit -m "feat(billing): add an upgrade link to the insufficient-funds error"
```

---

## Task 2: Proactive — `CreditsBadge` component

**Files:**
- Create: `client/src/components/Nav/CreditsBadge.tsx`
- Create: `client/src/components/Nav/__tests__/CreditsBadge.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Nav/__tests__/CreditsBadge.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import CreditsBadge from '../CreditsBadge';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetUserBalance: jest.fn(),
  useGetStartupConfig: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockBalanceQuery = useGetUserBalance as jest.Mock;
const mockStartupConfigQuery = useGetStartupConfig as jest.Mock;

describe('CreditsBadge', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: true } } });
  });

  it('renders nothing when balance tracking is disabled site-wide', () => {
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: false } } });
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: 5000 } });
    const { container } = render(<CreditsBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user has no refillAmount configured', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: undefined } });
    const { container } = render(<CreditsBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the balance query has no data yet', () => {
    mockBalanceQuery.mockReturnValue({ data: undefined });
    const { container } = render(<CreditsBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a green-toned badge under 60% used', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 4500, refillAmount: 5000 } }); // 10% used
    const { getByTestId } = render(<CreditsBadge />);
    const icon = getByTestId('credits-badge-icon');
    expect(icon).toHaveClass('text-green-600');
  });

  it('shows an amber-toned badge between 60% and 79% used', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 2000, refillAmount: 5000 } }); // 60% used
    const { getByTestId } = render(<CreditsBadge />);
    const icon = getByTestId('credits-badge-icon');
    expect(icon).toHaveClass('text-amber-500');
  });

  it('shows a red-toned badge at 80% used or more', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: 5000 } }); // 90% used
    const { getByTestId, getByLabelText } = render(<CreditsBadge />);
    const icon = getByTestId('credits-badge-icon');
    expect(icon).toHaveClass('text-red-500');
    expect(getByLabelText('90% of your credits used')).toBeInTheDocument();
  });

  it('navigates to /plans when clicked', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: 5000 } });
    const { getByTestId } = render(<CreditsBadge />);
    getByTestId('credits-badge').click();
    expect(mockNavigate).toHaveBeenCalledWith('/plans');
  });
});
```

Check the exact `useLocalize` mock behavior `test/layout-test-utils` provides (it renders through the real `I18nextProvider`/localize pipeline in this codebase's test setup, per the precedent in `PlansView.spec.tsx` and other billing component tests this project already has, which assert against real English strings like `'Unable to load plans.'` rather than raw translation keys) — the `getByLabelText('90% of your credits used')` assertion above assumes the same real-translation behavior; confirm against one of those existing spec files before running this if the exact wording doesn't match what Step 3 below defines.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Nav/__tests__/CreditsBadge.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — `../CreditsBadge` doesn't exist yet.

- [ ] **Step 3: Add the translation key**

Add to `client/src/locales/en/translation.json`, alongside the other `com_ui_billing_*` keys:

```json
"com_ui_credits_badge_tooltip": "{{percent}}% of your credits used",
```

- [ ] **Step 4: Write the implementation**

```tsx
// client/src/components/Nav/CreditsBadge.tsx
import { CreditCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TooltipAnchor } from '@librechat/client';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export default function CreditsBadge() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });

  const { tokenCredits, refillAmount } = balanceQuery.data ?? {};

  if (!startupConfig?.balance?.enabled || !refillAmount || tokenCredits == null) {
    return null;
  }

  const percentageUsed = clampPercentage(((refillAmount - tokenCredits) / refillAmount) * 100);
  const roundedPercent = Math.round(percentageUsed);
  const colorClassName =
    percentageUsed >= 80
      ? 'text-red-500'
      : percentageUsed >= 60
        ? 'text-amber-500'
        : 'text-green-600';
  const tooltipText = localize('com_ui_credits_badge_tooltip', { percent: String(roundedPercent) });

  return (
    <TooltipAnchor
      side="right"
      description={tooltipText}
      render={
        <button
          type="button"
          data-testid="credits-badge"
          aria-label={tooltipText}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
          onClick={() => navigate('/plans')}
        >
          <CreditCard
            data-testid="credits-badge-icon"
            className={cn('h-5 w-5', colorClassName)}
            aria-hidden="true"
          />
        </button>
      }
    />
  );
}
```

Same `CreditCard` icon already used for the Billing tab in Settings (`client/src/components/Nav/Settings/types.ts`) — reused here so the icon reads as "this is about billing" in both places.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx jest src/components/Nav/__tests__/CreditsBadge.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Nav/CreditsBadge.tsx client/src/components/Nav/__tests__/CreditsBadge.spec.tsx client/src/locales/en/translation.json
git commit -m "feat(billing): add a proactive credits-remaining badge"
```

---

## Task 3: Wire `CreditsBadge` into the sidebar footer

**Files:**
- Modify: `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`

- [ ] **Step 1: No new test** — `ExpandedPanel.spec.tsx` already mocks `~/components/Nav/AccountSettings` wholesale as a stub (see its existing `jest.mock('~/components/Nav/AccountSettings', ...)`), matching the pattern this addition follows; `CreditsBadge`'s own behavior is already fully covered by Task 2's tests. Adding one more mocked import here doesn't need a new assertion — confirm this precedent holds by re-reading `ExpandedPanel.spec.tsx` before skipping, in case it asserts on the exact footer child count.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the import and render it**

```tsx
// client/src/components/UnifiedSidebar/ExpandedPanel.tsx
const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));
const CreditsBadge = lazy(() => import('~/components/Nav/CreditsBadge'));
```

```tsx
      <div className="mt-auto flex flex-col gap-1">
        <Suspense fallback={null}>
          <CreditsBadge />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
```

This replaces the existing `<div className="mt-auto">...</div>` block (previously containing only the `AccountSettings` `Suspense`) — same `mt-auto` footer positioning, now wrapping both items in a `flex flex-col gap-1` so they stack with the same spacing rhythm as the icon list above (`gap-1` matches the `links.map` container's own gap).

`CreditsBadge`'s `Suspense` fallback is `null` rather than a `Skeleton` — unlike `AccountSettings` (which always renders something once loaded), `CreditsBadge` frequently renders nothing at all (balance disabled, no `refillAmount`, etc.), so a skeleton placeholder would flash and then disappear for most users; `null` avoids that flicker for the common case.

- [ ] **Step 4: Run the existing ExpandedPanel test suite to confirm no regression**

Run: `cd client && npx jest src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS — if this fails because the test asserts something about the exact footer DOM structure, add a `jest.mock('~/components/Nav/CreditsBadge', ...)` stub to that spec file mirroring its existing `AccountSettings` mock, then re-run.

- [ ] **Step 5: Manual verification**

Run both dev servers, log in as a user with `balance.enabled` true and a `refillAmount` set (any subscribed or auto-refill-enabled test account). Confirm: a small credit-card icon appears above the account avatar in the sidebar footer, color-coded to current usage, hovering shows the percentage tooltip, and clicking it navigates to `/plans`. Then check a user/config with balance disabled — confirm the icon doesn't appear and the footer just shows the account avatar as before.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/UnifiedSidebar/ExpandedPanel.tsx
git commit -m "feat(billing): show the credits badge in the sidebar footer"
```

---

## Self-Review Notes

**Spec coverage:**
- Reactive "Upgrade your plan" link on the `token_balance` error: Task 1.
- Proactive badge, hidden when balance disabled or no `refillAmount`: Task 2.
- Color bands (green <60%, amber 60–79%, red ≥80%): Task 2.
- Both link to `/plans`: Tasks 1 and 2.
- Sidebar footer placement: Task 3.
- Approach B (dedicated usage endpoint) and one-time toast/banner: correctly not implemented anywhere in this plan, per the spec's explicit "Out of Scope" section.

**Deviation from the spec, flagged rather than silently applied:** the spec's "Rough shape" code sample showed a text pill (`"73% used"`); Task 2 builds an icon instead, because the actual sidebar (`ExpandedPanel.tsx`) is an icon-only rail with no room for text — every sibling item there is a `h-9 w-9` icon with a hover tooltip, and the badge now matches that. The underlying data logic, thresholds, and hide-conditions are unchanged from the spec.

**Type consistency check:** `token_balance`'s signature change (Task 1, Step 4) from `(json: TTokenBalance)` to `(json: TTokenBalance, localize: LocalizeFunction)` was checked against the `Error` component's existing call site (`errorMessages[errorKey](json, localize)`), which already passes both arguments to every entry regardless of whether a given entry currently uses the second one — no caller-side change needed.
