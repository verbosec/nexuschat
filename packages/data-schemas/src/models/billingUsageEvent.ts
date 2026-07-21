import { Model } from 'mongoose';
import type * as t from '~/types';
import billingUsageEventSchema from '~/schema/billingUsageEvent';

export function createBillingUsageEventModel(
  mongoose: typeof import('mongoose'),
): Model<t.IBillingUsageEvent> {
  return (
    mongoose.models.BillingUsageEvent ||
    mongoose.model<t.IBillingUsageEvent>('BillingUsageEvent', billingUsageEventSchema)
  );
}
