# Usage Banner & Hard-Limit Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar `CreditsBadge` icon with a dismissible banner attached to the top of the chat composer, and add a hard-limit modal that appears the moment a message fails due to zero balance — per `docs/superpowers/specs/2026-08-25-usage-banner-limit-modal-design.md`.

**Architecture:** One removal (`CreditsBadge` and its wiring) and two new, independent, additive components mounted in `ChatForm.tsx`: `UsageBanner` (self-contained, reads the same balance data the badge used) and `TokenBalanceLimitModal` (watches the latest message for a fresh insufficient-funds error). No new backend endpoints or data-provider queries — `getRefillEligibilityDate` already exists in `packages/data-provider/src/balance.ts` and `useGetUserBalance()`/`useGetStartupConfig()` already return everything needed.

**Tech Stack:** TypeScript, React, `react-router-dom` (`useNavigate`), `@librechat/client` (`OGDialog`, `Button`), Jest + React Testing Library (`test/layout-test-utils`).

---

## File Structure

**Removed:**
- `client/src/components/Nav/CreditsBadge.tsx`
- `client/src/components/Nav/__tests__/CreditsBadge.spec.tsx`

**New files:**
- `client/src/components/Chat/Input/UsageBanner.tsx`
- `client/src/components/Chat/Input/__tests__/UsageBanner.spec.tsx`
- `client/src/components/Chat/Input/TokenBalanceLimitModal.tsx`
- `client/src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx`

**Modified files:**
- `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` — remove `CreditsBadge` wiring, restore original footer.
- `client/src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx` — remove the `CreditsBadge` mock.
- `client/src/components/Chat/Input/ChatForm.tsx` — mount `UsageBanner` and `TokenBalanceLimitModal`; restructure the composer's corner-radius classes so the banner attaches flush to its top edge.
- `client/src/locales/en/translation.json` — remove `com_ui_credits_badge_tooltip`; add new banner/modal keys.

---

## Task 1: Remove `CreditsBadge` (revert prior session's sidebar badge)

**Files:**
- Delete: `client/src/components/Nav/CreditsBadge.tsx`
- Delete: `client/src/components/Nav/__tests__/CreditsBadge.spec.tsx`
- Modify: `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`
- Modify: `client/src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx`
- Modify: `client/src/locales/en/translation.json`

This is a pure revert of already-reviewed, uncommitted work — no new test to write. Since it removes code rather than adding it, there's no red/green cycle; instead, delete then run the existing suite to confirm nothing else depended on it.

- [ ] **Step 1: Delete the two `CreditsBadge` files**

```bash
rm client/src/components/Nav/CreditsBadge.tsx
rm client/src/components/Nav/__tests__/CreditsBadge.spec.tsx
```

- [ ] **Step 2: Revert `ExpandedPanel.tsx`'s footer**

Remove the `CreditsBadge` lazy import:

```tsx
// client/src/components/UnifiedSidebar/ExpandedPanel.tsx
// REMOVE this line:
const CreditsBadge = lazy(() => import('~/components/Nav/CreditsBadge'));
```

So the file goes from:

```tsx
const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));
const CreditsBadge = lazy(() => import('~/components/Nav/CreditsBadge'));
```

to just:

```tsx
const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));
```

Then restore the footer block from:

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

to its original, single-child form:

```tsx
      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
```

- [ ] **Step 3: Revert the test mock in `ExpandedPanel.spec.tsx`**

Remove this block (it sits directly after the existing `AccountSettings` mock):

```tsx
jest.mock('~/components/Nav/CreditsBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="credits-badge" />,
}));
```

- [ ] **Step 4: Remove the now-orphaned translation key**

In `client/src/locales/en/translation.json`, remove this line:

```json
"com_ui_credits_badge_tooltip": "{{percent}}% of your credits used",
```

- [ ] **Step 5: Run the existing test suite to confirm nothing else references the removed files**

