import type { Document, Types } from 'mongoose';

// @ts-ignore — `model` collides with Document's own `model()` method, same as ITransaction
export interface IBillingUsageEvent extends Document {
  user: Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  model: string;
  costUSD: number;
  /** Idempotency key sent to Lago as the event's transaction_id */
  lagoTransactionId: string;
  /** Set once Lago has confirmed receipt of the usage event */
  syncedAt?: Date;
  /** Last error message if the most recent sync attempt failed */
  syncError?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
