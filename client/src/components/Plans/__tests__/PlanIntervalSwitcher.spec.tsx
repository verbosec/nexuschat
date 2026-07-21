import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import userEvent from '@testing-library/user-event';
import { render } from 'test/layout-test-utils';
import PlanIntervalSwitcher from '../PlanIntervalSwitcher';

describe('PlanIntervalSwitcher', () => {
  it('renders Monthly and Annual tabs', () => {
    const { getByRole } = render(<PlanIntervalSwitcher interval="monthly" onChange={jest.fn()} />);
    expect(getByRole('tab', { name: 'Monthly' })).toBeInTheDocument();
    expect(getByRole('tab', { name: 'Annual' })).toBeInTheDocument();
  });

  it('marks the active interval as selected', () => {
    const { getByRole } = render(<PlanIntervalSwitcher interval="annual" onChange={jest.fn()} />);
    expect(getByRole('tab', { name: 'Annual' })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: 'Monthly' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked interval', async () => {
    const onChange = jest.fn();
    const { getByRole } = render(<PlanIntervalSwitcher interval="monthly" onChange={onChange} />);
    await userEvent.click(getByRole('tab', { name: 'Annual' }));
    expect(onChange).toHaveBeenCalledWith('annual');
  });

  it('shows a savings badge on the Annual tab when annualSavingsPercent is provided', () => {
    const { getByText } = render(
      <PlanIntervalSwitcher interval="monthly" onChange={jest.fn()} annualSavingsPercent={20} />,
    );
    expect(getByText('-20%')).toBeInTheDocument();
  });

  it('shows no savings badge when annualSavingsPercent is omitted', () => {
    const { queryByText } = render(<PlanIntervalSwitcher interval="monthly" onChange={jest.fn()} />);
    expect(queryByText(/%/)).not.toBeInTheDocument();
  });
});