Run: `cd client && npx jest src/components/UnifiedSidebar/__tests__/ExpandedPanel.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (6 tests — same count as before `CreditsBadge` was ever added).

Also run a repo-wide check that nothing else imports the deleted files:

Run: `grep -rn "Nav/CreditsBadge" client/src --include="*.tsx" --include="*.ts"`
Expected: no output.

- [ ] **Step 6: SKIP commit** — do not run `git add`/`git commit` (per the user's standing instruction not to commit until they've tested this themselves).

---

## Task 2: `UsageBanner` — dismissible usage strip attached to the composer

**Files:**
- Create: `client/src/components/Chat/Input/UsageBanner.tsx`
- Create: `client/src/components/Chat/Input/__tests__/UsageBanner.spec.tsx`
- Modify: `client/src/components/Chat/Input/ChatForm.tsx`
- Modify: `client/src/locales/en/translation.json`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Chat/Input/__tests__/UsageBanner.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import UsageBanner from '../UsageBanner';

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

describe('UsageBanner', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    sessionStorage.clear();
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: true } } });
  });

  it('renders nothing when balance tracking is disabled site-wide', () => {
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: false } } });
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user has no refillAmount configured', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: undefined } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing below 60% used', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: 1000 } }); // 50% used
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an amber banner between 60% and 79% used, with no reset date when autoRefillEnabled is false', () => {
    mockBalanceQuery.mockReturnValue({
      data: { tokenCredits: 350, refillAmount: 1000, autoRefillEnabled: false }, // 65% used
    });
    const { getByTestId, getByText } = render(<UsageBanner />);
    expect(getByTestId('usage-banner')).toHaveClass('border-amber-300');
    expect(getByText('65% of your credits used')).toBeInTheDocument();
  });

  it('shows a red banner at 80% used or more, with a reset date when autoRefillEnabled is true', () => {
    mockBalanceQuery.mockReturnValue({
      data: {
        tokenCredits: 100,
        refillAmount: 1000, // 90% used
        autoRefillEnabled: true,
        refillIntervalValue: 1,
        refillIntervalUnit: 'months',
        lastRefill: '2026-08-01T00:00:00.000Z',
      },
    });
    const { getByTestId, getByText } = render(<UsageBanner />);
    expect(getByTestId('usage-banner')).toHaveClass('border-red-300');
    const expectedDate = new Date('2026-09-01T00:00:00.000Z').toLocaleDateString();
    expect(getByText(`90% of your credits used — resets ${expectedDate}`)).toBeInTheDocument();
  });

  it('navigates to /plans when clicked', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { getByTestId } = render(<UsageBanner />);
    fireEvent.click(getByTestId('usage-banner'));
    expect(mockNavigate).toHaveBeenCalledWith('/plans');
  });

  it('hides after dismiss and does not call navigate when the dismiss button is clicked', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { getByTestId, container } = render(<UsageBanner />);
    fireEvent.click(getByTestId('usage-banner-dismiss'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(sessionStorage.getItem('usageBannerDismissed')).toBe('true');
  });

  it('stays hidden on a fresh mount if sessionStorage already has the dismiss flag', () => {
    sessionStorage.setItem('usageBannerDismissed', 'true');
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Chat/Input/__tests__/UsageBanner.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — `../UsageBanner` doesn't exist yet.

- [ ] **Step 3: Add the translation keys**

Add to `client/src/locales/en/translation.json`, replacing the removed `com_ui_credits_badge_tooltip` line from Task 1 (same spot, next to `com_ui_billing_upgrade_plan`):

```json
"com_ui_usage_banner_message": "{{percent}}% of your credits used",
"com_ui_usage_banner_message_with_reset": "{{percent}}% of your credits used — resets {{date}}",
"com_ui_usage_banner_dismiss": "Dismiss usage notice",
```

- [ ] **Step 4: Write the implementation**

```tsx
// client/src/components/Chat/Input/UsageBanner.tsx
import { useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRefillEligibilityDate } from 'librechat-data-provider';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const DISMISS_KEY = 'usageBannerDismissed';

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function getBandClassName(percentageUsed: number): string {
  if (percentageUsed >= 80) {
    return 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200';
  }
  return 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
}

