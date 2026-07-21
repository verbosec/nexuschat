import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import userEvent from '@testing-library/user-event';
import { render, fireEvent, waitFor } from 'test/layout-test-utils';
import { useGetBillingPlansQuery, useBillingCheckoutMutation } from '~/data-provider';
import PlansView from '../PlansView';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetBillingPlansQuery: jest.fn(),
  useBillingCheckoutMutation: jest.fn(),
}));

const mockPlansQuery = useGetBillingPlansQuery as jest.Mock;
const mockCheckoutMutation = useBillingCheckoutMutation as jest.Mock;

const PLANS = [
  {
    code: 'nexus_premium',
    name: 'Nexus Premium',
    amountCents: 2000,
    amountCurrency: 'USD',
    tier: 'premium',
    interval: 'monthly',
    tokenCredits: 5000,
    features: ['Higher usage limits', 'Priority support'],
  },
  {
    code: 'nexus_premium_annual',
    name: 'Nexus Premium (Annual)',
    amountCents: 20000,
    amountCurrency: 'USD',
    tier: 'premium',
    interval: 'annual',
    tokenCredits: 5000,
  },
  {
    code: 'nexus_ultimate',
    name: 'Nexus Ultimate',
    amountCents: 10000,
    amountCurrency: 'USD',
    tier: 'ultimate',
    interval: 'monthly',
    tokenCredits: 30000,
  },
  {
    code: 'nexus_ultimate_annual',
    name: 'Nexus Ultimate (Annual)',
    amountCents: 100000,
    amountCurrency: 'USD',
    tier: 'ultimate',
    interval: 'annual',
    tokenCredits: 30000,
  },
];

describe('PlansView', () => {
  beforeEach(() => {
    mockPlansQuery.mockReturnValue({ data: PLANS, isLoading: false, isError: false });
    mockCheckoutMutation.mockReturnValue({ mutateAsync: jest.fn(), isLoading: false });
  });

  it('shows only monthly plans by default', () => {
    const { getByText, queryByText } = render(<PlansView />);
    expect(getByText('Nexus Premium')).toBeInTheDocument();
    expect(getByText('Nexus Ultimate')).toBeInTheDocument();
    expect(queryByText('Nexus Premium (Annual)')).not.toBeInTheDocument();
  });

  it('switches to annual plans when the Annual tab is clicked', async () => {
    const { getByRole, getByText, queryByText } = render(<PlansView />);
    await userEvent.click(getByRole('tab', { name: /Annual/ }));
    expect(getByText('Nexus Premium (Annual)')).toBeInTheDocument();
    expect(queryByText('Nexus Premium')).not.toBeInTheDocument();
  });

  it('auto-triggers checkout for the exact plan when a direct plan link is visited', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ url: 'https://stripe.example/checkout/abc' });
    mockCheckoutMutation.mockReturnValue({ mutateAsync, isLoading: false, isError: false });
    render(<PlansView planCode="nexus_ultimate" />);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('nexus_ultimate'));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows a redirecting message while the checkout session is created, with no plan-picker UI', () => {
    const mutateAsync = jest.fn().mockReturnValue(new Promise(() => {}));
    mockCheckoutMutation.mockReturnValue({ mutateAsync, isLoading: true, isError: false });
    const { getByText, queryByRole } = render(<PlansView planCode="nexus_ultimate" />);
    expect(getByText('Redirecting you to checkout…')).toBeInTheDocument();
    expect(queryByRole('tab', { name: /Annual/ })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
  });

  it('shows an error with a retry option when checkout fails to start', async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new Error('network error'));
    mockCheckoutMutation.mockReturnValue({ mutateAsync, isLoading: false, isError: true });
    const { getByText, getByRole } = render(<PlansView planCode="nexus_ultimate" />);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(getByText('Something went wrong starting checkout.')).toBeInTheDocument();
    const retryButton = getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
  });

  it('shows a not-found message and a link back to browse plans for an unknown plan code', () => {
    mockCheckoutMutation.mockReturnValue({ mutateAsync: jest.fn(), isLoading: false, isError: false });
    const { getByText, getByRole } = render(<PlansView planCode="does_not_exist" />);
    expect(getByText("We couldn't find that plan.")).toBeInTheDocument();
    expect(getByRole('link', { name: 'Browse all plans' })).toHaveAttribute('href', '/plans');
  });

  it("renders each plan's feature bullets when provided", () => {
    const { getByText } = render(<PlansView />);
    expect(getByText('Higher usage limits')).toBeInTheDocument();
    expect(getByText('Priority support')).toBeInTheDocument();
  });

  it('shows a savings badge on the Annual tab when an annual plan costs less per year than 12x the monthly price', () => {
    const { getByText } = render(<PlansView />);
    expect(getByText('-17%')).toBeInTheDocument();
  });

  it('shows a page heading', () => {
    const { getByRole } = render(<PlansView />);
    expect(getByRole('heading', { name: 'Choose your plan' })).toBeInTheDocument();
  });
});
