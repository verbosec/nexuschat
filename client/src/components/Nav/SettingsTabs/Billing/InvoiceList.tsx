import { Spinner } from '@librechat/client';
import type { TBillingInvoice } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

type InvoiceListProps = {
  invoices: TBillingInvoice[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

const PAYMENT_STATUS_LABEL_KEYS: Record<string, TranslationKeys> = {
  succeeded: 'com_ui_billing_invoice_status_paid',
  failed: 'com_ui_billing_invoice_status_failed',
  pending: 'com_ui_billing_invoice_status_pending',
};

export default function InvoiceList({ invoices, isLoading, isError }: InvoiceListProps) {
  const localize = useLocalize();

  if (isLoading) {
    return (
      <div
        data-testid="billing-invoices-loading"
        className="flex items-center justify-center rounded-xl border border-border-light py-12"
      >
        <Spinner className="h-6 w-6 text-text-secondary" />
      </div>
    );
  }

  if (isError) {
    return <div className="text-sm text-red-500">{localize('com_ui_billing_invoices_error')}</div>;
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="text-sm text-text-secondary">{localize('com_ui_billing_invoices_empty')}</div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-text-secondary">
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_date')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_total')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_status')}</th>
          <th className="pb-2 font-medium">{localize('com_ui_billing_invoice_actions')}</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr key={invoice.id} className="border-t border-border-light">
            <td className="py-2 text-text-primary">
              {new Date(invoice.issuingDate).toLocaleDateString()}
            </td>
            <td className="py-2 text-text-primary">
              {(invoice.totalCents / 100).toFixed(2)} {invoice.currency}
            </td>
            <td className="py-2 text-text-primary">
              {localize(
                PAYMENT_STATUS_LABEL_KEYS[invoice.paymentStatus] ??
                  'com_ui_billing_invoice_status_pending',
              )}
            </td>
            <td className="py-2">
              <a
                href={invoice.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {localize('com_ui_billing_invoice_view')}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
