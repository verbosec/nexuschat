# Usage Banner & Hard-Limit Modal — Design Spec

**Goal:** Make running low on credits impossible to miss, and give users a clear, low-friction path to upgrade the moment they actually hit zero — modeled on the persistent usage banner and "Keep using Claude?" modal patterns from Claude.ai, adapted to Nexus AI's self-hosted Lago billing.

**Context:** This session previously built a first pass at billing upgrade nudges (`docs/superpowers/specs/2026-07-22-billing-upgrade-nudges-design.md`): a reactive "Upgrade your plan" link in the chat error bubble, and a small color-coded `CreditsBadge` icon in the sidebar footer. That work is implemented but was never committed and the badge has not yet been seen live in the browser. This spec **supersedes the proactive half of that work** — the badge is replaced by a banner attached to the composer, which the user judged more visible than an icon tucked into the collapsed sidebar rail. The reactive link stays as-is and is complemented, not replaced, by a new hard-limit modal.

---

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Badge vs. banner | Banner **replaces** `CreditsBadge` entirely | User's explicit call — one clear nudge spot instead of two, and the banner is more visible than an icon in the collapsed sidebar rail. |
| Banner style | Attached strip, fused to the top of the composer (mockup "A") | Closest to the Claude.ai reference; reads as one unit with the composer rather than a separate floating element. |
| Banner thresholds | Two bands: amber ≥60%, red ≥80% (hidden below 60%) | Matches the color logic already built and tested for the badge — reused, not reinvented. |
| Banner dismiss behavior | Session-scoped (`sessionStorage`), reappears on next session regardless of band | User's explicit choice over "reappears only on severity increase" or "never reappears." |
| Hard-limit modal style | Full checklist style (mockup "full") | User's explicit call over the shorter one-paragraph alternative — closer to the Claude.ai reference. |
| Modal trigger | On send attempt, when a fresh `token_balance` error message appears | Matches how Claude.ai's own modal triggers (the wall appears when you try to continue), and requires no changes to the existing SSE/error pipeline. |
| Reset-date copy | Omit the "resets on X" clause entirely when no date is computable | User's choice — cleaner than a vague placeholder phrase for top-up-only accounts with no scheduled refill. |
| Backend work | None | `getRefillEligibilityDate` already exists in `packages/data-provider/src/balance.ts`; `useGetUserBalance()` already returns every field both components need. |

---

## Architecture

Two new frontend components, one removal. No new backend endpoints, no new data-provider queries.

```
Removed:  CreditsBadge.tsx + its wiring in UnifiedSidebar/ExpandedPanel.tsx

New:      UsageBanner        → useGetUserBalance() + useGetStartupConfig() (existing hooks)
                             → mounted in ChatForm.tsx, directly above the composer's
                               rounded container, sharing its rounded corners

          TokenBalanceLimitModal → useLatestMessage(index) (existing hook)
                             → detects a fresh token_balance error on the active branch
                             → opens an OGDialog (existing modal primitive)
```

Both components are independent and additive to already-working code paths: the balance query is unchanged, and the SSE error flow that produces the `token_balance` error message (and the existing inline "Upgrade your plan" link from Task 1 of the prior spec) is untouched.

---

## Components

### 1. `UsageBanner` (new)

**Location:** `client/src/components/Chat/Input/UsageBanner.tsx`, mounted in `ChatForm.tsx` as a sibling immediately before the composer's rounded container (`client/src/components/Chat/Input/ChatForm.tsx:286`), inside the same `<div className={cn('flex w-full items-center', ...)}>` wrapper.

