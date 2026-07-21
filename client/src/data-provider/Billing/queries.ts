import { useRecoilValue } from 'recoil';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

export const useGetBillingPlansQuery = (
  config?: UseQueryOptions<t.TBillingPlan[]>,
): QueryObserverResult<t.TBillingPlan[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingPlan[]>([QueryKeys.billingPlans], () => dataService.getBillingPlans(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

export const useGetBillingTopupsQuery = (
  config?: UseQueryOptions<t.TBillingTopup[]>,
): QueryObserverResult<t.TBillingTopup[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingTopup[]>(
    [QueryKeys.billingTopups],
    () => dataService.getBillingTopups(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetBillingSubscriptionQuery = (
  config?: UseQueryOptions<t.TBillingSubscription>,
): QueryObserverResult<t.TBillingSubscription> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingSubscription>(
    [QueryKeys.billingSubscription],
    () => dataService.getBillingSubscription(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useGetBillingInvoicesQuery = (
  config?: UseQueryOptions<t.TBillingInvoice[]>,
): QueryObserverResult<t.TBillingInvoice[]> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBillingInvoice[]>(
    [QueryKeys.billingInvoices],
    () => dataService.getBillingInvoices(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
