import nock from 'nock';
import { createLagoClient } from './lago-client';

const config = {
  apiUrl: 'http://lago.test',
  apiKey: 'test-key',
  webhookSecret: 'secret',
  stripeProviderCode: 'stripe_usa',
};

describe('createLagoClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('creates a customer, linking it to the configured Stripe provider code', async () => {
    nock('http://lago.test', { reqheaders: { authorization: 'Bearer test-key' } })
      .post('/api/v1/customers', {
        customer: {
          external_id: 'user-1',
          name: 'user-1',
          billing_configuration: {
            payment_provider: 'stripe',
            payment_provider_code: 'stripe_usa',
            sync_with_provider: true,
          },
        },
      })
      .reply(200, { customer: { external_id: 'user-1', lago_id: 'lago-cust-1' } });

    const client = createLagoClient(config);
    const customer = await client.createCustomer({ externalId: 'user-1', name: 'user-1' });

    expect(customer.lagoId).toBe('lago-cust-1');
    expect(customer.externalId).toBe('user-1');
  });

  it('creates a customer without billing_configuration when no Stripe provider code is configured', async () => {
    const configWithoutProviderCode = {
      apiUrl: 'http://lago.test',
      apiKey: 'test-key',
      webhookSecret: 'secret',
    };
    nock('http://lago.test')
      .post('/api/v1/customers', { customer: { external_id: 'user-2', name: 'user-2' } })
      .reply(200, { customer: { external_id: 'user-2', lago_id: 'lago-cust-2' } });

    const client = createLagoClient(configWithoutProviderCode);
    const customer = await client.createCustomer({ externalId: 'user-2', name: 'user-2' });

    expect(customer.lagoId).toBe('lago-cust-2');
  });

  it('gets a plan by code', async () => {
    nock('http://lago.test')
      .get('/api/v1/plans/premium')
      .reply(200, {
        plan: { code: 'premium', name: 'Premium', amount_cents: 2000, amount_currency: 'USD' },
      });

    const client = createLagoClient(config);
    const plan = await client.getPlan('premium');

    expect(plan.code).toBe('premium');
    expect(plan.amountCents).toBe(2000);
  });

  it('creates a subscription for a customer', async () => {
    nock('http://lago.test')
      .post('/api/v1/subscriptions', {
        subscription: { external_customer_id: 'user-1', plan_code: 'premium' },
      })
      .reply(200, {
        subscription: {
          lago_id: 'sub-1',
          external_customer_id: 'user-1',
          plan_code: 'premium',
          status: 'active',
        },
      });

    const client = createLagoClient(config);
    const subscription = await client.createSubscription({
      externalCustomerId: 'user-1',
      planCode: 'premium',
    });

    expect(subscription.status).toBe('active');
  });

  it('sends a usage event', async () => {
    nock('http://lago.test')
      .post('/api/v1/events', {
        event: {
          transaction_id: 'evt-1',
          external_customer_id: 'user-1',
          code: 'chat_message',
          properties: { cost_usd: '0.0042' },
        },
      })
      .reply(200, {});

    const client = createLagoClient(config);
    await expect(
      client.sendUsageEvent({
        transactionId: 'evt-1',
        externalCustomerId: 'user-1',
        billableMetricCode: 'chat_message',
        properties: { cost_usd: '0.0042' },
      }),
    ).resolves.not.toThrow();
  });

  it('throws with the Lago error body on a non-2xx response', async () => {
    nock('http://lago.test')
      .post('/api/v1/customers')
      .reply(422, { error: 'Validation error', message: 'external_id is required' });

    const client = createLagoClient(config);
    await expect(client.createCustomer({ externalId: '', name: '' })).rejects.toThrow(
      /external_id is required/,
    );
  });

  it('lists add-ons', async () => {
    nock('http://lago.test')
      .get('/api/v1/add_ons')
      .reply(200, {
        add_ons: [
          { code: 'growth', name: 'Growth', amount_cents: 2000, amount_currency: 'USD' },
        ],
      });

    const client = createLagoClient(config);
    const addOns = await client.listAddOns();

    expect(addOns).toEqual([
      { code: 'growth', name: 'Growth', amountCents: 2000, amountCurrency: 'USD' },
    ]);
  });

  it('creates a checkout session for a plan', async () => {
    nock('http://lago.test')
      .post('/api/v1/customers/user-1/checkout_url', { plan_code: 'premium' })
      .reply(200, { customer: { checkout_url: 'https://stripe.example/checkout/abc' } });

    const client = createLagoClient(config);
    const session = await client.createCheckoutSession({
      externalCustomerId: 'user-1',
      planCode: 'premium',
    });

    expect(session.url).toBe('https://stripe.example/checkout/abc');
  });

  it('creates a checkout session for an add-on', async () => {
    nock('http://lago.test')
      .post('/api/v1/customers/user-1/checkout_url', { add_on_code: 'growth' })
      .reply(200, { customer: { checkout_url: 'https://stripe.example/checkout/topup' } });

    const client = createLagoClient(config);
    const session = await client.createAddOnCheckoutSession({
      externalCustomerId: 'user-1',
      addOnCode: 'growth',
    });

    expect(session.url).toBe('https://stripe.example/checkout/topup');
  });

  it("fetches a customer's active subscription details", async () => {
    nock('http://lago.test')
      .get('/api/v1/subscriptions')
      .query({ external_customer_id: 'user-1', 'status[]': 'active' })
      .reply(200, {
        subscriptions: [
          {
            lago_id: 'sub-1',
            external_id: 'sub-ext-1',
            external_customer_id: 'user-1',
            plan_code: 'nexus_premium',
            status: 'active',
            started_at: '2026-06-11T00:00:00Z',
          },
        ],
      });

    const client = createLagoClient(config);
    const subscription = await client.getActiveSubscription('user-1');

    expect(subscription).toEqual({
      planCode: 'nexus_premium',
      externalId: 'sub-ext-1',
      startedAt: '2026-06-11T00:00:00Z',
    });
  });

  it('returns null when the customer has no active subscription', async () => {
    nock('http://lago.test')
      .get('/api/v1/subscriptions')
      .query({ external_customer_id: 'user-2', 'status[]': 'active' })
      .reply(200, { subscriptions: [] });

    const client = createLagoClient(config);
    const subscription = await client.getActiveSubscription('user-2');

    expect(subscription).toBeNull();
  });

  it('terminates a subscription by its external_id', async () => {
    nock('http://lago.test').delete('/api/v1/subscriptions/sub-ext-1').reply(200, {
      subscription: { external_id: 'sub-ext-1', status: 'terminated' },
    });

    const client = createLagoClient(config);
    await expect(client.terminateSubscription('sub-ext-1')).resolves.not.toThrow();
  });

  it("lists a customer's invoices", async () => {
    nock('http://lago.test')
      .get('/api/v1/invoices')
      .query({ external_customer_id: 'user-1' })
      .reply(200, {
        invoices: [
          {
            lago_id: 'inv-1',
            issuing_date: '2026-07-11',
            total_amount_cents: 2000,
            currency: 'USD',
            status: 'finalized',
            payment_status: 'succeeded',
            file_url: 'https://billing.example/invoices/inv-1.pdf',
          },
        ],
      });

    const client = createLagoClient(config);
    const invoices = await client.listInvoices('user-1');

    expect(invoices).toEqual([
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
});
