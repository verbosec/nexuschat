import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createBillingUsageEventModel } from './billingUsageEvent';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('createBillingUsageEventModel', () => {
  it('registers a BillingUsageEvent model on the given mongoose instance', () => {
    const Model = createBillingUsageEventModel(mongoose);
    expect(Model.modelName).toBe('BillingUsageEvent');
    expect(mongoose.models.BillingUsageEvent).toBe(Model);
  });

  it('is idempotent when called twice', () => {
    const first = createBillingUsageEventModel(mongoose);
    const second = createBillingUsageEventModel(mongoose);
    expect(first).toBe(second);
  });
});
