import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
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
  const {
    mutateAsync: checkout,
    isLoading: isSubscribing,
    isError: isCheckoutError,
  } = useBillingCheckoutMutation();
  const hasTriggeredRef = useRef(false);

  const matchedPlan = planCode ? plans?.find((plan) => plan.code === planCode) : undefined;

  const triggerCheckout = useCallback(
    async (code: string) => {
      hasTriggeredRef.current = true;
      try {
        const { url } = await checkout(code);
        window.location.href = url;
      } catch {
        // isCheckoutError (from the mutation's own state) drives the error UI.
      }
    },
    [checkout],
  );

  useEffect(() => {
    if (!planCode || !matchedPlan || hasTriggeredRef.current) {
      return;
    }
    triggerCheckout(matchedPlan.code);
  }, [planCode, matchedPlan, triggerCheckout]);

  const handleRetry = () => {
    if (!matchedPlan) {
      return;
    }
    hasTriggeredRef.current = false;
    triggerCheckout(matchedPlan.code);
  };

  const handleSubscribe = async (code: string) => {
    const { url } = await checkout(code);
    window.location.href = url;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center text-sm text-red-500">
        {localize('com_ui_billing_plans_error')}
      </div>
    );
  }

  if (planCode) {
    if (!matchedPlan) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="text-sm text-red-500">{localize('com_ui_billing_plan_not_found')}</div>
          <Link to="/plans" className="text-sm font-medium text-primary hover:underline">
            {localize('com_ui_billing_browse_plans')}
          </Link>
        </div>
      );
    }

    if (isCheckoutError) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="text-sm text-red-500">{localize('com_ui_billing_checkout_error')}</div>
          <Button variant="submit" size="sm" onClick={handleRetry}>
            {localize('com_ui_retry')}
          </Button>
          <Link to="/plans" className="text-sm font-medium text-primary hover:underline">
            {localize('com_ui_billing_browse_plans')}
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Spinner className="h-6 w-6 text-text-secondary" />
        <p className="text-sm text-text-secondary">{localize('com_ui_billing_redirecting')}</p>
      </div>
    );
  }

  const visiblePlans = (plans ?? []).filter((plan) => plan.interval === interval);

  const annualSavingsPercent = (() => {
    const percents = (plans ?? [])
      .filter((plan) => plan.interval === 'annual')
      .map((plan) => {
        const monthlySibling = (plans ?? []).find(
          (candidate) => candidate.tier === plan.tier && candidate.interval === 'monthly',
        );
        if (!monthlySibling || monthlySibling.amountCents <= 0) {
          return null;
        }
        return Math.round((1 - plan.amountCents / (monthlySibling.amountCents * 12)) * 100);
      })
      .filter((percent): percent is number => percent !== null && percent > 0);
    return percents.length > 0 ? Math.max(...percents) : null;
  })();

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-4 py-12">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          {localize('com_ui_billing_choose_plan')}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {localize('com_ui_billing_choose_plan_subtitle')}
        </p>
      </div>
      <PlanIntervalSwitcher
        interval={interval}
        onChange={setInterval}
        annualSavingsPercent={annualSavingsPercent}
      />
      <div className="grid w-full gap-4 sm:grid-cols-2">
        {visiblePlans.map((plan) => (
          <div
            key={plan.code}
            className="rounded-xl border border-border-light p-6 text-center transition-shadow hover:shadow-md"
          >
            <div className="text-lg font-semibold text-text-primary">{plan.name}</div>
            <div className="mt-2 text-2xl font-bold text-text-primary">
              {(plan.amountCents / 100).toFixed(2)} {plan.amountCurrency}
            </div>
            {plan.tokenCredits !== undefined ? (
              <div className="mt-1 text-sm text-text-secondary">
                {plan.tokenCredits.toLocaleString()} {localize('com_ui_billing_credits_per_period')}
              </div>
            ) : null}
            {plan.features && plan.features.length > 0 ? (
              <ul className="mt-4 space-y-1.5 text-left text-sm text-text-secondary">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 text-green-600">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              variant="submit"
              size="sm"
              className="mt-5 w-full"
              disabled={isSubscribing}
              onClick={() => handleSubscribe(plan.code)}
            >
              {localize('com_ui_billing_subscribe')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
