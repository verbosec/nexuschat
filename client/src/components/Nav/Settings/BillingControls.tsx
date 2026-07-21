import type { TBalanceResponse } from 'librechat-data-provider';
import AutoRefillSettings from '../SettingsTabs/Balance/AutoRefillSettings';
import SubscriptionStatusItem from '../SettingsTabs/Billing/SubscriptionStatusItem';
import TokenCreditsItem from '../SettingsTabs/Balance/TokenCreditsItem';
import InvoiceList from '../SettingsTabs/Billing/InvoiceList';
import PlanList from '../SettingsTabs/Billing/PlanList';
import TopupList from '../SettingsTabs/Billing/TopupList';
import {
  useGetStartupConfig,
  useGetUserBalance,
  useGetBillingPlansQuery,
  useGetBillingTopupsQuery,
  useGetBillingSubscriptionQuery,
  useGetBillingInvoicesQuery,
  useBillingCheckoutMutation,
  useBillingTopupCheckoutMutation,
  useCancelSubscriptionMutation,
} from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';

function useBalance(): Partial<TBalanceResponse> {
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });

  return balanceQuery.data ?? {};
}

export function TokenCredits() {
  const { tokenCredits = 0 } = useBalance();
  return <TokenCreditsItem tokenCredits={tokenCredits} />;
}

export function AutoRefill() {
  const localize = useLocalize();
  const {
    autoRefillEnabled = false,
    lastRefill,
    refillAmount,
    refillIntervalUnit,
    refillIntervalValue,
  } = useBalance();

  const hasValidRefillSettings =
    lastRefill !== undefined &&
    refillAmount !== undefined &&
    refillIntervalUnit !== undefined &&
    refillIntervalValue !== undefined;

  if (!autoRefillEnabled) {
    return (
      <div className="text-sm text-text-secondary">
        {localize('com_nav_balance_auto_refill_disabled')}
      </div>
    );
  }

  if (!hasValidRefillSettings) {
    return (
      <div className="text-sm text-red-500">{localize('com_nav_balance_auto_refill_error')}</div>
    );
  }

  return (
    <AutoRefillSettings
      lastRefill={lastRefill}
      refillAmount={refillAmount}
      refillIntervalUnit={refillIntervalUnit}
      refillIntervalValue={refillIntervalValue}
    />
  );
}

export function Plans() {
  const { data: plans, isLoading, isError } = useGetBillingPlansQuery();
  const { data: subscription } = useGetBillingSubscriptionQuery();
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
      currentPlanCode={subscription?.plan}
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
    <TopupList
      topups={topups}
      isLoading={isLoading}
      isError={isError}
      isBuying={isBuying}
      onBuy={handleBuy}
    />
  );
}

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

export function Invoices() {
  const { data: invoices, isLoading, isError } = useGetBillingInvoicesQuery();
  return <InvoiceList invoices={invoices} isLoading={isLoading} isError={isError} />;
}
