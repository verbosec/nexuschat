import { useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getRefillEligibilityDate } from 'librechat-data-provider';
import type { MouseEvent } from 'react';
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
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === 'true');

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
    autoRefillEnabled === true &&
    lastRefill != null &&
    refillIntervalValue != null &&
    refillIntervalUnit != null
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
          event.preventDefault();
          navigate('/plans');
        }
      }}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-t-3xl border border-b-0 px-4 py-1.5 text-xs',
        getBandClassName(percentageUsed),
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        data-testid="usage-banner-dismiss"
        aria-label={localize('com_ui_usage_banner_dismiss')}
        onClick={handleDismiss}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
          }
        }}
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
