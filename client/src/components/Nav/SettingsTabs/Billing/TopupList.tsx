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
    return <div className="text-sm text-red-500">{localize('com_ui_billing_topups_error')}</div>;
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
          <Button variant="submit" size="sm" disabled={isBuying} onClick={() => onBuy(topup.code)}>
            {localize('com_ui_billing_buy')}
          </Button>
        </div>
      ))}
    </div>
  );
}
