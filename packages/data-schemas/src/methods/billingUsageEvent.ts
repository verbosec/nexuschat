import type { Model } from 'mongoose';
import type { IBillingUsageEvent } from '~/types';

export interface CreateBillingUsageEventInput {
  user: string;
  conversationId?: string;
  messageId?: string;
  model: string;
  costUSD: number;
  lagoTransactionId: string;
}

export interface BillingUsageEventMethods {
  createBillingUsageEvent: (input: CreateBillingUsageEventInput) => Promise<IBillingUsageEvent>;
  findUnsyncedBillingUsageEvents: (limit: number) => Promise<IBillingUsageEvent[]>;
  markBillingUsageEventSynced: (id: string) => Promise<void>;
  markBillingUsageEventSyncFailed: (id: string, error: string) => Promise<void>;
}

export function createBillingUsageEventMethods(
  mongoose: typeof import('mongoose'),
): BillingUsageEventMethods {
  async function createBillingUsageEvent(
    input: CreateBillingUsageEventInput,
  ): Promise<IBillingUsageEvent> {
    const BillingUsageEvent = mongoose.models.BillingUsageEvent as Model<IBillingUsageEvent>;
    return BillingUsageEvent.create(input);
  }

  async function findUnsyncedBillingUsageEvents(limit: number): Promise<IBillingUsageEvent[]> {
    const BillingUsageEvent = mongoose.models.BillingUsageEvent as Model<IBillingUsageEvent>;
    return BillingUsageEvent.find({ syncedAt: { $exists: false } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean<IBillingUsageEvent[]>();
  }

  async function markBillingUsageEventSynced(id: string): Promise<void> {
    const BillingUsageEvent = mongoose.models.BillingUsageEvent as Model<IBillingUsageEvent>;
    await BillingUsageEvent.updateOne(
      { _id: id },
      { $set: { syncedAt: new Date() }, $unset: { syncError: 1 } },
    );
  }

  async function markBillingUsageEventSyncFailed(id: string, error: string): Promise<void> {
    const BillingUsageEvent = mongoose.models.BillingUsageEvent as Model<IBillingUsageEvent>;
    await BillingUsageEvent.updateOne({ _id: id }, { $set: { syncError: error } });
  }

  return {
    createBillingUsageEvent,
    findUnsyncedBillingUsageEvents,
    markBillingUsageEventSynced,
    markBillingUsageEventSyncFailed,
  };
}
