jest.mock('./request', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

import request from './request';
import {
  getBillingPlans,
  getBillingTopups,
  getBillingSubscription,
  getBillingInvoices,
  postBillingCheckout,
  postBillingTopupCheckout,
  deleteBillingSubscription,
} from './data-service';

describe('billing data-service functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getBillingPlans calls GET /api/billing/plans', async () => {
    (request.get as jest.Mock).mockResolvedValue([{ code: 'nexus_premium' }]);
    const result = await getBillingPlans();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/plans'));
    expect(result).toEqual([{ code: 'nexus_premium' }]);
  });

  it('getBillingTopups calls GET /api/billing/topups', async () => {
    (request.get as jest.Mock).mockResolvedValue([{ code: 'growth' }]);
    const result = await getBillingTopups();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/topups'));
    expect(result).toEqual([{ code: 'growth' }]);
  });

  it('getBillingSubscription calls GET /api/billing/subscription', async () => {
    (request.get as jest.Mock).mockResolvedValue({ plan: 'free' });
    const result = await getBillingSubscription();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/subscription'));
    expect(result).toEqual({ plan: 'free' });
  });

  it('postBillingCheckout calls POST /api/billing/checkout with the plan code', async () => {
    (request.post as jest.Mock).mockResolvedValue({ url: 'https://stripe.example/checkout/abc' });
    const result = await postBillingCheckout('nexus_premium');
    expect(request.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/checkout'),
      { planCode: 'nexus_premium' },
    );
    expect(result).toEqual({ url: 'https://stripe.example/checkout/abc' });
  });

  it('postBillingTopupCheckout calls POST /api/billing/topups/checkout with the add-on code', async () => {
    (request.post as jest.Mock).mockResolvedValue({ url: 'https://stripe.example/checkout/topup' });
    const result = await postBillingTopupCheckout('growth');
    expect(request.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/billing/topups/checkout'),
      { addOnCode: 'growth' },
    );
    expect(result).toEqual({ url: 'https://stripe.example/checkout/topup' });
  });

  it('getBillingInvoices calls GET /api/billing/invoices', async () => {
    (request.get as jest.Mock).mockResolvedValue([{ id: 'inv-1' }]);
    const result = await getBillingInvoices();
    expect(request.get).toHaveBeenCalledWith(expect.stringContaining('/api/billing/invoices'));
    expect(result).toEqual([{ id: 'inv-1' }]);
  });

  it('deleteBillingSubscription calls DELETE /api/billing/subscription', async () => {
    (request.delete as jest.Mock).mockResolvedValue({ success: true });
    const result = await deleteBillingSubscription();
    expect(request.delete).toHaveBeenCalledWith(expect.stringContaining('/api/billing/subscription'));
    expect(result).toEqual({ success: true });
  });
});
