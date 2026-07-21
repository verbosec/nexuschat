import { Schema } from 'mongoose';
import type { IBillingUsageEvent } from '~/types';

const billingUsageEventSchema: Schema<IBillingUsageEvent> = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    conversationId: {
      type: String,
      index: true,
    },
    messageId: {
      type: String,
    },
    model: {
      type: String,
      required: true,
    },
    costUSD: {
      type: Number,
      required: true,
    },
    lagoTransactionId: {
      type: String,
      required: true,
      unique: true,
    },
    syncedAt: {
      type: Date,
      index: true,
    },
    syncError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

export default billingUsageEventSchema;
