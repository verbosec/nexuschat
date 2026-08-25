import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import { ViolationTypes } from 'librechat-data-provider';
import Error from '../Error';

/**
 * CodeBlock (rendered for `generations` output) constructs a real
 * IntersectionObserver on mount; jsdom doesn't implement one, so it must be
 * stubbed here the same way MessageNav.spec.tsx and useMessageScrolling.spec.tsx do.
 */
class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  takeRecords = jest.fn(() => []);
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: number[] = [];
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
}

const originalIntersectionObserver = global.IntersectionObserver;

beforeAll(() => {
  (
    global as unknown as { IntersectionObserver: typeof IntersectionObserver }
  ).IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterAll(() => {
  (
    global as unknown as { IntersectionObserver: typeof IntersectionObserver | undefined }
  ).IntersectionObserver = originalIntersectionObserver;
});

describe('Error', () => {
  it('shows the insufficient-funds message and an Upgrade link for a token_balance violation', () => {
    const json = {
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 0,
      tokenCost: 120,
      promptTokens: 100,
    };
    const { getByText, getByRole } = render(<Error text={JSON.stringify(json)} />);

    expect(
      getByText('Insufficient Funds! Balance: 0. Prompt tokens: 100. Cost: 120.'),
    ).toBeInTheDocument();

    const link = getByRole('link', { name: 'Upgrade your plan' });
    expect(link).toHaveAttribute('href', '/plans');
  });

  it('still renders generations output for a token_balance violation that includes them', () => {
    const json = {
      type: ViolationTypes.TOKEN_BALANCE,
      balance: 0,
      tokenCost: 120,
      promptTokens: 100,
      generations: [{ text: 'partial output' }],
    };
    const { getByText } = render(<Error text={JSON.stringify(json)} />);
    expect(getByText(/partial output/)).toBeInTheDocument();
  });

  it('falls back to the default message for a non-JSON error string', () => {
    const { getByText } = render(<Error text="plain text failure" />);
    expect(
      getByText(
        "Something went wrong. Here's the specific error message we encountered: plain text failure",
      ),
    ).toBeInTheDocument();
  });
});