export default function UsageBanner() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === 'true',
  );

  const {
    tokenCredits,
    refillAmount,
    autoRefillEnabled,
    refillIntervalValue,
    refillIntervalUnit,
    lastRefill,
  } = balanceQuery.data ?? {};

  if (dismissed || !startupConfig?.balance?.enabled || !refillAmount || tokenCredits == null) {
    return null;
  }

  const percentageUsed = clampPercentage(((refillAmount - tokenCredits) / refillAmount) * 100);
  if (percentageUsed < 60) {
    return null;
  }

  const roundedPercent = Math.round(percentageUsed);
  const resetDate =
    autoRefillEnabled === true && lastRefill != null && refillIntervalValue != null && refillIntervalUnit != null
      ? getRefillEligibilityDate(new Date(lastRefill), refillIntervalValue, refillIntervalUnit)
      : null;

  const message = resetDate
    ? localize('com_ui_usage_banner_message_with_reset', {
        percent: String(roundedPercent),
        date: resetDate.toLocaleDateString(),
      })
    : localize('com_ui_usage_banner_message', { percent: String(roundedPercent) });

  const handleDismiss = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div
      data-testid="usage-banner"
      role="button"
      tabIndex={0}
      onClick={() => navigate('/plans')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          navigate('/plans');
        }
      }}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-t-3xl border border-b-0 px-4 py-1.5 text-xs sm:rounded-t-3xl',
        getBandClassName(percentageUsed),
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        data-testid="usage-banner-dismiss"
        aria-label={localize('com_ui_usage_banner_dismiss')}
        onClick={handleDismiss}
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
```

Before treating this as final, verify against the real codebase: (a) `useAuthContext()`'s `isAuthenticated` field (already confirmed in `CreditsBadge.tsx`, which used the identical pattern — this file existed until Task 1 deleted it, so check `git show HEAD:client/src/components/Nav/CreditsBadge.tsx` or the plan text above under Task 1 if needed); (b) `getRefillEligibilityDate`'s exact export from `librechat-data-provider` (confirmed at `packages/data-provider/src/balance.ts`, re-exported via `packages/data-provider/src/index.ts`); (c) `useGetUserBalance`'s options shape (confirmed at `client/src/data-provider/Misc/queries.ts:21`, takes `UseQueryOptions<TBalanceResponse>` including `enabled`).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx jest src/components/Chat/Input/__tests__/UsageBanner.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (8 tests)

- [ ] **Step 6: Wire `UsageBanner` into `ChatForm.tsx`, restructuring the composer's rounded corners**

Read `client/src/components/Chat/Input/ChatForm.tsx` in full first — the exact surrounding code may have shifted slightly since this plan was written. The change described below is structural: it moves the composer's shadow and top-corner rounding onto a new wrapper `div`, so that when `UsageBanner` renders something, it becomes the visual top edge of the unit (rounded), and the composer's own top edge sits flush beneath it; when `UsageBanner` renders `null`, the wrapper's `overflow-hidden` + rounded-top styling apply directly to the composer as if nothing changed (this is the same "wrapper owns the radius, inner content is square but gets visually clipped" pattern already used elsewhere in this codebase, e.g. `UnifiedSidebar/ExpandedPanel.tsx`'s icon containers).

Add the import (place alongside the other same-directory component imports, e.g. near `TokenUsage`):

```tsx
import UsageBanner from './UsageBanner';
```

Change this block (currently around `ChatForm.tsx:286-295`):

```tsx
          <div
            onClick={handleContainerClick}
            className={cn(
              'relative flex w-full flex-grow flex-col overflow-hidden rounded-t-3xl border pb-4 text-text-primary transition-all duration-200 sm:rounded-3xl sm:pb-0',
              isTextAreaFocused ? 'shadow-lg' : 'shadow-md',
              isTemporary
                ? 'border-violet-800/60 bg-violet-950/10'
                : 'border-border-light bg-surface-chat',
            )}
          >
```

to:

```tsx
          <div
            className={cn(
              'w-full overflow-hidden rounded-t-3xl transition-all duration-200 sm:rounded-3xl',
              isTextAreaFocused ? 'shadow-lg' : 'shadow-md',
            )}
          >
            <UsageBanner />
            <div
              onClick={handleContainerClick}
              className={cn(
                'relative flex w-full flex-grow flex-col border pb-4 text-text-primary sm:pb-0',
                isTemporary
                  ? 'border-violet-800/60 bg-violet-950/10'
                  : 'border-border-light bg-surface-chat',
              )}
            >
