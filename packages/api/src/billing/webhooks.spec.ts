import { createHmac } from 'crypto';
import { verifyWebhookSignature, handleLagoWebhook } from './webhooks';

const SECRET = 'test-webhook-secret';

function sign(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    const signature = sign(rawBody);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
  });

  it('rejects a payload with an incorrect signature', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    expect(verifyWebhookSignature(rawBody, 'not-the-real-signature', SECRET)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    expect(verifyWebhookSignature(rawBody, undefined, SECRET)).toBe(false);
  });

  it('rejects a payload that was tampered with after signing', () => {
    const original = '{"webhook":{"webhook_type":"subscription.started"}}';
    const signature = sign(original);
    const tampered = '{"webhook":{"webhook_type":"subscription.terminated"}}';
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });
});

describe('handleLagoWebhook — subscription lifecycle', () => {
  function buildDeps(overrides: Record<string, unknown> = {}) {
    return {
      findUserByOpenidId: jest.fn().mockResolvedValue({ _id: 'user-1' }),
      upsertBalanceFields: jest.fn().mockResolvedValue(undefined),
      getPlanCreditsAllowance: jest.fn().mockReturnValue(5000),
      getAddOnCreditsValue: jest.fn(),
      getCurrentTokenCredits: jest.fn(),
      ...overrides,
    };
  }

  it('updates local Balance allowance when a subscription starts', async () => {
    const deps = buildDeps();
    await handleLagoWebhook(
      {
        webhook_type: 'subscription.started',
        subscription: { external_customer_id: 'zitadel-sub-1', plan_code: 'premium' },
      },
      deps as never,
    );

    expect(deps.findUserByOpenidId).toHaveBeenCalledWith('zitadel-sub-1');
    expect(deps.upsertBalanceFields).toHaveBeenCalledWith('user-1', {
      tokenCredits: 1_000_000,
      refillAmount: 1_000_000,
      refillIntervalUnit: 'months',
      refillIntervalValue: 1,
      autoRefillEnabled: true,
      lastRefill: expect.any(Date),
    });
  });

  it('ignores unknown webhook types without throwing', async () => {
    const deps = buildDeps();
    await expect(
      handleLagoWebhook({ webhook_type: 'invoice.drafted', invoice: {} }, deps as never),
    ).resolves.toBeUndefined();
    expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
  });

  it('does nothing (not throw) when the customer maps to no local user', async () => {
    const deps = buildDeps({ findUserByOpenidId: jest.fn().mockResolvedValue(null) });
    await expect(
      handleLagoWebhook(
        {
          webhook_type: 'subscription.started',
          subscription: { external_customer_id: 'unknown', plan_code: 'premium' },
        },
        deps as never,
      ),
    ).resolves.toBeUndefined();
    expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
  });
});

describe('handleLagoWebhook — add-on top-up', () => {
  function buildDeps(overrides: Record<string, unknown> = {}) {
    return {
      findUserByOpenidId: jest.fn().mockResolvedValue({ _id: 'user-1' }),
      upsertBalanceFields: jest.fn().mockResolvedValue(undefined),
      getPlanCreditsAllowance: jest.fn(),
      getAddOnCreditsValue: jest.fn().mockReturnValue(2500),
      getCurrentTokenCredits: jest.fn().mockResolvedValue(3_000_000),
      ...overrides,
    };
  }

  it("credits the add-on's marketed value directly onto the existing balance", async () => {
    const deps = buildDeps();
    await handleLagoWebhook(
      {
        webhook_type: 'applied_add_on.created',
        applied_add_on: { external_customer_id: 'zitadel-sub-1', add_on_code: 'growth' },
      },
      deps as never,
    );

    expect(deps.getCurrentTokenCredits).toHaveBeenCalledWith('user-1');
    expect(deps.upsertBalanceFields).toHaveBeenCalledWith('user-1', {
      tokenCredits: 3_000_000 + 2500 * 200,
    });
  });

  it('does nothing (not throw) when the customer maps to no local user', async () => {
    const deps = buildDeps({ findUserByOpenidId: jest.fn().mockResolvedValue(null) });
    await expect(
      handleLagoWebhook(
        {
          webhook_type: 'applied_add_on.created',
          applied_add_on: { external_customer_id: 'unknown', add_on_code: 'growth' },
        },
        deps as never,
      ),
    ).resolves.toBeUndefined();
    expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
  });
});
