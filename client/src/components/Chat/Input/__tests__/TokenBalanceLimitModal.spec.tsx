import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, fireEvent, act } from 'test/layout-test-utils';
import { useGetUserBalance } from '~/data-provider';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import TokenBalanceLimitModal from '../TokenBalanceLimitModal';

jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetUserBalance: jest.fn(),
  useGetStartupConfig: jest.fn(() => ({ data: { balance: { enabled: true } } })),
}));

jest.mock('~/hooks/Messages/useLatestMessage', () => ({
  useLatestMessage: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockBalanceQuery = useGetUserBalance as jest.Mock;
const mockLatestMessage = useLatestMessage as jest.Mock;

const tokenBalanceErrorText = JSON.stringify({ type: 'token_balance', balance: 0 });

describe('TokenBalanceLimitModal', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockBalanceQuery.mockReturnValue({ data: { autoRefillEnabled: false } });
  });

  it('does not open for a token_balance error that is already the latest message at mount', () => {
    mockLatestMessage.mockReturnValue({
      messageId: 'msg-1',
      error: true,
      text: tokenBalanceErrorText,
    });
    const { queryByText } = render(<TokenBalanceLimitModal index={0} />);
    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('opens when a fresh token_balance error appears after mount', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Out of credits')).toBeInTheDocument();
  });

  it('does not open for a different error type', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, queryByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: JSON.stringify({ type: 'message_limit', max: 5, windowInMinutes: 1 }),
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('renders the checklist and navigates to /plans on the primary CTA', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Continue this conversation right away')).toBeInTheDocument();
    expect(getByText('Higher monthly credit allowance')).toBeInTheDocument();
    expect(getByText('Buy a one-time top-up instead, if you prefer')).toBeInTheDocument();
    expect(getByText('Cancel or change plans anytime in Settings')).toBeInTheDocument();

    fireEvent.click(getByText('View plans'));
    expect(mockNavigate).toHaveBeenCalledWith('/plans');
  });

  it('shows "Maybe later" and closes without navigating when autoRefillEnabled is false', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText, queryByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    fireEvent.click(getByText('Maybe later'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(queryByText('Out of credits')).not.toBeInTheDocument();
  });

  it('shows "Wait until [date]" when autoRefillEnabled is true with a computable date', () => {
    mockBalanceQuery.mockReturnValue({
      data: {
        autoRefillEnabled: true,
        refillIntervalValue: 1,
        refillIntervalUnit: 'months',
        lastRefill: '2026-08-01T00:00:00.000Z',
      },
    });
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: 'hello' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-2',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    const expectedDate = new Date('2026-09-01T00:00:00.000Z').toLocaleDateString();
    expect(getByText(`Wait until ${expectedDate}`)).toBeInTheDocument();
  });

  it('opens for a fresh token_balance error when latestMessage was null at mount', () => {
    mockLatestMessage.mockReturnValue(null);
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-1',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Out of credits')).toBeInTheDocument();
  });

  it('opens when the SAME placeholder messageId flips from non-error to a token_balance error', () => {
    mockLatestMessage.mockReturnValue({ messageId: 'msg-1', error: false, text: '' });
    const { rerender, getByText } = render(<TokenBalanceLimitModal index={0} />);

    mockLatestMessage.mockReturnValue({
      messageId: 'msg-1',
      error: true,
      text: tokenBalanceErrorText,
    });
    act(() => {
      rerender(<TokenBalanceLimitModal index={0} />);
    });

    expect(getByText('Out of credits')).toBeInTheDocument();
  });
});
