import { createTopupCheckout } from './topups';
import type { LagoClient } from './lago-client';
import type { Provisioning } from './provisioning';

describe('createTopupCheckout', () => {
  it('ensures a Lago customer exists, then requests an add-on checkout session', async () => {
    const provisioning: Provisioning = {
      ensureLagoCustomer: jest.fn().mockResolvedValue('zitadel-sub-1'),
      createSubscriptionForUser: jest.fn(),
    };
    const lagoClient = {
      createAddOnCheckoutSession: jest
        .fn()
        .mockResolvedValue({ url: 'https://stripe.example/checkout/abc' }),
    } as unknown as LagoClient;

    const topups = createTopupCheckout({ provisioning, lagoClient });
    const session = await topups.createTopupCheckoutSession('user-1', 'growth');

    expect(provisioning.ensureLagoCustomer).toHaveBeenCalledWith('user-1');
    expect(lagoClient.createAddOnCheckoutSession).toHaveBeenCalledWith({
      externalCustomerId: 'zitadel-sub-1',
      addOnCode: 'growth',
    });
    expect(session.url).toBe('https://stripe.example/checkout/abc');
  });
});
