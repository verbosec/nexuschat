import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render } from 'test/layout-test-utils';
import InvoiceList from '../InvoiceList';

const INVOICES = [
  {
    id: 'inv-1',
    issuingDate: '2026-07-11',
    totalCents: 2000,
    currency: 'USD',
    status: 'finalized',
    paymentStatus: 'succeeded',
    fileUrl: 'https://billing.example/invoices/inv-1.pdf',
  },
  {
    id: 'inv-2',
    issuingDate: '2026-06-09',
    totalCents: 2000,
    currency: 'USD',
    status: 'finalized',
    paymentStatus: 'failed',
    fileUrl: 'https://billing.example/invoices/inv-2.pdf',
  },
];

describe('InvoiceList', () => {
  it('shows a loading spinner while invoices are fetching', () => {
    const { getByTestId } = render(<InvoiceList invoices={undefined} isLoading isError={false} />);
    expect(getByTestId('billing-invoices-loading')).toBeInTheDocument();
  });

  it('shows an error message when the invoices query fails', () => {
    const { getByText } = render(<InvoiceList invoices={undefined} isLoading={false} isError />);
    expect(getByText('Unable to load invoices.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no invoices yet', () => {
    const { getByText } = render(<InvoiceList invoices={[]} isLoading={false} isError={false} />);
    expect(getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('renders a row per invoice with date, total, status, and a View link', () => {
    const { getAllByText, getByText, getAllByRole } = render(
      <InvoiceList invoices={INVOICES} isLoading={false} isError={false} />,
    );
    expect(getAllByText('20.00 USD')).toHaveLength(2);
    expect(getByText('Paid')).toBeInTheDocument();
    expect(getByText('Failed')).toBeInTheDocument();
    const viewLinks = getAllByRole('link', { name: 'View' });
    expect(viewLinks).toHaveLength(2);
    expect(viewLinks[0]).toHaveAttribute('href', 'https://billing.example/invoices/inv-1.pdf');
    expect(viewLinks[0]).toHaveAttribute('target', '_blank');
  });
});
