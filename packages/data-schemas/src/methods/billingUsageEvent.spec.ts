import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBillingUsageEventMethods } from './billingUsageEvent';
import billingUsageEventSchema from '~/schema/billingUsageEvent';
import type * as t from '~/types';

let mongoServer: MongoMemoryServer;
let BillingUsageEvent: mongoose.Model<t.IBillingUsageEvent>;
let methods: ReturnType<typeof createBillingUsageEventMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  BillingUsageEvent =
    mongoose.models.BillingUsageEvent ||
    mongoose.model<t.IBillingUsageEvent>('BillingUsageEvent', billingUsageEventSchema);
  methods = createBillingUsageEventMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
  await BillingUsageEvent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await BillingUsageEvent.deleteMany({});
});

describe('billingUsageEvent methods', () => {
  it('creates a billing usage event', async () => {
    const user = new Types.ObjectId().toString();
    const doc = await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.01,
      lagoTransactionId: 'evt-1',
    });
    expect(doc.lagoTransactionId).toBe('evt-1');
  });

  it('finds only un-synced events, oldest first, up to a limit', async () => {
    const user = new Types.ObjectId().toString();
    const older = await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.01,
      lagoTransactionId: 'evt-old',
    });
    await BillingUsageEvent.updateOne({ _id: older._id }, { createdAt: new Date('2020-01-01') });
    await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.02,
      lagoTransactionId: 'evt-new',
    });
    const synced = await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.03,
      lagoTransactionId: 'evt-synced',
    });
    await methods.markBillingUsageEventSynced(synced._id.toString());

    const unsynced = await methods.findUnsyncedBillingUsageEvents(10);

    expect(unsynced.map((e) => e.lagoTransactionId)).toEqual(['evt-old', 'evt-new']);
  });

  it('marks an event synced, clearing any prior error', async () => {
    const user = new Types.ObjectId().toString();
    const doc = await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.01,
      lagoTransactionId: 'evt-2',
    });
    await methods.markBillingUsageEventSyncFailed(doc._id.toString(), 'timeout');
    await methods.markBillingUsageEventSynced(doc._id.toString());

    const reloaded = await BillingUsageEvent.findById(doc._id).lean();
    expect(reloaded?.syncedAt).toBeInstanceOf(Date);
    expect(reloaded?.syncError).toBeUndefined();
  });

  it('marks an event sync-failed with the error message', async () => {
    const user = new Types.ObjectId().toString();
    const doc = await methods.createBillingUsageEvent({
      user,
      model: 'gpt-5',
      costUSD: 0.01,
      lagoTransactionId: 'evt-3',
    });
    await methods.markBillingUsageEventSyncFailed(doc._id.toString(), 'Lago 503');

    const reloaded = await BillingUsageEvent.findById(doc._id).lean();
    expect(reloaded?.syncError).toBe('Lago 503');
    expect(reloaded?.syncedAt).toBeUndefined();
  });
});