**Data:** `useGetUserBalance()` for `tokenCredits`, `refillAmount`, `autoRefillEnabled`, `refillIntervalValue`, `refillIntervalUnit`, `lastRefill`; `useGetStartupConfig()` for the `balance.enabled` gate — the same two hooks and the same hide-conditions `CreditsBadge` used (hidden when balance tracking is off, `refillAmount` is unset, or the query hasn't resolved).

**Percentage formula** (unchanged from the badge):
```
percentageUsed = clamp(((refillAmount - tokenCredits) / refillAmount) * 100, 0, 100)
```

**Visibility:** hidden below 60% used. Amber 60–79%, red ≥80%.

**Reset date:** when `autoRefillEnabled` is true, compute via the existing `getRefillEligibilityDate(lastRefill, refillIntervalValue, refillIntervalUnit)` from `packages/data-provider/src/balance.ts` and render a short date (e.g. "Sep 15"). When `autoRefillEnabled` is false (top-up-only accounts have no scheduled refill), the date clause is omitted entirely — copy reads just "75% of your credits used."

**Interaction:** clicking the banner body navigates to `/plans` (same destination as every other nudge in this feature). The ✕ dismiss control stops propagation, hides the banner, and writes a flag to `sessionStorage` (cleared automatically when the tab closes, which is exactly "reappears next session").

**Visual treatment:** rounded top corners matching the composer's `rounded-t-3xl`/`sm:rounded-3xl`, no bottom radius, sitting flush against the composer with no gap — the composer's own top radius is removed when the banner is showing so the two read as one continuous shape, matching mockup "A".

### 2. `TokenBalanceLimitModal` (new)

**Location:** `client/src/components/Chat/Input/TokenBalanceLimitModal.tsx`, mounted alongside `ChatForm` (same `index` prop it already threads through).

**Detection:** reads `useLatestMessage(index)` — the same hook already relied on elsewhere in this codebase for "is the tail of the active branch an error." Parses the message text with the same JSON-extraction helper `Error.tsx` uses, and checks for `type === ViolationTypes.TOKEN_BALANCE`.

**Freshness guard:** on mount, whatever message is currently the latest is recorded as already-seen (a ref), so reopening or reloading a conversation that already ended in this error does not retrigger the modal. Only a `token_balance` error that becomes the latest message *after* mount opens the dialog — i.e., a live send attempt that just failed.

**Content** (`OGDialog`, the modal primitive already used elsewhere in billing for the cancel-plan confirmation):
- Title: "Out of credits"
- Body: "You've used all your credits for this cycle{{, resets on [date]}}. Upgrade or buy a top-up to keep going now:" — same omit-if-unknown rule as the banner for the date clause.
- Checklist (real capabilities only, not borrowed marketing copy): continue this conversation right away; higher monthly credit allowance; buy a one-time top-up instead, if you prefer; cancel or change plans anytime in Settings.
- Primary CTA: "View plans" → navigates to `/plans`.
- Secondary action: "Wait until [date]" (or "Maybe later" when there's no date) — closes the dialog, same as the ✕.

No additional dismiss-persistence is needed beyond the freshness guard above — this is a one-time reaction to a live event, not a recurring status indicator.

---

## Data Flow

Both components consume data that is already fetched elsewhere in the app (`useGetUserBalance()`, `useGetStartupConfig()`, `useLatestMessage()`) — no new network requests beyond React Query's normal cache dedup, and no new backend endpoints.

```
UsageBanner:            useGetUserBalance() + useGetStartupConfig()
                         → percentageUsed → band → (date via getRefillEligibilityDate, if autoRefillEnabled)

TokenBalanceLimitModal:  useLatestMessage(index) → parse error JSON → type check
                         → (date via getRefillEligibilityDate, if autoRefillEnabled, from the balance query)
```

---

## Error Handling

- Both components fail safe: any missing/loading balance state renders nothing (banner) or never opens (modal) — same pattern the badge already used.
- The two components are independent; a problem in one's data does not block the other or the composer itself.
- Removing `CreditsBadge` means deleting `client/src/components/Nav/CreditsBadge.tsx`, `client/src/components/Nav/__tests__/CreditsBadge.spec.tsx`, and reverting its wiring (and test mock) in `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` and `ExpandedPanel.spec.tsx` back to their pre-badge state. This is a deliberate reversal of reviewed work from the prior session, not a bug.
- The existing inline "Upgrade your plan" link in `Error.tsx` (Task 1 of the prior spec) is untouched — it remains the permanent record in chat history, while the modal is the one-time interruption at the moment of failure.

---

## Testing Approach

Per this project's real-logic-over-mocks philosophy, both new components get presentational tests using `test/layout-test-utils`:

- **`UsageBanner.spec.tsx`**: hidden below 60%, amber at 60–79%, red at ≥80%, hidden when balance tracking is off or `refillAmount` is unset, reset-date-present vs. omitted (mocking `autoRefillEnabled`/`lastRefill`), dismiss-then-hidden-until-sessionStorage-is-cleared, click-through to `/plans`.
- **`TokenBalanceLimitModal.spec.tsx`**: does not open for a `token_balance` error that's already the latest message at mount; opens when a fresh one appears after mount; does not open for other error types or non-error messages; checklist content renders; both CTAs (primary navigate, secondary close) work.
- `ExpandedPanel.spec.tsx`'s `CreditsBadge` mock and any assertions tied to it are removed as part of the badge removal.

---

## Explicitly Out of Scope

- **A dedicated backend usage endpoint** — still not needed; every field both components use already exists in the current balance response.
- **One-time toast/banner on threshold crossing** — the banner is a persistent (session-scoped) indicator, not a toast; this was already rejected in the prior spec and remains out of scope here.
- **A proactive (non-send-triggered) hard-limit modal** — the modal only fires reactively, on an actual failed send attempt, per the user's explicit choice.
- **Free-tier / no-`refillAmount` users** — the banner simply doesn't show for them, same limitation the badge had; unchanged from the prior spec.
