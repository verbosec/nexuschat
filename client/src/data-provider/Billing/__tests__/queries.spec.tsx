import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService } from 'librechat-data-provider';
import {
  useGetBillingPlansQuery,
  useGetBillingTopupsQuery,
  useGetBillingSubscriptionQuery,
  useGetBillingInvoicesQuery,
} from '../queries';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    getBillingPlans: jest.fn(),
    getBillingTopups: jest.fn(),
    getBillingSubscription: jest.fn(),
    getBillingInvoices: jest.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RecoilRoot>
  );
}

describe('Billing queries', () => {
  it('useGetBillingPlansQuery fetches plans', async () => {
    (dataService.getBillingPlans as jest.Mock).mockResolvedValue([
      { code: 'nexus_premium', name: 'Premium', amountCents: 2000, amountCurrency: 'USD' },
    ]);
    const { result } = renderHook(() => useGetBillingPlansQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('useGetBillingTopupsQuery fetches top-ups', async () => {
    (dataService.getBillingTopups as jest.Mock).mockResolvedValue([
      { code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' },
    ]);
    const { result } = renderHook(() => useGetBillingTopupsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('useGetBillingSubscriptionQuery fetches the current subscription', async () => {
    (dataService.getBillingSubscription as jest.Mock).mockResolvedValue({
      plan: 'free',
      interval: null,
      renewalDate: null,
    });
    const { result } = renderHook(() => useGetBillingSubscriptionQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ plan: 'free', interval: null, renewalDate: null });
  });

  it('useGetBillingInvoicesQuery fetches invoices', async () => {
    (dataService.getBillingInvoices as jest.Mock).mockResolvedValue([
      {
        id: 'inv-1',
        issuingDate: '2026-07-11',
        totalCents: 2000,
        currency: 'USD',
        status: 'finalized',
        paymentStatus: 'succeeded',
        fileUrl: 'https://billing.example/invoices/inv-1.pdf',
      },
    ]);
    const { result } = renderHook(() => useGetBillingInvoicesQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});
