import { sweepUnsyncedBillingEvents } from './sweep';
import type { LagoClient } from './lago-client';

describe('sweepUnsyncedBillingEvents', () => {
  it('resends each un-synced event and marks it synced on success', async () => {
    const events = [
      { _id: 'e1', user: 'user-1', model: 'gpt-5', costUSD: 0.01, lagoTransactionId: 'evt-1' },
      { _id: 'e2', user: 'user-2', model: 'gpt-5', costUSD: 0.02, lagoTransactionId: 'evt-2' },
    ];
    const findUnsyncedBillingUsageEvents = jest.fn().mockResolvedValue(events);
    const markBillingUsageEventSynced = jest.fn().mockResolvedValue(undefined);
    const markBillingUsageEventSyncFailed = jest.fn().mockResolvedValue(undefined);
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-1' });
    const sendUsageEvent = jest.fn().mockResolvedValue(undefined);
    const lagoClient = { sendUsageEvent } as unknown as LagoClient;

    const result = await sweepUnsyncedBillingEvents(
      { limit: 50 },
      {
        lagoClient,
        findUser,
        findUnsyncedBillingUsageEvents,
        markBillingUsageEventSynced,
        markBillingUsageEventSyncFailed,
      },
    );

    expect(result).toEqual({ scanned: 2, synced: 2, failed: 0 });
    expect(markBillingUsageEventSynced).toHaveBeenCalledTimes(2);
    expect(markBillingUsageEventSyncFailed).not.toHaveBeenCalled();
  });

  it('marks an event failed again (not throwing) when the resend also fails', async () => {
    const events = [
      { _id: 'e1', user: 'user-1', model: 'gpt-5', costUSD: 0.01, lagoTransactionId: 'evt-1' },
    ];
    const findUnsyncedBillingUsageEvents = jest.fn().mockResolvedValue(events);
    const markBillingUsageEventSynced = jest.fn();
    const markBillingUsageEventSyncFailed = jest.fn().mockResolvedValue(undefined);
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-1' });
    const sendUsageEvent = jest.fn().mockRejectedValue(new Error('still down'));
    const lagoClient = { sendUsageEvent } as unknown as LagoClient;

    const result = await sweepUnsyncedBillingEvents(
      { limit: 50 },
      {
        lagoClient,
        findUser,
        findUnsyncedBillingUsageEvents,
        markBillingUsageEventSynced,
        markBillingUsageEventSyncFailed,
      },
    );

    expect(result).toEqual({ scanned: 1, synced: 0, failed: 1 });
    expect(markBillingUsageEventSyncFailed).toHaveBeenCalledWith('e1', 'still down');
  });

  it('skips (not fails) an event whose user no longer has a Zitadel identity', async () => {
    const events = [
      { _id: 'e1', user: 'user-1', model: 'gpt-5', costUSD: 0.01, lagoTransactionId: 'evt-1' },
    ];
    const findUnsyncedBillingUsageEvents = jest.fn().mockResolvedValue(events);
    const markBillingUsageEventSynced = jest.fn();
    const markBillingUsageEventSyncFailed = jest.fn();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1' });
    const sendUsageEvent = jest.fn();
    const lagoClient = { sendUsageEvent } as unknown as LagoClient;

    const result = await sweepUnsyncedBillingEvents(
      { limit: 50 },
      {
        lagoClient,
        findUser,
        findUnsyncedBillingUsageEvents,
        markBillingUsageEventSynced,
        markBillingUsageEventSyncFailed,
      },
    );

    expect(result).toEqual({ scanned: 1, synced: 0, failed: 0 });
    expect(sendUsageEvent).not.toHaveBeenCalled();
    expect(markBillingUsageEventSynced).not.toHaveBeenCalled();
    expect(markBillingUsageEventSyncFailed).not.toHaveBeenCalled();
  });
});

describe('getBillingSweepInterval', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getBillingSweepInterval } = require('./sweep');

  it('defaults to 5 minutes when unset', () => {
    expect(getBillingSweepInterval(undefined)).toBe(5 * 60 * 1000);
  });

  it('defaults when set to an invalid value', () => {
    expect(getBillingSweepInterval('not-a-number')).toBe(5 * 60 * 1000);
    expect(getBillingSweepInterval('-100')).toBe(5 * 60 * 1000);
  });

  it('uses the configured value when valid, including 0 (disabled)', () => {
    expect(getBillingSweepInterval('60000')).toBe(60000);
    expect(getBillingSweepInterval('0')).toBe(0);
  });
});
