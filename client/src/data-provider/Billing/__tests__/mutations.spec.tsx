import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import {
  useBillingCheckoutMutation,
  useBillingTopupCheckoutMutation,
  useCancelSubscriptionMutation,
} from '../mutations';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    postBillingCheckout: jest.fn(),
    postBillingTopupCheckout: jest.fn(),
    deleteBillingSubscription: jest.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('Billing mutations', () => {
  it('useBillingCheckoutMutation calls postBillingCheckout with the plan code', async () => {
    (dataService.postBillingCheckout as jest.Mock).mockResolvedValue({
      url: 'https://stripe.example/checkout/abc',
    });
    const { result } = renderHook(() => useBillingCheckoutMutation(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync('nexus_premium');
    });

    expect(dataService.postBillingCheckout).toHaveBeenCalledWith('nexus_premium');
    expect(response).toEqual({ url: 'https://stripe.example/checkout/abc' });
  });

  it('useBillingTopupCheckoutMutation calls postBillingTopupCheckout with the add-on code', async () => {
    (dataService.postBillingTopupCheckout as jest.Mock).mockResolvedValue({
      url: 'https://stripe.example/checkout/topup',
    });
    const { result } = renderHook(() => useBillingTopupCheckoutMutation(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync('growth');
    });

    expect(dataService.postBillingTopupCheckout).toHaveBeenCalledWith('growth');
    expect(response).toEqual({ url: 'https://stripe.example/checkout/topup' });
  });

  it('useCancelSubscriptionMutation calls deleteBillingSubscription', async () => {
    (dataService.deleteBillingSubscription as jest.Mock).mockResolvedValue({ success: true });
    const { result } = renderHook(() => useCancelSubscriptionMutation(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync();
    });

    expect(dataService.deleteBillingSubscription).toHaveBeenCalled();
    expect(response).toEqual({ success: true });
  });
});
