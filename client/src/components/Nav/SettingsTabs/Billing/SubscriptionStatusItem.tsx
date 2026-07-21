import { useState } from 'react';
import {
  Label,
  InfoHoverCard,
  ESide,
  Spinner,
  Button,
  OGDialog,
  OGDialogTrigger,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
} from '@librechat/client';
import type { TBillingSubscription } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type SubscriptionStatusItemProps = {
  subscription: TBillingSubscription | undefined;
  isLoading: boolean;
  isError: boolean;
  onCancel: () => void;
  isCancelling: boolean;
};

export default function SubscriptionStatusItem({
  subscription,
  isLoading,
  isError,
  onCancel,
  isCancelling,
}: SubscriptionStatusItemProps) {
  const localize = useLocalize();
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const plan = subscription?.plan;
  const isFree = !plan || plan === 'free';
  const label = isFree
    ? localize('com_ui_billing_plan_free')
    : localize('com_ui_billing_plan_active');
  const intervalLabel =
    subscription?.interval === 'monthly'
      ? localize('com_ui_billing_interval_monthly')
      : subscription?.interval === 'annual'
        ? localize('com_ui_billing_interval_annual')
        : null;
  const renewalText = subscription?.renewalDate
    ? localize('com_ui_billing_renews_on', {
        date: new Date(subscription.renewalDate).toLocaleDateString(),
      })
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Label className="font-light">{localize('com_ui_settings_label_subscription_status')}</Label>
          <InfoHoverCard side={ESide.Bottom} text={localize('com_ui_billing_subscription_info')} />
        </div>
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200" role="note">
          {label}
          {intervalLabel ? ` · ${intervalLabel}` : ''}
        </span>
      </div>
      {renewalText ? <div className="text-xs text-text-secondary">{renewalText}</div> : null}
      {!isFree && (
        <OGDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <OGDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="w-fit">
              {localize('com_ui_billing_cancel_plan')}
            </Button>
          </OGDialogTrigger>
          <OGDialogContent className="w-11/12 max-w-md">
            <OGDialogHeader>
              <OGDialogTitle>{localize('com_ui_billing_cancel_confirm_title')}</OGDialogTitle>
            </OGDialogHeader>
            <p className="text-sm text-text-secondary">
              {localize('com_ui_billing_cancel_confirm_body')}
            </p>
            <Button
              variant="destructive"
              disabled={isCancelling}
              onClick={() => {
                onCancel();
                setConfirmOpen(false);
              }}
            >
              {localize('com_ui_billing_cancel_confirm_button')}
            </Button>
          </OGDialogContent>
        </OGDialog>
      )}
    </div>
  );
}
