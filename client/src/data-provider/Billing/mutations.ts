import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';

export const useBillingCheckoutMutation = (): UseMutationResult<
  t.TBillingCheckoutResponse,
  unknown,
  string,
  unknown
> => {
  return useMutation([MutationKeys.billingCheckout], {
    mutationFn: (planCode: string) => dataService.postBillingCheckout(planCode),
  });
};

export const useBillingTopupCheckoutMutation = (): UseMutationResult<
  t.TBillingCheckoutResponse,
  unknown,
  string,
  unknown
> => {
  return useMutation([MutationKeys.billingTopupCheckout], {
    mutationFn: (addOnCode: string) => dataService.postBillingTopupCheckout(addOnCode),
  });
};

export const useCancelSubscriptionMutation = (): UseMutationResult<
  { success: boolean },
  unknown,
  void,
  unknown
> => {
  const queryClient = useQueryClient();
  return useMutation([MutationKeys.billingCancelSubscription], {
    mutationFn: () => dataService.deleteBillingSubscription(),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.billingSubscription]);
    },
  });
};
