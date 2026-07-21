import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import PlanList from '../PlanList';

describe('PlanList', () => {
  it('shows a loading spinner while plans are fetching', () => {
    const { getByTestId } = render(
      <PlanList
        plans={undefined}
        isLoading
        isError={false}
        onSubscribe={jest.fn()}
        isSubscribing={false}
      />,
    );
    expect(getByTestId('billing-plans-loading')).toBeInTheDocument();
  });

  it('shows an error message when the plans query fails', () => {
    const { getByText } = render(
      <PlanList
        plans={undefined}
        isLoading={false}
        isError
        onSubscribe={jest.fn()}
        isSubscribing={false}
      />,
    );
    expect(getByText('Unable to load plans.')).toBeInTheDocument();
  });

  it('lists each plan with a Subscribe button', () => {
    const { getByText, getAllByRole } = render(
      <PlanList
        plans={[
          { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
          { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD' },
        ]}
        isLoading={false}
        isError={false}
        onSubscribe={jest.fn()}
        isSubscribing={false}
      />,
    );
    expect(getByText('Nexus Premium')).toBeInTheDocument();
    expect(getByText('Nexus Ultimate')).toBeInTheDocument();
    expect(getAllByRole('button', { name: 'Subscribe' })).toHaveLength(2);
  });

  it('calls onSubscribe with the plan code when Subscribe is clicked', () => {
    const onSubscribe = jest.fn();
    const { getByRole } = render(
      <PlanList
        plans={[
          { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
        ]}
        isLoading={false}
        isError={false}
        onSubscribe={onSubscribe}
        isSubscribing={false}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Subscribe' }));
    expect(onSubscribe).toHaveBeenCalledWith('nexus_premium');
  });

  it('marks the current plan instead of showing a Subscribe button for it', () => {
    const { getByText, getAllByRole } = render(
      <PlanList
        plans={[
          { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
          { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD' },
        ]}
        isLoading={false}
        isError={false}
        onSubscribe={jest.fn()}
        isSubscribing={false}
        currentPlanCode="nexus_premium"
      />,
    );
    expect(getByText('Current Plan')).toBeInTheDocument();
    expect(getAllByRole('button', { name: 'Subscribe' })).toHaveLength(1);
  });
});
