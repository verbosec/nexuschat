jest.mock('@librechat/api', () => ({
  getBillingConfig: jest.fn(),
  createLagoClient: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  handleLagoWebhook: jest.fn(),
  getCuratedPlans: jest.fn(),
  getCuratedAddOns: jest.fn(),
}));
jest.mock('~/models', () => ({
  findUser: jest.fn(),
  upsertBalanceFields: jest.fn(),
  findBalanceByUser: jest.fn(),
}));

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  return res;
}

describe('BillingWebhooks controller', () => {
  let getBillingConfig;
  let verifyWebhookSignature;
  let handleLagoWebhook;
  let getCuratedPlans;
  let getCuratedAddOns;

  beforeEach(() => {
    jest.resetModules();
    ({ getBillingConfig, verifyWebhookSignature, handleLagoWebhook, getCuratedPlans, getCuratedAddOns } =
      require('@librechat/api'));
    getBillingConfig.mockReturnValue({
      apiUrl: 'http://lago.test',
      apiKey: 'key',
      webhookSecret: 'test-secret',
    });
    getCuratedPlans.mockReturnValue([]);
    getCuratedAddOns.mockReturnValue([]);
  });

  it("sources getPlanCreditsAllowance/getAddOnCreditsValue deps from the curated plan/add-on config", async () => {
    verifyWebhookSignature.mockReturnValue(true);
    handleLagoWebhook.mockResolvedValue(undefined);
    getCuratedPlans.mockReturnValue([
      { code: 'a_new_plan_code', tier: 'new', interval: 'monthly', tokenCredits: 4242 },
    ]);
    getCuratedAddOns.mockReturnValue([{ code: 'a_new_addon_code', tokenCredits: 999 }]);
    const { postLagoWebhook } = require('./BillingWebhooks');

    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'valid-signature' },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    const deps = handleLagoWebhook.mock.calls[0][1];
    expect(deps.getPlanCreditsAllowance('a_new_plan_code')).toBe(4242);
    expect(deps.getPlanCreditsAllowance('unknown_code')).toBe(0);
    expect(deps.getAddOnCreditsValue('a_new_addon_code')).toBe(999);
    expect(deps.getAddOnCreditsValue('unknown_code')).toBe(0);
  });

  it('processes a validly signed webhook and returns 200', async () => {
    verifyWebhookSignature.mockReturnValue(true);
    handleLagoWebhook.mockResolvedValue(undefined);
    const { postLagoWebhook } = require('./BillingWebhooks');

    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'valid-signature' },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    expect(handleLagoWebhook).toHaveBeenCalledWith(
      { webhook_type: 'subscription.started' },
      expect.any(Object),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid signature with 401 and never processes the event', async () => {
    verifyWebhookSignature.mockReturnValue(false);
    handleLagoWebhook.mockResolvedValue(undefined);
    const { postLagoWebhook } = require('./BillingWebhooks');

    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'bad-signature' },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    expect(handleLagoWebhook).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 503 when billing is not configured', async () => {
    getBillingConfig.mockReturnValue(null);
    const { postLagoWebhook } = require('./BillingWebhooks');

    const req = {
      rawBody: Buffer.from('{}'),
      body: {},
      headers: { 'x-lago-signature': 'sig' },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 500 (not throw) when handleLagoWebhook itself throws', async () => {
    verifyWebhookSignature.mockReturnValue(true);
    handleLagoWebhook.mockRejectedValue(new Error('db down'));
    const { postLagoWebhook } = require('./BillingWebhooks');

    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'valid-signature' },
    };
    const res = buildRes();

    await expect(postLagoWebhook(req, res)).resolves.toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
