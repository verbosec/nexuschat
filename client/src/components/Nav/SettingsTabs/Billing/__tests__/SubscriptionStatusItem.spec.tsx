import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import SubscriptionStatusItem from '../SubscriptionStatusItem';

describe('SubscriptionStatusItem', () => {
  it('shows a loading spinner', () => {
    const { getByTestId } = render(
      <SubscriptionStatusItem
        subscription={undefined}
        isLoading
        isError={false}
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(getByTestId('billing-subscription-loading')).toBeInTheDocument();
  });

  it('shows an error message', () => {
    const { getByText } = render(
      <SubscriptionStatusItem
        subscription={undefined}
        isLoading={false}
        isError
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(getByText('Unable to load your plan.')).toBeInTheDocument();
  });

  it('shows "Free" for the free plan', () => {
    const { getByText } = render(
      <SubscriptionStatusItem
        subscription={{ plan: 'free', interval: null, renewalDate: null }}
        isLoading={false}
        isError={false}
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(getByText('Free')).toBeInTheDocument();
  });

  it('shows the plan, interval, and renewal date for an active subscription', () => {
    const { getByText } = render(
      <SubscriptionStatusItem
        subscription={{
          plan: 'nexus_premium',
          interval: 'monthly',
          renewalDate: '2026-08-11T00:00:00.000Z',
        }}
        isLoading={false}
        isError={false}
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(getByText(/Active subscription/)).toBeInTheDocument();
    expect(getByText(/Monthly/)).toBeInTheDocument();
    expect(getByText(/renew/i)).toBeInTheDocument();
  });

  it('shows a Cancel plan button only for an active (non-free) subscription', () => {
    const { getByRole } = render(
      <SubscriptionStatusItem
        subscription={{ plan: 'nexus_premium', interval: 'monthly', renewalDate: null }}
        isLoading={false}
        isError={false}
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
  });

  it('does not show a Cancel plan button for the free plan', () => {
    const { queryByRole } = render(
      <SubscriptionStatusItem
        subscription={{ plan: 'free', interval: null, renewalDate: null }}
        isLoading={false}
        isError={false}
        onCancel={jest.fn()}
        isCancelling={false}
      />,
    );
    expect(queryByRole('button', { name: 'Cancel plan' })).not.toBeInTheDocument();
  });

  it('calls onCancel after the confirm dialog is accepted', async () => {
    const onCancel = jest.fn();
    const { getByRole, findByRole } = render(
      <SubscriptionStatusItem
        subscription={{ plan: 'nexus_premium', interval: 'monthly', renewalDate: null }}
        isLoading={false}
        isError={false}
        onCancel={onCancel}
        isCancelling={false}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Cancel plan' }));
    const confirmButton = await findByRole('button', { name: 'Confirm cancellation' });
    fireEvent.click(confirmButton);
    expect(onCancel).toHaveBeenCalled();
  });
});
