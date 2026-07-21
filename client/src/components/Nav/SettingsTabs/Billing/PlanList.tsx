import { Button, Spinner } from '@librechat/client';
import type { TBillingPlan } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type PlanListProps = {
  plans: TBillingPlan[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isSubscribing: boolean;
  onSubscribe: (planCode: string) => void;
  currentPlanCode?: string;
};

export default function PlanList({
  plans,
  isLoading,
  isError,
  isSubscribing,
  onSubscribe,
  currentPlanCode,
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
    return <div className="text-sm text-red-500">{localize('com_ui_billing_plans_error')}</div>;
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
          {plan.code === currentPlanCode ? (
            <span className="text-sm font-medium text-text-secondary">
              {localize('com_ui_billing_current_plan')}
            </span>
          ) : (
            <Button
              variant="submit"
              size="sm"
              disabled={isSubscribing}
              onClick={() => onSubscribe(plan.code)}
            >
              {localize('com_ui_billing_subscribe')}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
