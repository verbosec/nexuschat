# Billing Upgrade Nudges — Design Spec

**Goal:** Give users a clear path to upgrading when they run out of token credits (reactive) or are approaching their limit (proactive), closing the gap where the current "Insufficient Funds" error gives no indication that billing/upgrading exists at all.

**Context:** This Nexus AI fork already has a full Lago-backed billing system (Settings → Billing tab; public `/plans` and `/plans/:planCode` pages that auto-trigger checkout). What's missing is any UI that connects a user's actual usage state to that system.

---

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Both reactive (at-limit) and proactive (approaching-limit, e.g. 80% used) nudges | User confirmed both are wanted, not just the reactive error fix. |
| Proactive nudge form | Persistent badge only — no one-time toast/banner on threshold crossing | User's explicit choice; simpler, no dismiss-state tracking needed. |
| Badge placement | New ambient spot in the sidebar footer, not the existing account dropdown | Visible during normal chat use without opening any menu — the dropdown line already exists but isn't ambient enough to serve as a nudge. |
| Backend work | None — Approach A (existing balance data only), Approach B (dedicated `/api/billing/usage` endpoint) explicitly deferred | `refillAmount` already is the correct "full" reference value (the Lago webhook sets it directly to the plan's granted allowance) — no new computation needed server-side today. |
| Click-through destination | Both nudges link to `/plans` (not the Settings dialog) | Simplest — no need to coordinate cross-component dialog-open state; `/plans` is already the purpose-built upgrade page. |

---

## Existing Infrastructure Audit

Before designing new UI, the following was checked for reuse:

- **`Banner`** (`client/src/components/Banners/Banner.tsx`) — global, admin-configured message slot driven by backend content (`useGetBannerQuery`). Built for broadcast announcements (e.g. maintenance notices), not live per-user state. Not a fit — wrong shape for a value that changes per-user, per-request.
- **Toast system** (`useToastContext`) — used throughout for transient notifications. Available but not used here, since the proactive nudge is explicitly a persistent badge, not a toast.
- **`OGDialog`** — modal primitive used elsewhere in billing (cancel-plan confirmation). Not needed here — no modal in this design.
- **`MemoryUsageBadge`** (`client/src/components/SidePanel/Memories/MemoryUsageBadge.tsx`) — a percentage/progress badge for a *different* feature (memory limits). Not reused directly (different data shape), but its existence confirms this style of indicator is an established pattern in this codebase.
- **No existing "upgrade" or "usage limit" nudge UI was found anywhere** — confirmed via a broad search. The only current touchpoint is the raw inline error in `Error.tsx`, rendered as a red message bubble in the chat transcript (via `MessageContent.tsx`), with no link anywhere.

---

## Architecture

Two independent, additive changes to existing frontend components. No new backend endpoints, no new data-provider queries — both changes consume data that's already fetched elsewhere in the app (`useGetUserBalance()`, `useGetStartupConfig()`).

```
Reactive:  checkBalance() throws (existing) → SSE error → Error.tsx token_balance case
           → [NEW] "Upgrade your plan" link → /plans

Proactive: CreditsBadge (new) → useGetUserBalance() + useGetStartupConfig() (existing hooks)
           → compute % used → color-coded badge → /plans
```

---

## Components

### 1. `Error.tsx` (modified)

The existing `token_balance` renderer function (a plain function in a lookup object, invoked from within the `Error` functional component's render body) gets one addition: a `<Link to="/plans">`-styled "Upgrade your plan" button, rendered after the existing "Insufficient Funds! Balance: X. Prompt tokens: Y. Cost: Z." text, inside the same error bubble. The existing message text is unchanged — this is additive only.

### 2. `CreditsBadge.tsx` (new)

Self-contained (calls its own hooks internally — no container/presentational split, since it has exactly one use site). Placed in `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`, inside the existing `<div className="mt-auto">` footer block, directly above `<AccountSettings collapsed />`.

```tsx
// Rough shape
export default function CreditsBadge() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated } = useAuthContext();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });

  const { tokenCredits, refillAmount } = balanceQuery.data ?? {};

  if (!startupConfig?.balance?.enabled || !refillAmount || tokenCredits == null) {
    return null;
  }

  const percentageUsed = clamp(((refillAmount - tokenCredits) / refillAmount) * 100, 0, 100);
  const colorBand = percentageUsed >= 80 ? 'red' : percentageUsed >= 60 ? 'amber' : 'green';

  return (
    <Link to="/plans" className={/* color-banded pill: bg-{color}-100 text-{color}-700, rounded-full, text-xs */}>
      {`${Math.round(percentageUsed)}% used`}
    </Link>
  );
}
```

A simple colored text pill (`"73% used"`), not a radial/circular progress ring like `MemoryUsageBadge` — keeps the implementation small and avoids a second visual language for "usage" in the sidebar. Exact Tailwind color tokens for each band are an implementation-time detail (match whatever this codebase's existing green/amber/red conventions are, e.g. the `text-green-600` already used in the Plans savings badge).

---

## Data Flow

`CreditsBadge` reuses the exact same `useGetUserBalance()` hook already used by `BillingControls.tsx`'s `useBalance()` and `AccountSettings.tsx` — same query, same cache entry, no duplicate network requests beyond React Query's normal dedup.

```
percentageUsed = clamp(((refillAmount - tokenCredits) / refillAmount) * 100, 0, 100)
```

- `refillAmount` is the amount granted per refill cycle — for subscribed users this is set directly from the plan's token allowance by the Lago webhook handler (`handleSubscriptionStarted` sets `refillAmount: tokenCredits`), so it's already the correct "full" reference without any new lookup.
- Renders **nothing** when: balance tracking is disabled site-wide (`startupConfig.balance.enabled` false), the balance query hasn't resolved yet, or `refillAmount` is unset/zero. A user without a refill cycle configured has no meaningful "percent of what" to show — better to hide than show a confusing bare number.
- Color bands: **green** (<60% used), **amber** (60–79% used), **red** (≥80% used).
- The whole badge is a `<Link to="/plans">` (react-router) — no click handler/state coordination needed.

---

## Error Handling

Both changes are purely presentational additions to already-tested code paths — no new failure modes are introduced.

- `CreditsBadge` fails safe: any missing/loading/zero-denominator state renders `null` rather than a broken or misleading partial badge.
- `Error.tsx`'s existing error-rendering behavior (including the `defaultResponse` fallback for non-JSON errors, and all other violation types in the same lookup object) is untouched — only the `token_balance` case gains the new link.

---

## Testing Approach

Per this project's testing philosophy (real logic over mocks): both are presentational component tests using this codebase's established `test/layout-test-utils` render (already wraps `QueryClientProvider`, `RecoilRoot`, `Router`, `AuthContextProvider`).

- **`CreditsBadge.spec.tsx`** (new): hidden when `startupConfig.balance.enabled` is false; hidden when `refillAmount` is unset; renders green/amber/red at representative percentages (e.g. 40%, 70%, 90% used); renders a link with `href` pointing at `/plans`.
- **`Error.spec.tsx`** (new — no test currently exists for this component): confirms the existing "Insufficient Funds..." message text still renders for the `token_balance` case; asserts the new "Upgrade your plan" link is present and points to `/plans`; confirms other error types (e.g. `message_limit`, the default JSON-parse-failure path) are unaffected by this change.

---

## Explicitly Out of Scope (deferred, not forgotten)

- **Approach B** — a dedicated `/api/billing/usage` backend endpoint. Not needed today since `refillAmount` already provides the correct denominator client-side; revisit only if the percentage computation needs to get smarter (e.g. accounting for top-up add-ons separately from the base plan allowance).
- **One-time toast/banner on threshold crossing** — explicitly rejected in favor of the persistent badge alone.
- **Free-tier users with no `refillAmount` configured** — the badge simply won't show for them under this design. If free-tier proactive nudging turns out to matter, that's a separate follow-up (would need a different "full" reference, e.g. `balanceConfig.startBalance`, since free tier may not have autoRefill configured at all).
