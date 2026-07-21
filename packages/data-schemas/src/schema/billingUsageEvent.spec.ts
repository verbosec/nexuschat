import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import billingUsageEventSchema from './billingUsageEvent';
import type { IBillingUsageEvent } from '~/types';

let mongoServer: MongoMemoryServer;
let BillingUsageEvent: mongoose.Model<IBillingUsageEvent>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  BillingUsageEvent =
    mongoose.models.BillingUsageEvent ||
    mongoose.model<IBillingUsageEvent>('BillingUsageEvent', billingUsageEventSchema);
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

describe('BillingUsageEvent schema', () => {
  it('creates a record with defaults and no sync timestamp', async () => {
    const doc = await BillingUsageEvent.create({
      user: new Types.ObjectId(),
      conversationId: 'convo-1',
      messageId: 'msg-1',
      model: 'gpt-5',
      costUSD: 0.0042,
      lagoTransactionId: 'evt-abc-123',
    });

    expect(doc.syncedAt).toBeUndefined();
    expect(doc.syncError).toBeUndefined();
    expect(doc.costUSD).toBe(0.0042);
    expect(doc.lagoTransactionId).toBe('evt-abc-123');
  });

  it('requires user, model, costUSD, and lagoTransactionId', async () => {
    await expect(
      BillingUsageEvent.create({ conversationId: 'convo-1' } as Partial<IBillingUsageEvent>),
    ).rejects.toThrow();
  });

  it('enforces a unique lagoTransactionId', async () => {
    const user = new Types.ObjectId();
    await BillingUsageEvent.create({
      user,
      model: 'gpt-5',
      costUSD: 0.01,
      lagoTransactionId: 'evt-dup',
    });

    await expect(
      BillingUsageEvent.create({
        user,
        model: 'gpt-5',
        costUSD: 0.02,
        lagoTransactionId: 'evt-dup',
      }),
    ).rejects.toThrow();
  });
});
