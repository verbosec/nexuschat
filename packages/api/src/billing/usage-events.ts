import { randomUUID } from 'crypto';
import { logger } from '@librechat/data-schemas';
import type { LagoClient } from './lago-client';

export interface UsageEventEmitterDeps {
  lagoClient: LagoClient;
  findUser: (
    criteria: Record<string, unknown>,
    fields?: string[],
  ) => Promise<{ _id: unknown; openidId?: string } | null>;
  createBillingUsageEvent: (input: {
    user: string;
    conversationId?: string;
    messageId?: string;
    model: string;
    costUSD: number;
    lagoTransactionId: string;
  }) => Promise<{ _id: unknown }>;
  markBillingUsageEventSynced: (id: string) => Promise<void>;
  markBillingUsageEventSyncFailed: (id: string, error: string) => Promise<void>;
}

export interface EmitUsageEventInput {
  localUserId: string;
  conversationId?: string;
  messageId?: string;
  model: string;
  costUSD: number;
}

export interface UsageEventEmitter {
  /** Fire-and-forget from the caller's perspective: never throws, never blocks a chat response. */
  emitUsageEvent(input: EmitUsageEventInput): Promise<void>;
}

export function createUsageEventEmitter(deps: UsageEventEmitterDeps): UsageEventEmitter {
  async function emitUsageEvent(input: EmitUsageEventInput): Promise<void> {
    try {
      const user = await deps.findUser({ _id: input.localUserId }, ['openidId']);
      if (!user?.openidId) {
        // Free-tier user with no Lago customer yet — nothing to report.
        return;
      }

      const lagoTransactionId = randomUUID();
      const event = await deps.createBillingUsageEvent({
        user: input.localUserId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        model: input.model,
        costUSD: input.costUSD,
        lagoTransactionId,
      });

      try {
        await deps.lagoClient.sendUsageEvent({
          transactionId: lagoTransactionId,
          externalCustomerId: user.openidId,
          billableMetricCode: 'chat_message',
          properties: { cost_usd: input.costUSD.toFixed(4) },
        });
        await deps.markBillingUsageEventSynced(String(event._id));
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        await deps.markBillingUsageEventSyncFailed(String(event._id), message);
      }
    } catch (error) {
      // This function must never throw — a chat response must never fail because of billing plumbing.
      logger.error('[usage-events] emitUsageEvent failed unexpectedly', error);
    }
  }

  return { emitUsageEvent };
}
