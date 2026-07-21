import { createProvisioning } from './provisioning';
import type { LagoClient } from './lago-client';

function buildLagoClientMock(overrides: Partial<LagoClient> = {}): LagoClient {
  return {
    createCustomer: jest.fn().mockResolvedValue({ lagoId: 'lc-1', externalId: 'ext-1' }),
    getPlan: jest.fn(),
    listPlans: jest.fn(),
    createSubscription: jest.fn().mockResolvedValue({
      lagoId: 'sub-1',
      externalCustomerId: 'ext-1',
      planCode: 'premium',
      status: 'active',
    }),
    sendUsageEvent: jest.fn(),
    listAddOns: jest.fn(),
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
    getActiveSubscription: jest.fn(),
    terminateSubscription: jest.fn(),
    listInvoices: jest.fn(),
    ...overrides,
  };
}

describe('createProvisioning', () => {
  it("ensureLagoCustomer creates a customer keyed by the user's openidId", async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    const externalId = await provisioning.ensureLagoCustomer('user-1');

    expect(externalId).toBe('zitadel-sub-1');
    expect(lagoClient.createCustomer).toHaveBeenCalledWith({
      externalId: 'zitadel-sub-1',
      name: 'zitadel-sub-1',
    });
  });

  it('ensureLagoCustomer throws a clear error when the user has no openidId', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    await expect(provisioning.ensureLagoCustomer('user-1')).rejects.toThrow(/openidId/);
  });

  it('ensureLagoCustomer throws when the user does not exist', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue(null);
    const provisioning = createProvisioning({ lagoClient, findUser });

    await expect(provisioning.ensureLagoCustomer('missing-user')).rejects.toThrow(/not found/);
  });

  it('createSubscriptionForUser creates a Lago subscription for the given plan', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    const subscription = await provisioning.createSubscriptionForUser('user-1', 'premium');

    expect(lagoClient.createSubscription).toHaveBeenCalledWith({
      externalCustomerId: 'zitadel-sub-1',
      planCode: 'premium',
    });
    expect(subscription.status).toBe('active');
  });
});
