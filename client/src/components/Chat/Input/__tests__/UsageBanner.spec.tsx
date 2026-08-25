import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent } from 'test/layout-test-utils';
import { useGetUserBalance, useGetStartupConfig } from '~/data-provider';
import UsageBanner from '../UsageBanner';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetUserBalance: jest.fn(),
  useGetStartupConfig: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockBalanceQuery = useGetUserBalance as jest.Mock;
const mockStartupConfigQuery = useGetStartupConfig as jest.Mock;

describe('UsageBanner', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    sessionStorage.clear();
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: true } } });
  });

  it('renders nothing when balance tracking is disabled site-wide', () => {
    mockStartupConfigQuery.mockReturnValue({ data: { balance: { enabled: false } } });
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user has no refillAmount configured', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: undefined } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing below 60% used', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 500, refillAmount: 1000 } }); // 50% used
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an amber banner between 60% and 79% used, with no reset date when autoRefillEnabled is false', () => {
    mockBalanceQuery.mockReturnValue({
      data: { tokenCredits: 350, refillAmount: 1000, autoRefillEnabled: false }, // 65% used
    });
    const { getByTestId, getByText } = render(<UsageBanner />);
    expect(getByTestId('usage-banner')).toHaveClass('border-amber-300');
    expect(getByText('65% of your credits used')).toBeInTheDocument();
  });

  it('shows a red banner at 80% used or more, with a reset date when autoRefillEnabled is true', () => {
    mockBalanceQuery.mockReturnValue({
      data: {
        tokenCredits: 100,
        refillAmount: 1000, // 90% used
        autoRefillEnabled: true,
        refillIntervalValue: 1,
        refillIntervalUnit: 'months',
        lastRefill: '2026-08-01T00:00:00.000Z',
      },
    });
    const { getByTestId, getByText } = render(<UsageBanner />);
    expect(getByTestId('usage-banner')).toHaveClass('border-red-300');
    const expectedDate = new Date('2026-09-01T00:00:00.000Z').toLocaleDateString();
    expect(getByText(`90% of your credits used — resets ${expectedDate}`)).toBeInTheDocument();
  });

  it('navigates to /plans when clicked', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { getByTestId } = render(<UsageBanner />);
    fireEvent.click(getByTestId('usage-banner'));
    expect(mockNavigate).toHaveBeenCalledWith('/plans');
  });

  it('hides after dismiss and does not call navigate when the dismiss button is clicked', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { getByTestId, container } = render(<UsageBanner />);
    fireEvent.click(getByTestId('usage-banner-dismiss'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
    expect(sessionStorage.getItem('usageBannerDismissed')).toBe('true');
  });

  it('stays hidden on a fresh mount if sessionStorage already has the dismiss flag', () => {
    sessionStorage.setItem('usageBannerDismissed', 'true');
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { container } = render(<UsageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not navigate when Enter is pressed on the dismiss button', () => {
    mockBalanceQuery.mockReturnValue({ data: { tokenCredits: 100, refillAmount: 1000 } });
    const { getByTestId } = render(<UsageBanner />);
    fireEvent.keyDown(getByTestId('usage-banner-dismiss'), { key: 'Enter' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
