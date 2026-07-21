import { createUsageEventEmitter } from './usage-events';
import type { LagoClient } from './lago-client';

function buildDeps(overrides: Record<string, unknown> = {}) {
  const lagoClient: Partial<LagoClient> = {
    sendUsageEvent: jest.fn().mockResolvedValue(undefined),
  };
  return {
    lagoClient: lagoClient as LagoClient,
    findUser: jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' }),
    createBillingUsageEvent: jest.fn().mockResolvedValue({ _id: 'event-1' }),
    markBillingUsageEventSynced: jest.fn().mockResolvedValue(undefined),
    markBillingUsageEventSyncFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createUsageEventEmitter', () => {
  it('records a BillingUsageEvent and reports it to Lago, then marks it synced', async () => {
    const deps = buildDeps();
    const emitter = createUsageEventEmitter(deps);

    await emitter.emitUsageEvent({
      localUserId: 'user-1',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      model: 'gpt-5',
      costUSD: 0.0042,
    });

    expect(deps.createBillingUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        conversationId: 'convo-1',
        messageId: 'msg-1',
        model: 'gpt-5',
        costUSD: 0.0042,
      }),
    );
    expect(deps.lagoClient.sendUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCustomerId: 'zitadel-sub-1',
        billableMetricCode: 'chat_message',
        properties: { cost_usd: '0.0042' },
      }),
    );
    expect(deps.markBillingUsageEventSynced).toHaveBeenCalledWith('event-1');
  });

  it('never throws when the user has no Zitadel identity yet (free tier, no billing action taken)', async () => {
    const deps = buildDeps({ findUser: jest.fn().mockResolvedValue({ _id: 'user-1' }) });
    const emitter = createUsageEventEmitter(deps);

    await expect(
      emitter.emitUsageEvent({
        localUserId: 'user-1',
        model: 'gpt-5',
        costUSD: 0.01,
      }),
    ).resolves.toBeUndefined();
    expect(deps.createBillingUsageEvent).not.toHaveBeenCalled();
  });

  it('marks the event sync-failed and never throws when Lago is unreachable', async () => {
    const deps = buildDeps({
      lagoClient: { sendUsageEvent: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    });
    const emitter = createUsageEventEmitter(deps);

    await expect(
      emitter.emitUsageEvent({ localUserId: 'user-1', model: 'gpt-5', costUSD: 0.01 }),
    ).resolves.toBeUndefined();
    expect(deps.markBillingUsageEventSyncFailed).toHaveBeenCalledWith('event-1', 'ECONNREFUSED');
  });
});