```

This new outer `div` needs a matching closing tag. Find the `</div>` that currently closes the composer div you just modified (it's the one immediately before the line that closes the `'flex w-full items-center'` row — in the file as currently written, that's right after the `{TextToSpeech && automaticPlayback && <StreamAudio index={index} />}` line, around `ChatForm.tsx:417-419`):

```tsx
            {TextToSpeech && automaticPlayback && <StreamAudio index={index} />}
          </div>
        </div>
```

Add one more closing `</div>` for the new wrapper, so it becomes:

```tsx
            {TextToSpeech && automaticPlayback && <StreamAudio index={index} />}
            </div>
          </div>
        </div>
```

(The indentation of everything between the old opening tag and this closing sequence — `TextareaHeader`, `PendingManualSkillsChips`, `EditBadges`, `FileFormChat`, the textarea block, the footer button row, `StreamAudio` — shifts one level deeper since it's now nested one `div` further in. Re-indent that whole block; this is a pure formatting change, not a logic change. Run the formatter/linter in Step 7 to catch any indentation the editor doesn't fix automatically.)

- [ ] **Step 7: Run the existing ChatForm test suite (if any) and the full UsageBanner suite together, plus lint**

Run: `grep -rl "ChatForm" client/src/components/Chat/Input/__tests__ 2>/dev/null` — if this finds an existing spec file for `ChatForm` itself, run it and fix any failures caused by the new wrapper div before proceeding (e.g., a test asserting on the exact DOM depth of the composer). If no such file exists, skip straight to:

Run: `cd client && npx jest src/components/Chat/Input/__tests__/UsageBanner.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (still 8 tests)

Run (from repo root, not from inside `client/` — running eslint from inside `client/` hits an unrelated tsconfig path-resolution issue in this repo):
`npx eslint client/src/components/Chat/Input/ChatForm.tsx client/src/components/Chat/Input/UsageBanner.tsx client/src/components/Chat/Input/__tests__/UsageBanner.spec.tsx`
Expected: no errors.

- [ ] **Step 8: SKIP commit** — do not run `git add`/`git commit`.

---

## Task 3: `TokenBalanceLimitModal` — hard-limit dialog on a fresh insufficient-funds error

**Files:**
- Create: `client/src/components/Chat/Input/TokenBalanceLimitModal.tsx`
- Create: `client/src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx`
- Modify: `client/src/components/Chat/Input/ChatForm.tsx`
- Modify: `client/src/locales/en/translation.json`

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx
import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, act } from 'test/layout-test-utils';
import { useGetUserBalance } from '~/data-provider';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import TokenBalanceLimitModal from '../TokenBalanceLimitModal';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetUserBalance: jest.fn(),
  useGetStartupConfig: jest.fn(() => ({ data: { balance: { enabled: true } } })),
}));

