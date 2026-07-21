import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import { useParams } from 'react-router-dom';
import useAuthRedirect from '../useAuthRedirect';
import Plans from '../Plans';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: jest.fn(),
}));
jest.mock('../useAuthRedirect');
jest.mock('~/components/Plans/PlansView', () => ({
  __esModule: true,
  default: ({ planCode }: { planCode?: string }) => <div>PlansView:{planCode ?? 'all'}</div>,
}));

const mockUseParams = useParams as jest.Mock;
const mockUseAuthRedirect = useAuthRedirect as jest.Mock;

describe('Plans route', () => {
  it('renders nothing while unauthenticated (redirect in flight)', () => {
    mockUseParams.mockReturnValue({});
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: false });
    const { container } = render(<Plans />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders PlansView with no planCode for the bare /plans route once authenticated', () => {
    mockUseParams.mockReturnValue({});
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: true });
    const { getByText } = render(<Plans />);
    expect(getByText('PlansView:all')).toBeInTheDocument();
  });

  it('passes planCode through for /plans/:planCode once authenticated', () => {
    mockUseParams.mockReturnValue({ planCode: 'nexus_ultimate' });
    mockUseAuthRedirect.mockReturnValue({ isAuthenticated: true });
    const { getByText } = render(<Plans />);
    expect(getByText('PlansView:nexus_ultimate')).toBeInTheDocument();
  });
});
