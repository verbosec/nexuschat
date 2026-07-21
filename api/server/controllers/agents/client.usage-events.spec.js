jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    recordCollectedUsage: jest.fn(),
    computeUsageCostUSD: jest.fn(),
    getBillingConfig: jest.fn(),
    createLagoClient: jest.fn(),
    createUsageEventEmitter: jest.fn(),
  };
});

function buildClient(AgentClient, overrides = {}) {
  const client = Object.create(AgentClient.prototype);
  client.user = 'user-1';
  client.conversationId = 'convo-1';
  client.responseMessageId = 'msg-1';
  client.model = 'gpt-5';
  client.collectedUsage = [{ model: 'gpt-5' }, { model: 'gpt-5' }];
  client.options = { req: {}, endpointTokenConfig: undefined };
  Object.assign(client, overrides);
  return client;
}

describe('AgentClient#recordCollectedUsage billing hook', () => {
  // The usage-event emitter is cached at module scope in client.js (a real,
  // intentional singleton in production). Reset modules between tests so
  // each test's mock config for getBillingConfig is actually re-evaluated,
  // instead of reusing whatever got cached by an earlier test in this file.
  let AgentClient;
  let recordCollectedUsage;
  let computeUsageCostUSD;
  let getBillingConfig;
  let createLagoClient;
  let createUsageEventEmitter;

  beforeEach(() => {
    jest.resetModules();
    ({
      recordCollectedUsage,
      computeUsageCostUSD,
      getBillingConfig,
      createLagoClient,
      createUsageEventEmitter,
    } = require('@librechat/api'));
    AgentClient = require('./client');
    recordCollectedUsage.mockResolvedValue({ input_tokens: 100, output_tokens: 50 });
  });

  it('emits a usage event with the total cost across all collected usage entries', async () => {
    computeUsageCostUSD.mockReturnValueOnce(0.001).mockReturnValueOnce(0.002);
    getBillingConfig.mockReturnValue({
      apiUrl: 'http://lago.test',
      apiKey: 'key',
      webhookSecret: 'secret',
    });
    createLagoClient.mockReturnValue({});
    const emitUsageEvent = jest.fn().mockResolvedValue(undefined);
    createUsageEventEmitter.mockReturnValue({ emitUsageEvent });

    const client = buildClient(AgentClient);
    await client.recordCollectedUsage({ collectedUsage: client.collectedUsage });

    expect(emitUsageEvent).toHaveBeenCalledWith({
      localUserId: 'user-1',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      model: 'gpt-5',
      costUSD: 0.003,
    });
  });

  it('does not throw and does not emit when billing is not configured (getBillingConfig returns null)', async () => {
    computeUsageCostUSD.mockReturnValue(0.001);
    getBillingConfig.mockReturnValue(null);

    const client = buildClient(AgentClient);
    await expect(
      client.recordCollectedUsage({ collectedUsage: client.collectedUsage }),
    ).resolves.toBeUndefined();
    expect(createUsageEventEmitter).not.toHaveBeenCalled();
  });

  it('does not throw if the emitter itself throws', async () => {
    computeUsageCostUSD.mockReturnValue(0.001);
    getBillingConfig.mockReturnValue({
      apiUrl: 'http://lago.test',
      apiKey: 'key',
      webhookSecret: 'secret',
    });
    createLagoClient.mockReturnValue({});
    createUsageEventEmitter.mockReturnValue({
      emitUsageEvent: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const client = buildClient(AgentClient);
    await expect(
      client.recordCollectedUsage({ collectedUsage: client.collectedUsage }),
    ).resolves.toBeUndefined();
  });

  it('does not throw if constructing the billing client itself throws synchronously', async () => {
    computeUsageCostUSD.mockReturnValue(0.001);
    getBillingConfig.mockImplementation(() => {
      throw new Error('should not happen, but must not crash the request either');
    });

    const client = buildClient(AgentClient);
    await expect(
      client.recordCollectedUsage({ collectedUsage: client.collectedUsage }),
    ).resolves.toBeUndefined();
  });
});