jest.mock('~/hooks/Messages/useLatestMessage', () => ({
  useLatestMessage: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockBalanceQuery = useGetUserBalance as jest.Mock;
const mockLatestMessage = useLatestMessage as jest.Mock;

const tokenBalanceErrorText = JSON.stringify({ type: 'token_balance', balance: 0 });

describe('TokenBalanceLimitModal', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockBalanceQuery.mockReturnValue({ data: { autoRefillEnabled: false } });
  });

  it('does not open for a token_balance error that is already the latest message at mount', () => {
    mockLatestMessage.mockReturnValue({
      messageId: 'msg-1',
      error: true,
      text: tokenBalanceErrorText,
    });
    const { queryByText } = render(<TokenBalanceLimitModal index={0} />);
    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('opens when a fresh token_balance error appears after mount', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Out of credits')).toBeInTheDocument();
  });

  it('does not open for a different error type', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, queryByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: JSON.stringify({ type: 'message_limit', max: 5, windowInMinutes: 1 }),
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('renders the checklist and navigates to /plans on the primary CTA', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Continue this conversation right away')).toBeInTheDocument();
    expect(getByText('Higher monthly credit allowance')).toBeInTheDocument();
    expect(getByText('Buy a one-time top-up instead, if you prefer')).toBeInTheDocument();
    expect(getByText('Cancel or change plans anytime in Settings')).toBeInTheDocument();

    fireEvent.click(getByText('View plans'));
    expect(mockNavigate).toHaveBeenCalledWith('/plans');
  });

  it('shows "Maybe later" and closes without navigating when autoRefillEnabled is false', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText, queryByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    fireEvent.click(getByText('Maybe later'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('shows "Wait until [date]" when autoRefillEnabled is true with a computable date', () => {
    mockBalanceQuery.mockReturnValue({
      data: {
        autoRefillEnabled: true,
        refillIntervalValue: 1,
        refillIntervalUnit: 'months',
        lastRefill: '2026-08-01T00:00:00.000Z',
      },
    });
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    const expectedDate = new Date('2026-09-01T00:00:00.000Z').toLocaleDateString();
    expect(getByText(`Wait until ${expectedDate}`)).toBeInTheDocument();
  });
});
```

Check `test/layout-test-utils`'s `render` wraps a router and renders through the real i18next pipeline (confirmed in this project's other billing tests, e.g. `PlansView.spec.tsx`, `CreditsBadge.spec.tsx`) — the exact-English-string assertions above (`'Out of credits'`, `'Continue this conversation right away'`, etc.) depend on that and on the translation keys added in Step 3 using exactly this wording.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx --testTimeout=30000 --coverage=false`
Expected: FAIL — `../TokenBalanceLimitModal` doesn't exist yet.

- [ ] **Step 3: Add the translation keys**

Add to `client/src/locales/en/translation.json`, next to the `com_ui_usage_banner_*` keys added in Task 2:

```json
"com_ui_limit_modal_title": "Out of credits",
"com_ui_limit_modal_body": "You've used all your credits for this cycle. Upgrade or buy a top-up to keep going now:",
"com_ui_limit_modal_body_with_reset": "You've used all your credits for this cycle. They reset {{date}}. Upgrade or buy a top-up to keep going now:",
"com_ui_limit_modal_benefit_continue": "Continue this conversation right away",
"com_ui_limit_modal_benefit_allowance": "Higher monthly credit allowance",
"com_ui_limit_modal_benefit_topup": "Buy a one-time top-up instead, if you prefer",
"com_ui_limit_modal_benefit_manage": "Cancel or change plans anytime in Settings",
"com_ui_limit_modal_cta": "View plans",
"com_ui_limit_modal_wait": "Wait until {{date}}",
"com_ui_limit_modal_wait_generic": "Maybe later",
```

- [ ] **Step 4: Write the implementation**

```tsx
// client/src/components/Chat/Input/TokenBalanceLimitModal.tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ViolationTypes, getRefillEligibilityDate } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle, Button } from '@librechat/client';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import { extractJson, isJson } from '~/utils/json';
import { useAuthContext, useLocalize } from '~/hooks';

type TokenBalanceLimitModalProps = {
  index: number;
};

function isTokenBalanceError(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const jsonString = extractJson(text);
  if (!isJson(jsonString)) {
    return false;
  }
  const parsed = JSON.parse(jsonString) as { type?: string };
  return parsed.type === ViolationTypes.TOKEN_BALANCE;
}

export default function TokenBalanceLimitModal({ index }: TokenBalanceLimitModalProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const latestMessage: TMessage | null = useLatestMessage(index);
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });
  const [open, setOpen] = useState(false);
  const hasSeededRef = useRef(false);
  const suppressedIdRef = useRef<string | null>(null);
  const notifiedIdRef = useRef<string | null>(null);

  if (!hasSeededRef.current) {
    hasSeededRef.current = true;
    if (latestMessage?.error === true && isTokenBalanceError(latestMessage.text)) {
      suppressedIdRef.current = latestMessage.messageId ?? null;
    }
  }

  useEffect(() => {
    const messageId = latestMessage?.messageId;
    if (!messageId) {
      return;
    }
    if (messageId === suppressedIdRef.current || messageId === notifiedIdRef.current) {
      return;
    }
    if (latestMessage?.error === true && isTokenBalanceError(latestMessage.text)) {
      notifiedIdRef.current = messageId;
      setOpen(true);
    }
  }, [latestMessage]);

  const { autoRefillEnabled, refillIntervalValue, refillIntervalUnit, lastRefill } =
    balanceQuery.data ?? {};
  const resetDate =
    autoRefillEnabled === true && lastRefill != null && refillIntervalValue != null && refillIntervalUnit != null
      ? getRefillEligibilityDate(new Date(lastRefill), refillIntervalValue, refillIntervalUnit)
      : null;

  const handleViewPlans = () => {
    setOpen(false);
    navigate('/plans');
  };

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <OGDialogContent className="w-11/12 max-w-md">
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_limit_modal_title')}</OGDialogTitle>
        </OGDialogHeader>
        <p className="text-sm text-text-secondary">
          {resetDate
            ? localize('com_ui_limit_modal_body_with_reset', {
                date: resetDate.toLocaleDateString(),
              })
            : localize('com_ui_limit_modal_body')}
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-text-secondary">
          <li>{localize('com_ui_limit_modal_benefit_continue')}</li>
          <li>{localize('com_ui_limit_modal_benefit_allowance')}</li>
          <li>{localize('com_ui_limit_modal_benefit_topup')}</li>
          <li>{localize('com_ui_limit_modal_benefit_manage')}</li>
        </ul>
        <Button variant="submit" onClick={handleViewPlans} className="w-full">
          {localize('com_ui_limit_modal_cta')}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full text-center text-xs text-text-secondary underline"
        >
          {resetDate
            ? localize('com_ui_limit_modal_wait', { date: resetDate.toLocaleDateString() })
            : localize('com_ui_limit_modal_wait_generic')}
        </button>
      </OGDialogContent>
    </OGDialog>
  );
}
```

Before treating this as final, verify against the real codebase: (a) `OGDialog`/`OGDialogContent`/`OGDialogHeader`/`OGDialogTitle`'s exact prop signatures (confirmed in `client/src/components/Nav/SettingsTabs/Billing/SubscriptionStatusItem.tsx`, which uses this exact combination for the cancel-plan confirmation — note that example also uses `OGDialogTrigger`, which this component does NOT need since `open` is controlled programmatically rather than by a visible trigger button; confirm `OGDialogContent` renders correctly with no `OGDialogTrigger` sibling present); (b) `OGDialogContent` already renders its own built-in ✕ close button by default (confirmed in `packages/client/src/components/Dialog.tsx`, `showCloseButton` defaults to `true`) — do not add a second manual close button, only the "Wait until.../Maybe later" text link described above; (c) `Button`'s `variant="submit"` renders the brand-green color used elsewhere for upgrade CTAs (already established this session in `PlanList.tsx`/`TopupList.tsx`/`PlansView.tsx`) rather than the default near-black variant.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd client && npx jest src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (6 tests)

- [ ] **Step 6: Mount `TokenBalanceLimitModal` in `ChatForm.tsx`**

Add the import (alongside the `UsageBanner` import added in Task 2):

```tsx
import TokenBalanceLimitModal from './TokenBalanceLimitModal';
```

Add `<TokenBalanceLimitModal index={index} />` as the first child inside the outermost returned `div` (currently `<div className="relative flex h-full flex-1 items-stretch md:flex-col">`, around `ChatForm.tsx:260`) — it renders no visible layout of its own (the dialog only appears in the DOM when triggered), so its exact position among siblings doesn't affect layout:

```tsx
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <TokenBalanceLimitModal index={index} />
        {/* Primary composer owns the selection popup so split-view doesn't double it. */}
        {index === 0 && quotesEnabled && <QuoteButton conversationId={conversationId} />}
        ...
```

- [ ] **Step 7: Run both new suites together plus lint**

Run: `cd client && npx jest src/components/Chat/Input/__tests__/UsageBanner.spec.tsx src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx --testTimeout=30000 --coverage=false`
Expected: PASS (14 tests total)

Run (from repo root):
`npx eslint client/src/components/Chat/Input/ChatForm.tsx client/src/components/Chat/Input/TokenBalanceLimitModal.tsx client/src/components/Chat/Input/__tests__/TokenBalanceLimitModal.spec.tsx`
Expected: no errors.

- [ ] **Step 8: SKIP commit** — do not run `git add`/`git commit`.

---

## Task 4: Manual verification (cannot be automated)

**No new test** — this task is a checklist for a human with a running dev server and browser, since it covers real-time SSE behavior and visual polish that can't be exercised by Jest/jsdom.

- [ ] **Step 1: Verify the banner appears and looks right**

With both dev servers running, log in as a user with `balance.enabled` true and `tokenCredits`/`refillAmount` set so usage is ≥60%. Confirm: the banner appears attached flush to the top of the composer with no visible gap or double border, its rounded top corners match the composer's own corner radius exactly, the color is amber at 60–79% and red at ≥80%, clicking the banner body navigates to `/plans`, and clicking the ✕ hides it immediately without navigating.

- [ ] **Step 2: Verify dismiss persistence**

After dismissing, reload the page in the same tab — confirm the banner stays hidden (same `sessionStorage`-backed tab session). Then close the tab entirely and open a fresh one to the same conversation — confirm the banner reappears (new session).

- [ ] **Step 3: Verify the composer looks unchanged when the banner is absent**

Log in as (or switch to) a user with usage below 60%, or with `balance.enabled` false. Confirm the composer's rounded corners and shadow look pixel-identical to how they looked before this change — this confirms the `overflow-hidden` wrapper restructuring in Task 2 didn't alter the common case.

- [ ] **Step 4: Verify the hard-limit modal**

Using a test account at zero balance (or temporarily set one via the database, as done earlier this session), send a message so it fails with the insufficient-funds error. Confirm: the "Out of credits" modal appears once, showing the checklist and (if `autoRefillEnabled` is true for that account) a reset date; clicking "View plans" navigates there; reopening the same conversation afterward (e.g., via page reload) does NOT re-trigger the modal for that same historical error — it should only fire on the live moment of failure.

- [ ] **Step 5: Verify no popover/dropdown clipping regression**

Open the "Attach File" and "Tools"/MCP dropdown menus in the composer footer and confirm they still render fully visible, not clipped by the new `overflow-hidden` wrapper introduced in Task 2 (these menus are expected to portal outside the composer's DOM subtree, but this should be confirmed visually since it wasn't feasible to verify via static code reading alone).

---

## Self-Review Notes

**Spec coverage:**
- Badge removal: Task 1.
- Banner thresholds (hidden <60%, amber 60–79%, red ≥80%), reset-date-or-omit copy, session-scoped dismiss, click-through to `/plans`, attached-to-composer visual treatment: Task 2.
- Modal trigger (fresh `token_balance` error only, not historical), checklist content, primary/secondary CTAs, reset-date-or-generic-fallback copy: Task 3.
- Manual, non-automatable verification (visual attachment, dismiss-across-sessions, live SSE trigger, dropdown-clipping check): Task 4, explicitly flagged as not subagent-executable.
- Explicitly out of scope per the design spec (new backend endpoint, toast-on-crossing, proactive non-send-triggered modal): correctly not implemented anywhere in this plan.

**Type consistency check:** `UsageBanner`'s destructured balance fields (`tokenCredits`, `refillAmount`, `autoRefillEnabled`, `refillIntervalValue`, `refillIntervalUnit`, `lastRefill`) and `TokenBalanceLimitModal`'s (`autoRefillEnabled`, `refillIntervalValue`, `refillIntervalUnit`, `lastRefill`) both match `TBalanceResponse` exactly (`packages/data-provider/src/types.ts:772-780`) — no invented field names. Both components call `getRefillEligibilityDate` with the identical `(new Date(lastRefill), refillIntervalValue, refillIntervalUnit)` signature, matching `packages/data-provider/src/balance.ts:16-20` exactly (note `lastRefill` is typed `Date | string` in `TBalanceResponse` since it arrives as a JSON string over the wire — both call sites wrap it in `new Date(...)` before passing it in).

**Deliberate architecture choice, flagged for visibility:** `UsageBanner` and `ChatForm`'s corner-radius handling do NOT communicate via a callback prop or shared hook — `UsageBanner` is a fully self-contained, zero-prop component (matching the `CreditsBadge` precedent), and the "flat top when banner shows, rounded top when it doesn't" behavior falls out automatically from moving `overflow-hidden` + `rounded-t-3xl` to a wrapper `div` that contains both. This was chosen over a `onVisibleChange` callback specifically to avoid two components' state falling out of sync, at the cost of a moderately invasive restructuring of `ChatForm.tsx`'s JSX nesting — flagged in Task 2, Step 6 and Task 4, Step 3 for extra scrutiny during review and manual testing.
