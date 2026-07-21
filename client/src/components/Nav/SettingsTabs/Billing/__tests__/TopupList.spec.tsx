import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import TopupList from '../TopupList';

describe('TopupList', () => {
  it('shows a loading spinner while top-ups are fetching', () => {
    const { getByTestId } = render(
      <TopupList topups={undefined} isLoading isError={false} onBuy={jest.fn()} isBuying={false} />,
    );
    expect(getByTestId('billing-topups-loading')).toBeInTheDocument();
  });

  it('shows an error message when the top-ups query fails', () => {
    const { getByText } = render(
      <TopupList topups={undefined} isLoading={false} isError onBuy={jest.fn()} isBuying={false} />,
    );
    expect(getByText('Unable to load credit top-ups.')).toBeInTheDocument();
  });

  it('lists each top-up with a Buy button', () => {
    const { getByText, getByRole } = render(
      <TopupList
        topups={[{ code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' }]}
        isLoading={false}
        isError={false}
        onBuy={jest.fn()}
        isBuying={false}
      />,
    );
    expect(getByText('Growth')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Buy' })).toBeInTheDocument();
  });

  it('calls onBuy with the add-on code when Buy is clicked', () => {
    const onBuy = jest.fn();
    const { getByRole } = render(
      <TopupList
        topups={[{ code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' }]}
        isLoading={false}
        isError={false}
        onBuy={onBuy}
        isBuying={false}
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Buy' }));
    expect(onBuy).toHaveBeenCalledWith('growth');
  });
});
