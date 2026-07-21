import { createHmac, timingSafeEqual } from 'crypto';
import { convertMarketedCreditsToTokenCredits } from './credit-conversion';

/**
 * HMAC-SHA256 signature verification, keyed by LAGO_WEBHOOK_SECRET. This is
 * this plan's best-effort match for Lago's webhook signing scheme and should
 * be confirmed against the real self-hosted instance's webhook docs on first
 * integration. If Lago instead signs with a JWT/RS256 public key, only this
 * one function needs to change.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signatureHeader, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export interface WebhookDispatchDeps {
  findUserByOpenidId: (openidId: string) => Promise<{ _id: unknown } | null>;
  upsertBalanceFields: (
    userId: string,
    fields: {
      tokenCredits?: number;
      refillAmount?: number;
      refillIntervalUnit?: 'seconds' | 'minutes' | 'hours' | 'days' | 'months';
      refillIntervalValue?: number;
      autoRefillEnabled?: boolean;
      lastRefill?: Date;
    },
  ) => Promise<unknown>;
  /** Looks up the marketed-credits allowance configured for a plan code. */
  getPlanCreditsAllowance: (planCode: string) => number;
  /** Looks up the marketed-credits value configured for an Add-on (top-up) code. */
  getAddOnCreditsValue: (addOnCode: string) => number;
  getCurrentTokenCredits: (userId: string) => Promise<number>;
}

interface LagoWebhookPayload {
  webhook_type: string;
  subscription?: { external_customer_id: string; plan_code: string };
  applied_add_on?: { external_customer_id: string; add_on_code: string };
  [key: string]: unknown;
}

async function handleSubscriptionStarted(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  const subscription = payload.subscription;
  if (!subscription) {
    return;
  }

  const user = await deps.findUserByOpenidId(subscription.external_customer_id);
  if (!user) {
    return;
  }

  const marketedCredits = deps.getPlanCreditsAllowance(subscription.plan_code);
  const tokenCredits = convertMarketedCreditsToTokenCredits(marketedCredits);

  await deps.upsertBalanceFields(String(user._id), {
    tokenCredits,
    refillAmount: tokenCredits,
    refillIntervalUnit: 'months',
    refillIntervalValue: 1,
    autoRefillEnabled: true,
    lastRefill: new Date(),
  });
}

async function handleAddOnApplied(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  const appliedAddOn = payload.applied_add_on;
  if (!appliedAddOn) {
    return;
  }

  const user = await deps.findUserByOpenidId(appliedAddOn.external_customer_id);
  if (!user) {
    return;
  }

  const marketedCredits = deps.getAddOnCreditsValue(appliedAddOn.add_on_code);
  const additionalTokenCredits = convertMarketedCreditsToTokenCredits(marketedCredits);
  const currentTokenCredits = await deps.getCurrentTokenCredits(String(user._id));

  await deps.upsertBalanceFields(String(user._id), {
    tokenCredits: currentTokenCredits + additionalTokenCredits,
  });
}

/**
 * The exact Lago webhook type strings (`subscription.started`,
 * `applied_add_on.created`, etc.) are this plan's best-effort match for
 * Lago's event catalogue and should be confirmed against the real
 * self-hosted instance on first integration — they're isolated to this one
 * switch statement.
 */
export async function handleLagoWebhook(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  switch (payload.webhook_type) {
    case 'subscription.started':
    case 'subscription.updated':
      await handleSubscriptionStarted(payload, deps);
      return;
    case 'applied_add_on.created':
      await handleAddOnApplied(payload, deps);
      return;
    default:
      // Unhandled event types (invoice.*, subscription.terminated grace-period
      // handling, etc.) are intentionally no-ops for now — see spec's Open
      // Questions on cancellation/grace-period semantics.
      return;
  }
}
