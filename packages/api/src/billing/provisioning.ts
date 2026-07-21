import type { LagoClient } from './lago-client';
import type { LagoSubscription } from './types';

export interface ProvisioningDeps {
  lagoClient: LagoClient;
  findUser: (
    criteria: Record<string, unknown>,
    fields?: string[],
  ) => Promise<{ _id: unknown; openidId?: string } | null>;
}

export interface Provisioning {
  /** Idempotent: creates a Lago customer keyed by the user's Zitadel ID if needed, returns that ID. */
  ensureLagoCustomer(localUserId: string): Promise<string>;
  createSubscriptionForUser(localUserId: string, planCode: string): Promise<LagoSubscription>;
}

export function createProvisioning(deps: ProvisioningDeps): Provisioning {
  async function resolveExternalId(localUserId: string): Promise<string> {
    const user = await deps.findUser({ _id: localUserId }, ['openidId']);
    if (!user) {
      throw new Error(`Cannot provision billing: user ${localUserId} not found`);
    }
    if (!user.openidId) {
      throw new Error(
        `Cannot provision billing: user ${localUserId} has no openidId (Zitadel SSO identity)`,
      );
    }
    return user.openidId;
  }

  async function ensureLagoCustomer(localUserId: string): Promise<string> {
    const externalId = await resolveExternalId(localUserId);
    // Lago's create-customer endpoint is idempotent on external_id in practice (upsert semantics);
    // calling it again for an existing customer is safe and cheaper than a get-then-create round trip.
    await deps.lagoClient.createCustomer({ externalId, name: externalId });
    return externalId;
  }

  async function createSubscriptionForUser(
    localUserId: string,
    planCode: string,
  ): Promise<LagoSubscription> {
    const externalId = await resolveExternalId(localUserId);
    return deps.lagoClient.createSubscription({ externalCustomerId: externalId, planCode });
  }

  return { ensureLagoCustomer, createSubscriptionForUser };
}
