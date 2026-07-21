import {
  billingPlans,
  billingTopups,
  billingSubscription,
  billingInvoices,
  billingCheckout,
  billingTopupCheckout,
} from './api-endpoints';

describe('billing endpoints', () => {
  it('builds the correct URLs', () => {
    expect(billingPlans()).toMatch(/\/api\/billing\/plans$/);
    expect(billingTopups()).toMatch(/\/api\/billing\/topups$/);
    expect(billingSubscription()).toMatch(/\/api\/billing\/subscription$/);
    expect(billingInvoices()).toMatch(/\/api\/billing\/invoices$/);
    expect(billingCheckout()).toMatch(/\/api\/billing\/checkout$/);
    expect(billingTopupCheckout()).toMatch(/\/api\/billing\/topups\/checkout$/);
  });
});
