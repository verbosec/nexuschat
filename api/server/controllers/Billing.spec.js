jest.mock('@librechat/api', () => ({
  getBillingConfig: jest.fn(),
  createLagoClient: jest.fn(),
  createProvisioning: jest.fn(),
  createTopupCheckout: jest.fn(),
  getCuratedPlans: jest.fn(),
  getCuratedAddOns: jest.fn(),
  computeNextRenewalDate: jest.fn(),
}));
jest.mock('~/models', () => ({
  findUser: jest.fn(),
}));

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Billing controller', () => {
  // Billing.js constructs its lagoClient/provisioning/topupCheckout once at
  // module-load time. Reset modules between tests and re-require
  // @librechat/api's mocks fresh each time, so the mock instances this file
  // configures are the exact same instances Billing.js will see when it's
  // required again in the same reset cycle.
  let getBillingConfig;
  let createLagoClient;
  let createProvisioning;
  let createTopupCheckout;
  let getCuratedPlans;
  let getCuratedAddOns;
  let computeNextRenewalDate;

  function configureBilling() {
    getBillingConfig.mockReturnValue({
      apiUrl: 'http://lago.test',
      apiKey: 'key',
      webhookSecret: 'secret',
    });
    createLagoClient.mockReturnValue({
      listPlans: jest.fn().mockResolvedValue([{ code: 'premium', name: 'Premium' }]),
      listAddOns: jest.fn().mockResolvedValue([]),
      getActiveSubscription: jest.fn(),
      terminateSubscription: jest.fn(),
      listInvoices: jest.fn().mockResolvedValue([]),
      createCheckoutSession: jest
        .fn()
        .mockResolvedValue({ url: 'https://stripe.example/checkout/xyz' }),
      createAddOnCheckoutSession: jest.fn(),
    });
    createProvisioning.mockReturnValue({
      ensureLagoCustomer: jest.fn().mockResolvedValue('zitadel-sub-1'),
    });
    createTopupCheckout.mockReturnValue({
      createTopupCheckoutSession: jest
        .fn()
        .mockResolvedValue({ url: 'https://stripe.example/checkout/topup' }),
    });
    getCuratedPlans.mockReturnValue([]);
    getCuratedAddOns.mockReturnValue([]);
  }

  beforeEach(() => {
    jest.resetModules();
    ({
      getBillingConfig,
      createLagoClient,
      createProvisioning,
      createTopupCheckout,
      getCuratedPlans,
      getCuratedAddOns,
      computeNextRenewalDate,
    } = require('@librechat/api'));
    computeNextRenewalDate.mockReturnValue(new Date('2026-08-11T00:00:00Z'));
  });

  it('getPlans returns only curated plans, enriched with tier/interval/tokenCredits', async () => {
    configureBilling();
    getCuratedPlans.mockReturnValue([
      { code: 'premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
    ]);
    const { getPlans } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getPlans(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        code: 'premium',
        name: 'Premium',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
      },
    ]);
  });

  it('getPlans passes through per-plan feature bullets when provided in the curated config', async () => {
    configureBilling();
    getCuratedPlans.mockReturnValue([
      {
        code: 'premium',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
        features: ['Everything in Free', 'Higher usage limits'],
      },
    ]);
    const { getPlans } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getPlans(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        code: 'premium',
        name: 'Premium',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
        features: ['Everything in Free', 'Higher usage limits'],
      },
    ]);
  });

  it('getPlans filters to curated plans, enriches with tier/interval/tokenCredits, and preserves curated order', async () => {
    configureBilling();
    createLagoClient.mockReturnValue({
      listPlans: jest.fn().mockResolvedValue([
        { code: 'nexus_ultimate', name: 'Nexus Ultimate', amountCents: 10000, amountCurrency: 'USD' },
        { code: 'some_internal_test_plan', name: 'Internal', amountCents: 100, amountCurrency: 'USD' },
        { code: 'nexus_premium', name: 'Nexus Premium', amountCents: 2000, amountCurrency: 'USD' },
      ]),
      listAddOns: jest.fn().mockResolvedValue([]),
      getActiveSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    getCuratedPlans.mockReturnValue([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
      { code: 'nexus_ultimate', tier: 'ultimate', interval: 'monthly', tokenCredits: 30000 },
    ]);
    const { getPlans } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getPlans(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        code: 'nexus_premium',
        name: 'Nexus Premium',
        amountCents: 2000,
        amountCurrency: 'USD',
        tier: 'premium',
        interval: 'monthly',
        tokenCredits: 5000,
      },
      {
        code: 'nexus_ultimate',
        name: 'Nexus Ultimate',
        amountCents: 10000,
        amountCurrency: 'USD',
        tier: 'ultimate',
        interval: 'monthly',
        tokenCredits: 30000,
      },
    ]);
  });

  it('getTopups returns only curated add-ons, enriched with tokenCredits', async () => {
    configureBilling();
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest
        .fn()
        .mockResolvedValue([
          { code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' },
          { code: 'internal_addon', name: 'Internal', amountCents: 100, amountCurrency: 'USD' },
        ]),
      getActiveSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    getCuratedAddOns.mockReturnValue([{ code: 'growth', tokenCredits: 2500 }]);
    const { getTopups } = require('./Billing');
    const req = {};
    const res = buildRes();

    await getTopups(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        code: 'growth',
        name: 'Growth',
        amountCents: 2000,
        amountCurrency: 'USD',
        tokenCredits: 2500,
      },
    ]);
  });

  it('getSubscription returns the plan, interval, and computed renewal date for a subscribed user', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest.fn(),
      getActiveSubscription: jest.fn().mockResolvedValue({
        planCode: 'nexus_premium',
        externalId: 'sub-ext-1',
        startedAt: '2026-06-11T00:00:00Z',
      }),
      terminateSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    getCuratedPlans.mockReturnValue([
      { code: 'nexus_premium', tier: 'premium', interval: 'monthly', tokenCredits: 5000 },
    ]);
    const { getSubscription } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getSubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({
      plan: 'nexus_premium',
      interval: 'monthly',
      renewalDate: expect.any(String),
    });
  });

  it('getSubscription returns "free" when the user has no openidId', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({});
    const { getSubscription } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getSubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({ plan: 'free', interval: null, renewalDate: null });
  });

  it('getSubscription returns "free" when the user has an openidId but no active subscription', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({ openidId: 'zitadel-sub-2' });
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest.fn(),
      getActiveSubscription: jest.fn().mockResolvedValue(null),
      terminateSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    const { getSubscription } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getSubscription(req, res);

    expect(res.json).toHaveBeenCalledWith({ plan: 'free', interval: null, renewalDate: null });
  });

  it('deleteSubscription terminates the active subscription and returns success', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
    const terminateSubscription = jest.fn().mockResolvedValue(undefined);
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest.fn(),
      getActiveSubscription: jest.fn().mockResolvedValue({
        planCode: 'nexus_premium',
        externalId: 'sub-ext-1',
        startedAt: '2026-06-11T00:00:00Z',
      }),
      terminateSubscription,
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    const { deleteSubscription } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await deleteSubscription(req, res);

    expect(terminateSubscription).toHaveBeenCalledWith('sub-ext-1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('deleteSubscription returns 404 when there is no active subscription to cancel', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest.fn(),
      getActiveSubscription: jest.fn().mockResolvedValue(null),
      terminateSubscription: jest.fn(),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    const { deleteSubscription } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await deleteSubscription(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('getInvoices returns the mapped invoice list for the current user', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({ openidId: 'zitadel-sub-1' });
    createLagoClient.mockReturnValue({
      listPlans: jest.fn(),
      listAddOns: jest.fn(),
      getActiveSubscription: jest.fn(),
      terminateSubscription: jest.fn(),
      listInvoices: jest.fn().mockResolvedValue([
        {
          id: 'inv-1',
          issuingDate: '2026-07-11',
          totalCents: 2000,
          currency: 'USD',
          status: 'finalized',
          paymentStatus: 'succeeded',
          fileUrl: 'https://billing.example/invoices/inv-1.pdf',
        },
      ]),
      createCheckoutSession: jest.fn(),
      createAddOnCheckoutSession: jest.fn(),
    });
    const { getInvoices } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getInvoices(req, res);

    expect(res.json).toHaveBeenCalledWith([
      {
        id: 'inv-1',
        issuingDate: '2026-07-11',
        totalCents: 2000,
        currency: 'USD',
        status: 'finalized',
        paymentStatus: 'succeeded',
        fileUrl: 'https://billing.example/invoices/inv-1.pdf',
      },
    ]);
  });

  it('getInvoices returns an empty list for a free-tier user with no Lago customer', async () => {
    configureBilling();
    const { findUser } = require('~/models');
    findUser.mockResolvedValue({});
    const { getInvoices } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getInvoices(req, res);

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('returns 503 when billing is not configured', async () => {
    getBillingConfig.mockReturnValue(null);
    const { getPlans } = require('./Billing');
    const req = { user: { id: 'user-1' } };
    const res = buildRes();

    await getPlans(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('postCheckout ensures a customer, creates a subscription, returns the checkout URL', async () => {
    configureBilling();
    const { postCheckout } = require('./Billing');
    const req = { user: { id: 'user-1' }, body: { planCode: 'premium' } };
    const res = buildRes();

    await postCheckout(req, res);

    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe.example/checkout/xyz' });
  });

  it('postCheckout returns 400 when planCode is missing', async () => {
    configureBilling();
    const { postCheckout } = require('./Billing');
    const req = { user: { id: 'user-1' }, body: {} };
    const res = buildRes();

    await postCheckout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('postTopupCheckout ensures a customer, requests an add-on checkout, returns the URL', async () => {
    configureBilling();
    const { postTopupCheckout } = require('./Billing');
    const req = { user: { id: 'user-1' }, body: { addOnCode: 'growth' } };
    const res = buildRes();

    await postTopupCheckout(req, res);

    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe.example/checkout/topup' });
  });
});
