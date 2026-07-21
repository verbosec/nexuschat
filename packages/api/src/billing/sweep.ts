import { logger } from '@librechat/data-schemas';
import type { LagoClient } from './lago-client';

const DEFAULT_BILLING_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface UnsyncedBillingEvent {
  _id: unknown;
  /** Typed `unknown`, not `string` — the real IBillingUsageEvent.user is a Mongoose
   *  Types.ObjectId, and findUser()'s `{ _id }` query criteria accepts either an
   *  ObjectId or a string, so no conversion is needed at the call site. */
  user: unknown;
  model: string;
  costUSD: number;
  lagoTransactionId: string;
}

export interface SweepDeps {
  lagoClient: LagoClient;
  findUser: (
    criteria: Record<string, unknown>,
    fields?: string[],
  ) => Promise<{ _id: unknown; openidId?: string } | null>;
  findUnsyncedBillingUsageEvents: (limit: number) => Promise<UnsyncedBillingEvent[]>;
  markBillingUsageEventSynced: (id: string) => Promise<void>;
  markBillingUsageEventSyncFailed: (id: string, error: string) => Promise<void>;
}

export interface SweepOptions {
  limit?: number;
}

export interface SweepResult {
  scanned: number;
  synced: number;
  failed: number;
}

export async function sweepUnsyncedBillingEvents(
  options: SweepOptions | undefined,
  deps: SweepDeps,
): Promise<SweepResult> {
  const limit = options?.limit ?? 100;
  const events = await deps.findUnsyncedBillingUsageEvents(limit);
  let synced = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const user = await deps.findUser({ _id: event.user }, ['openidId']);
      if (!user?.openidId) {
        // User no longer has a Lago identity (shouldn't normally happen); skip, don't fail loudly.
        continue;
      }
      await deps.lagoClient.sendUsageEvent({
        transactionId: event.lagoTransactionId,
        externalCustomerId: user.openidId,
        billableMetricCode: 'chat_message',
        properties: { cost_usd: event.costUSD.toFixed(4) },
      });
      await deps.markBillingUsageEventSynced(String(event._id));
      synced++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.markBillingUsageEventSyncFailed(String(event._id), message);
      failed++;
    }
  }

  if (synced > 0 || failed > 0) {
    logger.info(
      `[billing-sweep] Processed ${events.length} events: ${synced} synced, ${failed} failed`,
    );
  }

  return { scanned: events.length, synced, failed };
}

export function getBillingSweepInterval(
  interval: string | undefined = process.env.BILLING_SWEEP_INTERVAL_MS,
): number {
  if (interval == null || interval.trim() === '') {
    return DEFAULT_BILLING_SWEEP_INTERVAL_MS;
  }
  const value = Number(interval);
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_BILLING_SWEEP_INTERVAL_MS;
  }
  return value;
}

export interface StartSweepDeps extends SweepDeps {
  runAsSystem: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function startBillingEventSweep(
  options: SweepOptions | undefined,
  deps: StartSweepDeps,
): NodeJS.Timeout | null {
  const intervalMs = getBillingSweepInterval();
  if (intervalMs === 0) {
    logger.info('[billing-sweep] Disabled by BILLING_SWEEP_INTERVAL_MS=0');
    return null;
  }

  let isSweeping = false;
  const runSweep = async () => {
    if (isSweeping) {
      return;
    }
    isSweeping = true;
    try {
      await deps.runAsSystem(() => sweepUnsyncedBillingEvents(options, deps));
    } catch (error) {
      logger.error('[billing-sweep] Background sweep failed:', error);
    } finally {
      isSweeping = false;
    }
  };

  runSweep();
  const interval = setInterval(runSweep, intervalMs);
  interval.unref?.();
  return interval;
}
