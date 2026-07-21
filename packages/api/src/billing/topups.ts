import type { LagoClient } from './lago-client';
import type { Provisioning } from './provisioning';
import type { LagoCheckoutSession } from './types';

export interface TopupCheckoutDeps {
  provisioning: Provisioning;
  lagoClient: LagoClient;
}

export interface TopupCheckout {
  createTopupCheckoutSession(localUserId: string, addOnCode: string): Promise<LagoCheckoutSession>;
}

export function createTopupCheckout(deps: TopupCheckoutDeps): TopupCheckout {
  async function createTopupCheckoutSession(
    localUserId: string,
    addOnCode: string,
  ): Promise<LagoCheckoutSession> {
    const externalCustomerId = await deps.provisioning.ensureLagoCustomer(localUserId);
    return deps.lagoClient.createAddOnCheckoutSession({ externalCustomerId, addOnCode });
  }

  return { createTopupCheckoutSession };
}
