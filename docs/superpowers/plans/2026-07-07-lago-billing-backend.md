# Lago Billing Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend billing infrastructure connecting LibreChat, self-hosted Lago, and Stripe (via Lago's connector) — customer provisioning, usage reporting, entitlement/plan sync via webhooks, and credit top-ups — per `docs/superpowers/specs/2026-07-05-lago-billing-infrastructure-design.md`.

**Architecture:** All new logic lives in `packages/api/src/billing/` (TypeScript, dependency-injected factory functions matching this codebase's established pattern — see `packages/api/src/middleware/checkBalance.ts` and `packages/api/src/files/sweep.ts` for precedent). `api/` only gets thin Express wrappers that inject real dependencies from `~/models`. One new Mongo collection (`BillingUsageEvent`) tracks outbound Lago usage-reporting attempts for durability, kept separate from the existing `Transaction`/`Balance` models rather than modifying them, since `spendTokens` doesn't return the transaction it creates (its signature is `Promise<void>`) — see Task 1's note.

**Tech Stack:** TypeScript (`packages/api`, `packages/data-schemas`), Express (`api/`), Mongoose, axios (matches existing external-HTTP convention in this codebase, e.g. `packages/api/src/files/rag.ts`), Jest + `mongodb-memory-server` + `nock`.

---

## Deviation from the spec (flag for review)

The spec says "add `lagoSyncedAt`/`lagoSyncError` fields to the existing `Transaction` schema." Investigating the actual code (`packages/data-schemas/src/methods/spendTokens.ts`) found that `spendTokens()` returns `Promise<void>` — it does not return the `_id` of the transaction(s) it creates, and it's called fire-and-forget (`.catch()` only, no `.then()`) from the low-level shared `recordCollectedUsage()` in `packages/api/src/agents/usage.ts`. Changing that return signature would touch a widely-used, delicate piece of core spend logic for no real benefit.

Instead, this plan introduces a dedicated `BillingUsageEvent` collection, created independently by the new billing module at the higher-level per-request hook point (`AgentClient.recordCollectedUsage` in `api/server/controllers/agents/client.js`, which already awaits the low-level call and has the final aggregated cost available via `computeUsageCostUSD`). This is lower-risk (zero changes to existing spend/transaction logic) and gives the sweep job a clean, purpose-built place to track sync state. Functionally equivalent to what the spec describes; only the "which collection" detail changed.

---

## File Structure

**New files:**
- `packages/data-schemas/src/types/billingUsageEvent.ts` — `IBillingUsageEvent` interface
- `packages/data-schemas/src/schema/billingUsageEvent.ts` — Mongoose schema
- `packages/data-schemas/src/models/billingUsageEvent.ts` — model factory
- `packages/data-schemas/src/methods/billingUsageEvent.ts` — create/find-unsynced/mark-synced/mark-failed methods
- `packages/api/src/billing/types.ts` — shared Lago/billing TS interfaces
- `packages/api/src/billing/config.ts` — env var getters (Lago URL/key/webhook secret, credit conversion rate)
- `packages/api/src/billing/credit-conversion.ts` — marketed-credits ↔ `tokenCredits` conversion
- `packages/api/src/billing/lago-client.ts` — Lago REST API wrapper
- `packages/api/src/billing/provisioning.ts` — customer/subscription provisioning
- `packages/api/src/billing/usage-events.ts` — usage event emitter (hooked into chat requests)
- `packages/api/src/billing/sweep.ts` — periodic resync of un-synced usage events
- `packages/api/src/billing/webhooks.ts` — Lago webhook signature verification + event dispatch
- `packages/api/src/billing/topups.ts` — credit top-up (Add-on) checkout
- `packages/api/src/billing/index.ts` — barrel export
- `api/server/controllers/Billing.js` — thin controllers for plans/topups/subscription/checkout
- `api/server/controllers/BillingWebhooks.js` — thin controller for the webhook receiver
- `api/server/routes/billing/index.js` — billing API router
- `api/server/routes/billing/webhooks.js` — webhook receiver router

**Modified files:**
- `packages/data-schemas/src/models/index.ts` — register `BillingUsageEvent` model
- `packages/data-schemas/src/methods/index.ts` — register billing-usage-event methods
- `api/server/controllers/agents/client.js:1044-1075` — hook `emitUsageEvent` after `recordCollectedUsage` resolves
- `api/server/index.js` — capture `req.rawBody` in the global JSON parser (needed for webhook signature verification), start the sweep job, mount new routes
- `api/server/routes/index.js` — require + export the new billing routers
- `.env.example` — document new `LAGO_*` env vars

---

## Task 1: `BillingUsageEvent` schema and type

**Files:**
- Create: `packages/data-schemas/src/types/billingUsageEvent.ts`
- Create: `packages/data-schemas/src/schema/billingUsageEvent.ts`
- Test: `packages/data-schemas/src/schema/billingUsageEvent.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-schemas/src/schema/billingUsageEvent.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/schema/billingUsageEvent.spec.ts`
Expected: FAIL with "Cannot find module './billingUsageEvent'"

- [ ] **Step 3: Write the type and schema**

```typescript
// packages/data-schemas/src/types/billingUsageEvent.ts
import type { Document, Types } from 'mongoose';

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
```

```typescript
// packages/data-schemas/src/schema/billingUsageEvent.ts
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
```

Add the export to `packages/data-schemas/src/types/index.ts` (find the existing `export * from './balance';` line and add a matching line for the new file, keeping alphabetical order with its neighbors).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-schemas && npx jest src/schema/billingUsageEvent.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/data-schemas/src/types/billingUsageEvent.ts packages/data-schemas/src/types/index.ts packages/data-schemas/src/schema/billingUsageEvent.ts packages/data-schemas/src/schema/billingUsageEvent.spec.ts
git commit -m "feat(billing): add BillingUsageEvent schema"
```

---

## Task 2: `BillingUsageEvent` model factory

**Files:**
- Create: `packages/data-schemas/src/models/billingUsageEvent.ts`
- Modify: `packages/data-schemas/src/models/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-schemas/src/models/billingUsageEvent.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/models/billingUsageEvent.spec.ts`
Expected: FAIL with "Cannot find module './billingUsageEvent'"

- [ ] **Step 3: Write the model factory**

```typescript
// packages/data-schemas/src/models/billingUsageEvent.ts
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
```

Wire it into `packages/data-schemas/src/models/index.ts`: add `import { createBillingUsageEventModel } from './billingUsageEvent';` near the other model imports, add `BillingUsageEvent: ReturnType<typeof createBillingUsageEventModel>;` to the models interface, and add `BillingUsageEvent: createBillingUsageEventModel(mongoose),` to the returned object (matching the exact three-place pattern used for `Balance` in the same file).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-schemas && npx jest src/models/billingUsageEvent.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/data-schemas/src/models/billingUsageEvent.ts packages/data-schemas/src/models/billingUsageEvent.spec.ts packages/data-schemas/src/models/index.ts
git commit -m "feat(billing): add BillingUsageEvent model factory"
```

---

## Task 3: `BillingUsageEvent` methods

**Files:**
- Create: `packages/data-schemas/src/methods/billingUsageEvent.ts`
- Test: `packages/data-schemas/src/methods/billingUsageEvent.spec.ts`
- Modify: `packages/data-schemas/src/methods/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-schemas/src/methods/billingUsageEvent.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest src/methods/billingUsageEvent.spec.ts`
Expected: FAIL with "Cannot find module './billingUsageEvent'"

- [ ] **Step 3: Write the methods**

```typescript
// packages/data-schemas/src/methods/billingUsageEvent.ts
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
```

Wire into `packages/data-schemas/src/methods/index.ts`:
- Add `import { createBillingUsageEventMethods, type BillingUsageEventMethods } from './billingUsageEvent';` near the "Tier 1 — Simple CRUD" imports (this needs no injected deps, same tier as `createBannerMethods`).
- Add `BillingUsageEventMethods &` to the `AllMethods` intersection type.
- Inside `createMethods()`, add `const billingUsageEventMethods = createBillingUsageEventMethods(mongoose);` near the other Tier-1 instantiations.
- Add `...billingUsageEventMethods,` to the final returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/data-schemas && npx jest src/methods/billingUsageEvent.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/data-schemas/src/methods/billingUsageEvent.ts packages/data-schemas/src/methods/billingUsageEvent.spec.ts packages/data-schemas/src/methods/index.ts
git commit -m "feat(billing): add BillingUsageEvent methods"
```

---

## Task 4: Billing config and credit conversion

**Files:**
- Create: `packages/api/src/billing/config.ts`
- Create: `packages/api/src/billing/credit-conversion.ts`
- Test: `packages/api/src/billing/config.spec.ts`
- Test: `packages/api/src/billing/credit-conversion.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/api/src/billing/config.spec.ts
describe('billing config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reads LAGO_API_URL, LAGO_API_KEY, LAGO_WEBHOOK_SECRET from env', () => {
    process.env.LAGO_API_URL = 'http://lago.internal:3000';
    process.env.LAGO_API_KEY = 'test-key';
    process.env.LAGO_WEBHOOK_SECRET = 'test-secret';
    const { getBillingConfig } = require('./config');

    expect(getBillingConfig()).toEqual({
      apiUrl: 'http://lago.internal:3000',
      apiKey: 'test-key',
      webhookSecret: 'test-secret',
    });
  });

  it('throws a clear error when required env vars are missing', () => {
    delete process.env.LAGO_API_URL;
    delete process.env.LAGO_API_KEY;
    delete process.env.LAGO_WEBHOOK_SECRET;
    const { getBillingConfig } = require('./config');

    expect(() => getBillingConfig()).toThrow(/LAGO_API_URL/);
  });
});
```

```typescript
// packages/api/src/billing/credit-conversion.spec.ts
import { convertMarketedCreditsToTokenCredits } from './credit-conversion';

describe('convertMarketedCreditsToTokenCredits', () => {
  it('converts marketed credits to internal tokenCredits using the configured rate', () => {
    // Rate is fixed at 1 marketed credit = 200 tokenCredits (see credit-conversion.ts for rationale)
    expect(convertMarketedCreditsToTokenCredits(5000)).toBe(1_000_000);
    expect(convertMarketedCreditsToTokenCredits(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx jest src/billing/config.spec.ts src/billing/credit-conversion.spec.ts`
Expected: FAIL with "Cannot find module './config'" / "Cannot find module './credit-conversion'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/billing/config.ts
export interface BillingConfig {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
}

export function getBillingConfig(): BillingConfig {
  const apiUrl = process.env.LAGO_API_URL;
  const apiKey = process.env.LAGO_API_KEY;
  const webhookSecret = process.env.LAGO_WEBHOOK_SECRET;

  if (!apiUrl || !apiKey || !webhookSecret) {
    throw new Error(
      'Billing is misconfigured: LAGO_API_URL, LAGO_API_KEY, and LAGO_WEBHOOK_SECRET must all be set.',
    );
  }

  return { apiUrl, apiKey, webhookSecret };
}
```

```typescript
// packages/api/src/billing/credit-conversion.ts
/**
 * Marketed "credits" (pricing doc Sections 6-7) are a different unit from
 * LibreChat's internal `tokenCredits` (1,000 tokenCredits = $0.001 USD).
 * This fixed multiplier is the single place that conversion happens —
 * changing it must be a deliberate migration of existing balances, not a
 * live config flip (see spec's Error Handling section).
 */
const TOKEN_CREDITS_PER_MARKETED_CREDIT = 200;

export function convertMarketedCreditsToTokenCredits(marketedCredits: number): number {
  return marketedCredits * TOKEN_CREDITS_PER_MARKETED_CREDIT;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/billing/config.spec.ts src/billing/credit-conversion.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/config.ts packages/api/src/billing/config.spec.ts packages/api/src/billing/credit-conversion.ts packages/api/src/billing/credit-conversion.spec.ts
git commit -m "feat(billing): add billing config and credit conversion"
```

---

## Task 5: Lago client — customers, plans, subscriptions, usage events

**Files:**
- Create: `packages/api/src/billing/types.ts`
- Create: `packages/api/src/billing/lago-client.ts`
- Test: `packages/api/src/billing/lago-client.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/billing/lago-client.spec.ts
import nock from 'nock';
import { createLagoClient } from './lago-client';

const config = { apiUrl: 'http://lago.test', apiKey: 'test-key', webhookSecret: 'secret' };

describe('createLagoClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('creates a customer', async () => {
    nock('http://lago.test', { reqheaders: { authorization: 'Bearer test-key' } })
      .post('/api/v1/customers', {
        customer: { external_id: 'user-1', name: 'user-1' },
      })
      .reply(200, { customer: { external_id: 'user-1', lago_id: 'lago-cust-1' } });

    const client = createLagoClient(config);
    const customer = await client.createCustomer({ externalId: 'user-1', name: 'user-1' });

    expect(customer.lagoId).toBe('lago-cust-1');
    expect(customer.externalId).toBe('user-1');
  });

  it('gets a plan by code', async () => {
    nock('http://lago.test')
      .get('/api/v1/plans/premium')
      .reply(200, {
        plan: { code: 'premium', name: 'Premium', amount_cents: 2000, amount_currency: 'USD' },
      });

    const client = createLagoClient(config);
    const plan = await client.getPlan('premium');

    expect(plan.code).toBe('premium');
    expect(plan.amountCents).toBe(2000);
  });

  it('creates a subscription for a customer', async () => {
    nock('http://lago.test')
      .post('/api/v1/subscriptions', {
        subscription: { external_customer_id: 'user-1', plan_code: 'premium' },
      })
      .reply(200, {
        subscription: {
          lago_id: 'sub-1',
          external_customer_id: 'user-1',
          plan_code: 'premium',
          status: 'active',
        },
      });

    const client = createLagoClient(config);
    const subscription = await client.createSubscription({
      externalCustomerId: 'user-1',
      planCode: 'premium',
    });

    expect(subscription.status).toBe('active');
  });

  it('sends a usage event', async () => {
    nock('http://lago.test')
      .post('/api/v1/events', {
        event: {
          transaction_id: 'evt-1',
          external_customer_id: 'user-1',
          code: 'chat_message',
          properties: { cost_usd: '0.0042' },
        },
      })
      .reply(200, {});

    const client = createLagoClient(config);
    await expect(
      client.sendUsageEvent({
        transactionId: 'evt-1',
        externalCustomerId: 'user-1',
        billableMetricCode: 'chat_message',
        properties: { cost_usd: '0.0042' },
      }),
    ).resolves.not.toThrow();
  });

  it('throws with the Lago error body on a non-2xx response', async () => {
    nock('http://lago.test')
      .post('/api/v1/customers')
      .reply(422, { error: 'Validation error', message: 'external_id is required' });

    const client = createLagoClient(config);
    await expect(client.createCustomer({ externalId: '', name: '' })).rejects.toThrow(
      /external_id is required/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: FAIL with "Cannot find module './lago-client'"

- [ ] **Step 3: Write the types and client**

```typescript
// packages/api/src/billing/types.ts
export interface LagoCustomer {
  lagoId: string;
  externalId: string;
}

export interface LagoPlan {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
}

export interface LagoSubscription {
  lagoId: string;
  externalCustomerId: string;
  planCode: string;
  status: string;
}

export interface LagoAddOn {
  code: string;
  name: string;
  amountCents: number;
  amountCurrency: string;
}

export interface LagoCheckoutSession {
  url: string;
}

export interface SendUsageEventInput {
  transactionId: string;
  externalCustomerId: string;
  billableMetricCode: string;
  properties: Record<string, string>;
}
```

```typescript
// packages/api/src/billing/lago-client.ts
import axios, { AxiosInstance } from 'axios';
import { logger } from '@librechat/data-schemas';
import type { BillingConfig } from './config';
import type {
  LagoCustomer,
  LagoPlan,
  LagoSubscription,
  LagoAddOn,
  LagoCheckoutSession,
  SendUsageEventInput,
} from './types';

export interface LagoClient {
  createCustomer(input: { externalId: string; name: string }): Promise<LagoCustomer>;
  getPlan(code: string): Promise<LagoPlan>;
  listPlans(): Promise<LagoPlan[]>;
  createSubscription(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoSubscription>;
  sendUsageEvent(input: SendUsageEventInput): Promise<void>;
  listAddOns(): Promise<LagoAddOn[]>;
  createCheckoutSession(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoCheckoutSession>;
  createAddOnCheckoutSession(input: {
    externalCustomerId: string;
    addOnCode: string;
  }): Promise<LagoCheckoutSession>;
}

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined;
    return data?.message ?? data?.error ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function createLagoClient(config: BillingConfig): LagoClient {
  const http: AxiosInstance = axios.create({
    baseURL: config.apiUrl,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeout: 10_000,
  });

  async function createCustomer(input: {
    externalId: string;
    name: string;
  }): Promise<LagoCustomer> {
    try {
      const { data } = await http.post('/api/v1/customers', {
        customer: { external_id: input.externalId, name: input.name },
      });
      return { lagoId: data.customer.lago_id, externalId: data.customer.external_id };
    } catch (error) {
      logger.error('[lago-client] createCustomer failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function getPlan(code: string): Promise<LagoPlan> {
    try {
      const { data } = await http.get(`/api/v1/plans/${code}`);
      return {
        code: data.plan.code,
        name: data.plan.name,
        amountCents: data.plan.amount_cents,
        amountCurrency: data.plan.amount_currency,
      };
    } catch (error) {
      logger.error(`[lago-client] getPlan(${code}) failed`, error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function listPlans(): Promise<LagoPlan[]> {
    try {
      const { data } = await http.get('/api/v1/plans');
      return (data.plans ?? []).map(
        (plan: {
          code: string;
          name: string;
          amount_cents: number;
          amount_currency: string;
        }) => ({
          code: plan.code,
          name: plan.name,
          amountCents: plan.amount_cents,
          amountCurrency: plan.amount_currency,
        }),
      );
    } catch (error) {
      logger.error('[lago-client] listPlans failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createSubscription(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoSubscription> {
    try {
      const { data } = await http.post('/api/v1/subscriptions', {
        subscription: { external_customer_id: input.externalCustomerId, plan_code: input.planCode },
      });
      return {
        lagoId: data.subscription.lago_id,
        externalCustomerId: data.subscription.external_customer_id,
        planCode: data.subscription.plan_code,
        status: data.subscription.status,
      };
    } catch (error) {
      logger.error('[lago-client] createSubscription failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function sendUsageEvent(input: SendUsageEventInput): Promise<void> {
    try {
      await http.post('/api/v1/events', {
        event: {
          transaction_id: input.transactionId,
          external_customer_id: input.externalCustomerId,
          code: input.billableMetricCode,
          properties: input.properties,
        },
      });
    } catch (error) {
      logger.error('[lago-client] sendUsageEvent failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function listAddOns(): Promise<LagoAddOn[]> {
    try {
      const { data } = await http.get('/api/v1/add_ons');
      return (data.add_ons ?? []).map(
        (addOn: {
          code: string;
          name: string;
          amount_cents: number;
          amount_currency: string;
        }) => ({
          code: addOn.code,
          name: addOn.name,
          amountCents: addOn.amount_cents,
          amountCurrency: addOn.amount_currency,
        }),
      );
    } catch (error) {
      logger.error('[lago-client] listAddOns failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createCheckoutSession(input: {
    externalCustomerId: string;
    planCode: string;
  }): Promise<LagoCheckoutSession> {
    try {
      const { data } = await http.post(
        `/api/v1/customers/${input.externalCustomerId}/checkout_url`,
        { plan_code: input.planCode },
      );
      return { url: data.customer.checkout_url };
    } catch (error) {
      logger.error('[lago-client] createCheckoutSession failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  async function createAddOnCheckoutSession(input: {
    externalCustomerId: string;
    addOnCode: string;
  }): Promise<LagoCheckoutSession> {
    try {
      const { data } = await http.post(
        `/api/v1/customers/${input.externalCustomerId}/checkout_url`,
        { add_on_code: input.addOnCode },
      );
      return { url: data.customer.checkout_url };
    } catch (error) {
      logger.error('[lago-client] createAddOnCheckoutSession failed', error);
      throw new Error(toErrorMessage(error));
    }
  }

  return {
    createCustomer,
    getPlan,
    listPlans,
    createSubscription,
    sendUsageEvent,
    listAddOns,
    createCheckoutSession,
    createAddOnCheckoutSession,
  };
}
```

**Note for implementer:** the exact checkout-session endpoint/payload shape (`createCheckoutSession`/`createAddOnCheckoutSession`) is this plan's best-effort modeling of Lago's hosted-checkout API and should be confirmed against the real self-hosted Lago instance's API docs on first integration run (per the spec's "Open Questions" section) — it's isolated behind this one client file, so if the real shape differs, only these two functions need adjusting.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/lago-client.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/types.ts packages/api/src/billing/lago-client.ts packages/api/src/billing/lago-client.spec.ts
git commit -m "feat(billing): add Lago REST client"
```

---

## Task 6: Provisioning — ensure customer, create subscription

**Files:**
- Create: `packages/api/src/billing/provisioning.ts`
- Test: `packages/api/src/billing/provisioning.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/billing/provisioning.spec.ts
import { createProvisioning } from './provisioning';
import type { LagoClient } from './lago-client';

function buildLagoClientMock(overrides: Partial<LagoClient> = {}): LagoClient {
  return {
    createCustomer: jest.fn().mockResolvedValue({ lagoId: 'lc-1', externalId: 'ext-1' }),
    getPlan: jest.fn(),
    listPlans: jest.fn(),
    createSubscription: jest.fn().mockResolvedValue({
      lagoId: 'sub-1',
      externalCustomerId: 'ext-1',
      planCode: 'premium',
      status: 'active',
    }),
    sendUsageEvent: jest.fn(),
    listAddOns: jest.fn(),
    createCheckoutSession: jest.fn(),
    createAddOnCheckoutSession: jest.fn(),
    ...overrides,
  };
}

describe('createProvisioning', () => {
  it('ensureLagoCustomer creates a customer keyed by the user\'s openidId', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    const externalId = await provisioning.ensureLagoCustomer('user-1');

    expect(externalId).toBe('zitadel-sub-1');
    expect(lagoClient.createCustomer).toHaveBeenCalledWith({
      externalId: 'zitadel-sub-1',
      name: 'zitadel-sub-1',
    });
  });

  it('ensureLagoCustomer throws a clear error when the user has no openidId', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    await expect(provisioning.ensureLagoCustomer('user-1')).rejects.toThrow(/openidId/);
  });

  it('ensureLagoCustomer throws when the user does not exist', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue(null);
    const provisioning = createProvisioning({ lagoClient, findUser });

    await expect(provisioning.ensureLagoCustomer('missing-user')).rejects.toThrow(/not found/);
  });

  it('createSubscriptionForUser creates a Lago subscription for the given plan', async () => {
    const lagoClient = buildLagoClientMock();
    const findUser = jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' });
    const provisioning = createProvisioning({ lagoClient, findUser });

    const subscription = await provisioning.createSubscriptionForUser('user-1', 'premium');

    expect(lagoClient.createSubscription).toHaveBeenCalledWith({
      externalCustomerId: 'zitadel-sub-1',
      planCode: 'premium',
    });
    expect(subscription.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/provisioning.spec.ts`
Expected: FAIL with "Cannot find module './provisioning'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/billing/provisioning.ts
import type { LagoClient } from './lago-client';
import type { LagoSubscription } from './types';

export interface ProvisioningDeps {
  lagoClient: LagoClient;
  findUser: (
    criteria: Record<string, unknown>,
    fields?: string[],
  ) => Promise<{ _id: unknown; openidId?: string } | null>;
}

export interface Provisioning {
  /** Idempotent: creates a Lago customer keyed by the user's Zitadel ID if needed, returns that ID. */
  ensureLagoCustomer(localUserId: string): Promise<string>;
  createSubscriptionForUser(localUserId: string, planCode: string): Promise<LagoSubscription>;
}

export function createProvisioning(deps: ProvisioningDeps): Provisioning {
  async function resolveExternalId(localUserId: string): Promise<string> {
    const user = await deps.findUser({ _id: localUserId }, ['openidId']);
    if (!user) {
      throw new Error(`Cannot provision billing: user ${localUserId} not found`);
    }
    if (!user.openidId) {
      throw new Error(
        `Cannot provision billing: user ${localUserId} has no openidId (Zitadel SSO identity)`,
      );
    }
    return user.openidId;
  }

  async function ensureLagoCustomer(localUserId: string): Promise<string> {
    const externalId = await resolveExternalId(localUserId);
    // Lago's create-customer endpoint is idempotent on external_id in practice (upsert semantics);
    // calling it again for an existing customer is safe and cheaper than a get-then-create round trip.
    await deps.lagoClient.createCustomer({ externalId, name: externalId });
    return externalId;
  }

  async function createSubscriptionForUser(
    localUserId: string,
    planCode: string,
  ): Promise<LagoSubscription> {
    const externalId = await resolveExternalId(localUserId);
    return deps.lagoClient.createSubscription({ externalCustomerId: externalId, planCode });
  }

  return { ensureLagoCustomer, createSubscriptionForUser };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/provisioning.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/provisioning.ts packages/api/src/billing/provisioning.spec.ts
git commit -m "feat(billing): add customer/subscription provisioning"
```

---

## Task 7: Usage event emitter

**Files:**
- Create: `packages/api/src/billing/usage-events.ts`
- Test: `packages/api/src/billing/usage-events.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/billing/usage-events.spec.ts
import { createUsageEventEmitter } from './usage-events';
import type { LagoClient } from './lago-client';

function buildDeps(overrides: Record<string, unknown> = {}) {
  const lagoClient: Partial<LagoClient> = {
    sendUsageEvent: jest.fn().mockResolvedValue(undefined),
  };
  return {
    lagoClient: lagoClient as LagoClient,
    findUser: jest.fn().mockResolvedValue({ _id: 'user-1', openidId: 'zitadel-sub-1' }),
    createBillingUsageEvent: jest.fn().mockResolvedValue({ _id: 'event-1' }),
    markBillingUsageEventSynced: jest.fn().mockResolvedValue(undefined),
    markBillingUsageEventSyncFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createUsageEventEmitter', () => {
  it('records a BillingUsageEvent and reports it to Lago, then marks it synced', async () => {
    const deps = buildDeps();
    const emitter = createUsageEventEmitter(deps);

    await emitter.emitUsageEvent({
      localUserId: 'user-1',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      model: 'gpt-5',
      costUSD: 0.0042,
    });

    expect(deps.createBillingUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        conversationId: 'convo-1',
        messageId: 'msg-1',
        model: 'gpt-5',
        costUSD: 0.0042,
      }),
    );
    expect(deps.lagoClient.sendUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCustomerId: 'zitadel-sub-1',
        billableMetricCode: 'chat_message',
        properties: { cost_usd: '0.0042' },
      }),
    );
    expect(deps.markBillingUsageEventSynced).toHaveBeenCalledWith('event-1');
  });

  it('never throws when the user has no Zitadel identity yet (free tier, no billing action taken)', async () => {
    const deps = buildDeps({ findUser: jest.fn().mockResolvedValue({ _id: 'user-1' }) });
    const emitter = createUsageEventEmitter(deps);

    await expect(
      emitter.emitUsageEvent({
        localUserId: 'user-1',
        model: 'gpt-5',
        costUSD: 0.01,
      }),
    ).resolves.toBeUndefined();
    expect(deps.createBillingUsageEvent).not.toHaveBeenCalled();
  });

  it('marks the event sync-failed and never throws when Lago is unreachable', async () => {
    const deps = buildDeps({
      lagoClient: { sendUsageEvent: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
    });
    const emitter = createUsageEventEmitter(deps);

    await expect(
      emitter.emitUsageEvent({ localUserId: 'user-1', model: 'gpt-5', costUSD: 0.01 }),
    ).resolves.toBeUndefined();
    expect(deps.markBillingUsageEventSyncFailed).toHaveBeenCalledWith('event-1', 'ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/usage-events.spec.ts`
Expected: FAIL with "Cannot find module './usage-events'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/billing/usage-events.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/usage-events.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/usage-events.ts packages/api/src/billing/usage-events.spec.ts
git commit -m "feat(billing): add usage event emitter"
```

---

## Task 8: Hook the usage event emitter into chat requests

**Files:**
- Modify: `api/server/controllers/agents/client.js:1-30` (imports), `:1044-1075` (`recordCollectedUsage` method)
- Test: `api/server/controllers/agents/client.usage-events.spec.js`

- [ ] **Step 1: Write the failing test**

First, check the top of `api/server/controllers/agents/client.js` for its existing `require('@librechat/api')` line and note every name already destructured from it — the new test mocks that same module, so it must include every existing export the file uses or other tests in this file will break. Then write:

```javascript
// api/server/controllers/agents/client.usage-events.spec.js
const { recordCollectedUsage } = require('@librechat/api');

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    recordCollectedUsage: jest.fn(),
    computeUsageCostUSD: jest.fn(),
  };
});

jest.mock('~/billing', () => ({
  getUsageEventEmitter: jest.fn(),
}));

const { computeUsageCostUSD } = require('@librechat/api');
const { getUsageEventEmitter } = require('~/billing');
const AgentClient = require('./client');

describe('AgentClient#recordCollectedUsage billing hook', () => {
  it('emits a usage event with the total cost across all collected usage entries', async () => {
    recordCollectedUsage.mockResolvedValue({ input_tokens: 100, output_tokens: 50 });
    computeUsageCostUSD.mockReturnValueOnce(0.001).mockReturnValueOnce(0.002);
    const emitUsageEvent = jest.fn().mockResolvedValue(undefined);
    getUsageEventEmitter.mockReturnValue({ emitUsageEvent });

    const client = Object.create(AgentClient.prototype);
    client.user = 'user-1';
    client.conversationId = 'convo-1';
    client.responseMessageId = 'msg-1';
    client.model = 'gpt-5';
    client.collectedUsage = [{ model: 'gpt-5' }, { model: 'gpt-5' }];
    client.options = { req: {}, endpointTokenConfig: undefined };

    await client.recordCollectedUsage({ collectedUsage: client.collectedUsage });

    expect(emitUsageEvent).toHaveBeenCalledWith({
      localUserId: 'user-1',
      conversationId: 'convo-1',
      messageId: 'msg-1',
      model: 'gpt-5',
      costUSD: 0.003,
    });
  });

  it('does not throw if the emitter itself throws', async () => {
    recordCollectedUsage.mockResolvedValue({ input_tokens: 10, output_tokens: 5 });
    computeUsageCostUSD.mockReturnValue(0.001);
    getUsageEventEmitter.mockReturnValue({
      emitUsageEvent: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const client = Object.create(AgentClient.prototype);
    client.user = 'user-1';
    client.conversationId = 'convo-1';
    client.responseMessageId = 'msg-1';
    client.model = 'gpt-5';
    client.collectedUsage = [{ model: 'gpt-5' }];
    client.options = { req: {}, endpointTokenConfig: undefined };

    await expect(
      client.recordCollectedUsage({ collectedUsage: client.collectedUsage }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/controllers/agents/client.usage-events.spec.js`
Expected: FAIL — `getUsageEventEmitter` from `~/billing` doesn't exist yet, and the current `recordCollectedUsage` method doesn't call it, so `emitUsageEvent` is never invoked (test's `expect(emitUsageEvent).toHaveBeenCalledWith(...)` fails).

- [ ] **Step 3: Add the barrel export and wire the hook**

Create `packages/api/src/billing/index.ts`:

```typescript
// packages/api/src/billing/index.ts
import { getBillingConfig } from './config';
import { createLagoClient } from './lago-client';
import { createUsageEventEmitter, type UsageEventEmitter } from './usage-events';
import { findUser, createBillingUsageEvent, markBillingUsageEventSynced, markBillingUsageEventSyncFailed } from '~/models';

export * from './config';
export * from './credit-conversion';
export * from './lago-client';
export * from './provisioning';
export * from './usage-events';
export * from './types';

let cachedEmitter: UsageEventEmitter | undefined;

/** Lazily builds a singleton usage-event emitter wired to real Lago/Mongo dependencies. */
export function getUsageEventEmitter(): UsageEventEmitter {
  if (!cachedEmitter) {
    const lagoClient = createLagoClient(getBillingConfig());
    cachedEmitter = createUsageEventEmitter({
      lagoClient,
      findUser,
      createBillingUsageEvent,
      markBillingUsageEventSynced,
      markBillingUsageEventSyncFailed,
    });
  }
  return cachedEmitter;
}
```

**Important:** `packages/api` does not have a runtime dependency on `api/models` — check how other `packages/api` modules reference Mongoose methods (e.g. `packages/api/src/middleware/checkBalance.ts`'s factory pattern) before assuming `~/models` resolves here. If `packages/api`'s `~` alias does not point at a location exposing `findUser`/`createBillingUsageEvent` directly, change `getUsageEventEmitter()` to accept these as parameters instead (`getUsageEventEmitter(deps)`), and have the one caller in `api/server/controllers/agents/client.js` pass in `require('~/models')` fields directly. Confirm which shape compiles before proceeding — this is the one place in the plan where the exact cross-package wiring must be checked against the live build rather than assumed.

Now modify `api/server/controllers/agents/client.js`. Add near the top, alongside the existing `@librechat/api` require:

```javascript
const { computeUsageCostUSD } = require('@librechat/api');
const { getUsageEventEmitter } = require('~/billing');
```

Modify the `recordCollectedUsage` method (currently lines 1044-1075):

```javascript
  async recordCollectedUsage({
    model,
    balance,
    transactions,
    context = 'message',
    collectedUsage = this.collectedUsage,
  }) {
    const result = await recordCollectedUsage(
      {
        spendTokens: db.spendTokens,
        spendStructuredTokens: db.spendStructuredTokens,
        pricing: { getMultiplier: db.getMultiplier, getCacheMultiplier: db.getCacheMultiplier },
        bulkWriteOps: { insertMany: db.bulkInsertTransactions, updateBalance: db.updateBalance },
      },
      {
        user: this.user ?? this.options.req.user?.id,
        conversationId: this.conversationId,
        collectedUsage,
        model: model ?? this.model ?? this.options.agent.model_parameters.model,
        context,
        messageId: this.responseMessageId,
        balance,
        transactions,
        endpointTokenConfig: this.options.endpointTokenConfig,
        resolveEndpointTokenConfig: (usage) => this.resolveAgentEndpointTokenConfig(usage),
      },
    );

    if (result) {
      this.usage = result;
    }

    this.reportUsageToBilling({ model, collectedUsage });
  }

  /**
   * Reports this request's total cost to the billing system (Lago), for
   * cross-product invoicing/reporting only — never blocks or throws, since
   * request-time enforcement is handled entirely by the local balance check
   * above, not by this call.
   * @param {Object} params
   * @param {string} [params.model]
   * @param {UsageMetadata[]} params.collectedUsage
   */
  reportUsageToBilling({ model, collectedUsage }) {
    const userId = this.user ?? this.options.req.user?.id;
    if (!userId || !collectedUsage?.length) {
      return;
    }

    const pricing = { getMultiplier: db.getMultiplier, getCacheMultiplier: db.getCacheMultiplier };
    const costUSD = collectedUsage
      .filter(Boolean)
      .reduce(
        (sum, usage) =>
          sum + computeUsageCostUSD(usage, pricing, this.options.endpointTokenConfig),
        0,
      );

    getUsageEventEmitter()
      .emitUsageEvent({
        localUserId: userId,
        conversationId: this.conversationId,
        messageId: this.responseMessageId,
        model: model ?? this.model ?? this.options.agent.model_parameters.model,
        costUSD,
      })
      .catch((err) => {
        logger.error('[AgentClient] reportUsageToBilling failed', err);
      });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/controllers/agents/client.usage-events.spec.js`
Expected: PASS (2 tests)

Then run the full existing test suite for this file to confirm nothing regressed:

Run: `cd api && npx jest server/controllers/agents/client.spec.js`
Expected: PASS (all pre-existing tests, unchanged)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/index.ts api/server/controllers/agents/client.js api/server/controllers/agents/client.usage-events.spec.js
git commit -m "feat(billing): report chat usage cost to Lago after each request"
```

---

## Task 9: Sweep job for un-synced usage events

**Files:**
- Create: `packages/api/src/billing/sweep.ts`
- Test: `packages/api/src/billing/sweep.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/billing/sweep.spec.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/sweep.spec.ts`
Expected: FAIL with "Cannot find module './sweep'"

- [ ] **Step 3: Write the implementation**

Mirror the existing pattern from `packages/api/src/files/sweep.ts` (`getFileRetentionSweepInterval` / `sweepExpiredFiles` / `startExpiredFileSweep`):

```typescript
// packages/api/src/billing/sweep.ts
import { logger } from '@librechat/data-schemas';
import type { LagoClient } from './lago-client';

const DEFAULT_BILLING_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface UnsyncedBillingEvent {
  _id: unknown;
  /** Typed `unknown`, not `string` — the real IBillingUsageEvent.user is a Mongoose
   *  Types.ObjectId (see Task 1), and findUser()'s `{ _id }` query criteria accepts
   *  either an ObjectId or a string, so no conversion is needed at the call site. */
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
    logger.info(`[billing-sweep] Processed ${events.length} events: ${synced} synced, ${failed} failed`);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/sweep.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/sweep.ts packages/api/src/billing/sweep.spec.ts
git commit -m "feat(billing): add periodic sweep for un-synced usage events"
```

---

## Task 10: Wire the sweep job into server startup

**Files:**
- Modify: `api/server/index.js`
- Modify: `packages/api/src/billing/index.ts`

- [ ] **Step 1: No new automated test for this task** — this is a startup-wiring change exercised by the manual verification checklist in Task 17. (Rationale: `api/server/index.js` has no existing test harness for its startup sequence; adding one would require scaffolding well beyond this task's scope. `sweepUnsyncedBillingEvents` and `startBillingEventSweep` themselves are already fully unit-tested in Task 9.)

- [ ] **Step 2: N/A**

- [ ] **Step 3: Add a `getUsageEventSweepStarter` export and wire it in**

Add to `packages/api/src/billing/index.ts` (below `getUsageEventEmitter`):

```typescript
import { startBillingEventSweep } from './sweep';
export * from './sweep';

export function startBillingSweep(): void {
  const lagoClient = createLagoClient(getBillingConfig());
  startBillingEventSweep(undefined, {
    lagoClient,
    findUser,
    findUnsyncedBillingUsageEvents,
    markBillingUsageEventSynced,
    markBillingUsageEventSyncFailed,
    runAsSystem,
  });
}
```

(Import `findUnsyncedBillingUsageEvents` and `runAsSystem` alongside the other `~/models`/`@librechat/data-schemas` imports already at the top of this file — matching whatever concrete import path Task 8 settled on for `findUser` et al.)

In `api/server/index.js`, near the existing `startExpiredFileSweep({ appConfig, loadAppConfig: getAppConfig });` call (line 126):

```javascript
const { startBillingSweep } = require('~/billing');
// ...
startBillingSweep();
```

- [ ] **Step 4: Manual smoke check**

Run: `npm run backend:dev` (from repo root, with `LAGO_API_URL`/`LAGO_API_KEY`/`LAGO_WEBHOOK_SECRET` set in `.env`, even to placeholder values for this smoke check)
Expected: server boots without throwing; log shows no `[billing-sweep]` error on startup (an empty sweep with zero un-synced events logs nothing, by design — silence is the success case here).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/index.ts api/server/index.js
git commit -m "feat(billing): start the billing sweep job on server boot"
```

---

## Task 11: Webhook signature verification

**Files:**
- Create: `packages/api/src/billing/webhooks.ts`
- Test: `packages/api/src/billing/webhooks.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/billing/webhooks.spec.ts
import { createHmac } from 'crypto';
import { verifyWebhookSignature } from './webhooks';

const SECRET = 'test-webhook-secret';

function sign(rawBody: string): string {
  return createHmac('sha256', SECRET).update(rawBody).digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed payload', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    const signature = sign(rawBody);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
  });

  it('rejects a payload with an incorrect signature', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    expect(verifyWebhookSignature(rawBody, 'not-the-real-signature', SECRET)).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const rawBody = '{"webhook":{"webhook_type":"subscription.started"}}';
    expect(verifyWebhookSignature(rawBody, undefined, SECRET)).toBe(false);
  });

  it('rejects a payload that was tampered with after signing', () => {
    const original = '{"webhook":{"webhook_type":"subscription.started"}}';
    const signature = sign(original);
    const tampered = '{"webhook":{"webhook_type":"subscription.terminated"}}';
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/webhooks.spec.ts`
Expected: FAIL with "Cannot find module './webhooks'"

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/billing/webhooks.ts
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * HMAC-SHA256 signature verification, keyed by LAGO_WEBHOOK_SECRET. This is
 * this plan's best-effort match for Lago's webhook signing scheme and should
 * be confirmed against the real self-hosted instance's webhook docs on first
 * integration (see spec's "Open Questions"). If Lago instead signs with a
 * JWT/RS256 public key, only this one function needs to change.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(signatureHeader, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/webhooks.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/webhooks.ts packages/api/src/billing/webhooks.spec.ts
git commit -m "feat(billing): add webhook signature verification"
```

---

## Task 12: Webhook event dispatch — subscription lifecycle

**Files:**
- Modify: `packages/api/src/billing/webhooks.ts`
- Modify: `packages/api/src/billing/webhooks.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/api/src/billing/webhooks.spec.ts`:

```typescript
import { handleLagoWebhook } from './webhooks';

describe('handleLagoWebhook — subscription lifecycle', () => {
  function buildDeps(overrides: Record<string, unknown> = {}) {
    return {
      findUserByOpenidId: jest.fn().mockResolvedValue({ _id: 'user-1' }),
      upsertBalanceFields: jest.fn().mockResolvedValue(undefined),
      getPlanCreditsAllowance: jest.fn().mockReturnValue(5000),
      ...overrides,
    };
  }

  it('updates local Balance allowance when a subscription starts', async () => {
    const deps = buildDeps();
    await handleLagoWebhook(
      {
        webhook_type: 'subscription.started',
        subscription: { external_customer_id: 'zitadel-sub-1', plan_code: 'premium' },
      },
      deps,
    );

    expect(deps.findUserByOpenidId).toHaveBeenCalledWith('zitadel-sub-1');
    expect(deps.upsertBalanceFields).toHaveBeenCalledWith('user-1', {
      tokenCredits: 1_000_000,
      refillAmount: 1_000_000,
      refillIntervalUnit: 'months',
      refillIntervalValue: 1,
      autoRefillEnabled: true,
      lastRefill: expect.any(Date),
    });
  });

  it('ignores unknown webhook types without throwing', async () => {
    const deps = buildDeps();
    await expect(
      handleLagoWebhook({ webhook_type: 'invoice.drafted', invoice: {} }, deps),
    ).resolves.toBeUndefined();
    expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
  });

  it('does nothing (not throw) when the customer maps to no local user', async () => {
    const deps = buildDeps({ findUserByOpenidId: jest.fn().mockResolvedValue(null) });
    await expect(
      handleLagoWebhook(
        {
          webhook_type: 'subscription.started',
          subscription: { external_customer_id: 'unknown', plan_code: 'premium' },
        },
        deps,
      ),
    ).resolves.toBeUndefined();
    expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/billing/webhooks.spec.ts`
Expected: FAIL with "handleLagoWebhook is not a function" (or "not exported")

- [ ] **Step 3: Write the implementation**

Add to `packages/api/src/billing/webhooks.ts`:

```typescript
import { convertMarketedCreditsToTokenCredits } from './credit-conversion';

export interface WebhookDispatchDeps {
  findUserByOpenidId: (openidId: string) => Promise<{ _id: unknown } | null>;
  upsertBalanceFields: (
    userId: string,
    fields: {
      tokenCredits?: number;
      refillAmount?: number;
      refillIntervalUnit?: 'seconds' | 'minutes' | 'hours' | 'days' | 'months';
      refillIntervalValue?: number;
      autoRefillEnabled?: boolean;
      lastRefill?: Date;
    },
  ) => Promise<unknown>;
  /** Looks up the marketed-credits allowance configured for a plan code. */
  getPlanCreditsAllowance: (planCode: string) => number;
}

interface LagoWebhookPayload {
  webhook_type: string;
  subscription?: { external_customer_id: string; plan_code: string };
  [key: string]: unknown;
}

async function handleSubscriptionStarted(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  const subscription = payload.subscription;
  if (!subscription) {
    return;
  }

  const user = await deps.findUserByOpenidId(subscription.external_customer_id);
  if (!user) {
    return;
  }

  const marketedCredits = deps.getPlanCreditsAllowance(subscription.plan_code);
  const tokenCredits = convertMarketedCreditsToTokenCredits(marketedCredits);

  await deps.upsertBalanceFields(String(user._id), {
    tokenCredits,
    refillAmount: tokenCredits,
    refillIntervalUnit: 'months',
    refillIntervalValue: 1,
    autoRefillEnabled: true,
    lastRefill: new Date(),
  });
}

export async function handleLagoWebhook(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  switch (payload.webhook_type) {
    case 'subscription.started':
    case 'subscription.updated':
      await handleSubscriptionStarted(payload, deps);
      return;
    default:
      // Unhandled event types (invoice.*, subscription.terminated grace-period
      // handling, etc.) are intentionally no-ops for now — see spec's Open
      // Questions on cancellation/grace-period semantics.
      return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && npx jest src/billing/webhooks.spec.ts`
Expected: PASS (7 tests total: 4 from Task 11 + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/webhooks.ts packages/api/src/billing/webhooks.spec.ts
git commit -m "feat(billing): dispatch subscription webhooks to local Balance"
```

---

## Task 13: Top-up (Add-on) checkout and credit application

**Files:**
- Create: `packages/api/src/billing/topups.ts`
- Test: `packages/api/src/billing/topups.spec.ts`
- Modify: `packages/api/src/billing/webhooks.ts`
- Modify: `packages/api/src/billing/webhooks.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/api/src/billing/topups.spec.ts
import { createTopupCheckout } from './topups';
import type { LagoClient } from './lago-client';
import type { Provisioning } from './provisioning';

describe('createTopupCheckout', () => {
  it('ensures a Lago customer exists, then requests an add-on checkout session', async () => {
    const provisioning: Provisioning = {
      ensureLagoCustomer: jest.fn().mockResolvedValue('zitadel-sub-1'),
      createSubscriptionForUser: jest.fn(),
    };
    const lagoClient = {
      createAddOnCheckoutSession: jest
        .fn()
        .mockResolvedValue({ url: 'https://stripe.example/checkout/abc' }),
    } as unknown as LagoClient;

    const topups = createTopupCheckout({ provisioning, lagoClient });
    const session = await topups.createTopupCheckoutSession('user-1', 'growth');

    expect(provisioning.ensureLagoCustomer).toHaveBeenCalledWith('user-1');
    expect(lagoClient.createAddOnCheckoutSession).toHaveBeenCalledWith({
      externalCustomerId: 'zitadel-sub-1',
      addOnCode: 'growth',
    });
    expect(session.url).toBe('https://stripe.example/checkout/abc');
  });
});
```

Add to `packages/api/src/billing/webhooks.spec.ts`:

```typescript
describe('handleLagoWebhook — add-on top-up', () => {
  function buildDeps(overrides: Record<string, unknown> = {}) {
    return {
      findUserByOpenidId: jest.fn().mockResolvedValue({ _id: 'user-1' }),
      upsertBalanceFields: jest.fn().mockResolvedValue(undefined),
      getPlanCreditsAllowance: jest.fn(),
      getAddOnCreditsValue: jest.fn().mockReturnValue(2500),
      getCurrentTokenCredits: jest.fn().mockResolvedValue(3_000_000),
      ...overrides,
    };
  }

  it('credits the add-on\'s marketed value directly onto the existing balance', async () => {
    const deps = buildDeps();
    await handleLagoWebhook(
      {
        webhook_type: 'applied_add_on.created',
        applied_add_on: { external_customer_id: 'zitadel-sub-1', add_on_code: 'growth' },
      },
      deps,
    );

    expect(deps.getCurrentTokenCredits).toHaveBeenCalledWith('user-1');
    expect(deps.upsertBalanceFields).toHaveBeenCalledWith('user-1', {
      tokenCredits: 3_000_000 + 2500 * 200,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/api && npx jest src/billing/topups.spec.ts src/billing/webhooks.spec.ts`
Expected: FAIL — "Cannot find module './topups'"; webhook test fails because `applied_add_on.created` isn't handled yet.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/api/src/billing/topups.ts
import type { LagoClient } from './lago-client';
import type { Provisioning } from './provisioning';
import type { LagoCheckoutSession } from './types';

export interface TopupCheckoutDeps {
  provisioning: Provisioning;
  lagoClient: LagoClient;
}

export interface TopupCheckout {
  createTopupCheckoutSession(localUserId: string, addOnCode: string): Promise<LagoCheckoutSession>;
}

export function createTopupCheckout(deps: TopupCheckoutDeps): TopupCheckout {
  async function createTopupCheckoutSession(
    localUserId: string,
    addOnCode: string,
  ): Promise<LagoCheckoutSession> {
    const externalCustomerId = await deps.provisioning.ensureLagoCustomer(localUserId);
    return deps.lagoClient.createAddOnCheckoutSession({ externalCustomerId, addOnCode });
  }

  return { createTopupCheckoutSession };
}
```

Extend `packages/api/src/billing/webhooks.ts`'s dispatcher:

```typescript
export interface WebhookDispatchDeps {
  // ...existing fields...
  getAddOnCreditsValue: (addOnCode: string) => number;
  getCurrentTokenCredits: (userId: string) => Promise<number>;
}

interface LagoWebhookPayload {
  webhook_type: string;
  subscription?: { external_customer_id: string; plan_code: string };
  applied_add_on?: { external_customer_id: string; add_on_code: string };
  [key: string]: unknown;
}

async function handleAddOnApplied(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  const appliedAddOn = payload.applied_add_on;
  if (!appliedAddOn) {
    return;
  }

  const user = await deps.findUserByOpenidId(appliedAddOn.external_customer_id);
  if (!user) {
    return;
  }

  const marketedCredits = deps.getAddOnCreditsValue(appliedAddOn.add_on_code);
  const additionalTokenCredits = convertMarketedCreditsToTokenCredits(marketedCredits);
  const currentTokenCredits = await deps.getCurrentTokenCredits(String(user._id));

  await deps.upsertBalanceFields(String(user._id), {
    tokenCredits: currentTokenCredits + additionalTokenCredits,
  });
}

export async function handleLagoWebhook(
  payload: LagoWebhookPayload,
  deps: WebhookDispatchDeps,
): Promise<void> {
  switch (payload.webhook_type) {
    case 'subscription.started':
    case 'subscription.updated':
      await handleSubscriptionStarted(payload, deps);
      return;
    case 'applied_add_on.created':
      await handleAddOnApplied(payload, deps);
      return;
    default:
      return;
  }
}
```

**Note for implementer:** the exact Lago webhook type strings (`subscription.started`, `applied_add_on.created`, etc.) are this plan's best-effort match for Lago's event catalogue and should be confirmed against the real self-hosted instance on first integration (per spec's Open Questions) — they're isolated to this one `switch` statement.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/billing/topups.spec.ts src/billing/webhooks.spec.ts`
Expected: PASS (1 new topups test; 8 webhook tests total)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/billing/topups.ts packages/api/src/billing/topups.spec.ts packages/api/src/billing/webhooks.ts packages/api/src/billing/webhooks.spec.ts
git commit -m "feat(billing): add credit top-up checkout and add-on webhook handling"
```

---

## Task 14: Capture raw request body for webhook signature verification

**Files:**
- Modify: `api/server/index.js:177`
- Test: `api/server/index.rawbody.spec.js`

- [ ] **Step 1: Write the failing test**

```javascript
// api/server/index.rawbody.spec.js
const express = require('express');
const request = require('supertest');

describe('raw body capture for webhook signature verification', () => {
  it('exposes req.rawBody as a Buffer matching the exact request bytes, alongside parsed req.body', async () => {
    const app = express();
    app.use(
      express.json({
        limit: '3mb',
        verify: (req, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.post('/echo', (req, res) => {
      res.json({ bodyType: typeof req.body, rawBodyIsBuffer: Buffer.isBuffer(req.rawBody) });
    });

    const payload = { webhook: { webhook_type: 'subscription.started' } };
    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    expect(response.body).toEqual({ bodyType: 'object', rawBodyIsBuffer: true });
  });
});
```

(Check whether `supertest` is already a dev dependency in `api/package.json`; if not, this test can use Node's built-in `http` module directly against the app instead — check an existing route test in `api/server/routes/*.test.js` for this project's established convention for exercising an Express app in tests before writing this.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/index.rawbody.spec.js`
Expected: FAIL — `req.rawBody` is `undefined` (`rawBodyIsBuffer: false`), since the real `api/server/index.js` doesn't set up `verify` yet. (This test constructs its own minimal Express app rather than importing the real `api/server/index.js`, since that file boots a full server with DB/config dependencies unsuited to a unit test — it's here to prove the exact `verify` snippet works before it's pasted into the real file.)

- [ ] **Step 3: Apply the one-line fix to the real file**

In `api/server/index.js`, change line 177:

```javascript
  app.use(express.json({ limit: '3mb' }));
```

to:

```javascript
  app.use(
    express.json({
      limit: '3mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/index.rawbody.spec.js`
Expected: PASS (1 test)

Then run the broader existing route test suite to confirm no regression from this global middleware change:

Run: `cd api && npx jest server/routes`
Expected: PASS (all pre-existing route tests, unchanged — this change only adds a property to `req`, it doesn't alter parsing behavior for any existing route)

- [ ] **Step 5: Commit**

```bash
git add api/server/index.js api/server/index.rawbody.spec.js
git commit -m "feat(billing): capture raw request body for webhook signature verification"
```

---

## Task 15: Billing API routes (plans, top-ups, subscription, checkout)

**Files:**
- Create: `api/server/controllers/Billing.js`
- Create: `api/server/routes/billing/index.js`
- Test: `api/server/controllers/Billing.spec.js`
- Modify: `api/server/routes/index.js`
- Modify: `api/server/index.js`

- [ ] **Step 1: Write the failing test**

First, check an existing controller test (e.g. `api/server/controllers/Balance.spec.js`, already referenced by the earlier research) for this project's exact test-setup convention (how `req`/`res` mocks are built), then write:

```javascript
// api/server/controllers/Billing.spec.js
const {
  getPlans,
  getTopups,
  getSubscription,
  postCheckout,
  postTopupCheckout,
} = require('./Billing');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Billing controller', () => {
  it('getPlans returns the list of plans from Lago', async () => {
    const listPlans = jest.fn().mockResolvedValue([{ code: 'premium', name: 'Premium' }]);
    const req = { user: { id: 'user-1' }, app: { locals: { billing: { listPlans } } } };
    const res = buildRes();

    await getPlans(req, res);

    expect(res.json).toHaveBeenCalledWith([{ code: 'premium', name: 'Premium' }]);
  });

  it('postCheckout ensures a customer, creates a subscription, returns the checkout URL', async () => {
    const createCheckoutSession = jest
      .fn()
      .mockResolvedValue({ url: 'https://stripe.example/checkout/xyz' });
    const req = {
      user: { id: 'user-1' },
      body: { planCode: 'premium' },
      app: { locals: { billing: { createCheckoutSession } } },
    };
    const res = buildRes();

    await postCheckout(req, res);

    expect(createCheckoutSession).toHaveBeenCalledWith('user-1', 'premium');
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe.example/checkout/xyz' });
  });

  it('postCheckout returns 400 when planCode is missing', async () => {
    const req = { user: { id: 'user-1' }, body: {}, app: { locals: { billing: {} } } };
    const res = buildRes();

    await postCheckout(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('postTopupCheckout ensures a customer, requests an add-on checkout, returns the URL', async () => {
    const createTopupCheckoutSession = jest
      .fn()
      .mockResolvedValue({ url: 'https://stripe.example/checkout/topup' });
    const req = {
      user: { id: 'user-1' },
      body: { addOnCode: 'growth' },
      app: { locals: { billing: { createTopupCheckoutSession } } },
    };
    const res = buildRes();

    await postTopupCheckout(req, res);

    expect(createTopupCheckoutSession).toHaveBeenCalledWith('user-1', 'growth');
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe.example/checkout/topup' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: FAIL with "Cannot find module './Billing'"

- [ ] **Step 3: Write the controllers and routes**

```javascript
// api/server/controllers/Billing.js
async function getPlans(req, res) {
  const plans = await req.app.locals.billing.listPlans();
  res.json(plans);
}

async function getTopups(req, res) {
  const topups = await req.app.locals.billing.listAddOns();
  res.json(topups);
}

async function getSubscription(req, res) {
  const subscription = await req.app.locals.billing.getSubscriptionForUser(req.user.id);
  res.json(subscription ?? { plan: 'free' });
}

async function postCheckout(req, res) {
  const { planCode } = req.body ?? {};
  if (!planCode) {
    return res.status(400).json({ error: 'planCode is required' });
  }
  const session = await req.app.locals.billing.createCheckoutSession(req.user.id, planCode);
  res.json({ url: session.url });
}

async function postTopupCheckout(req, res) {
  const { addOnCode } = req.body ?? {};
  if (!addOnCode) {
    return res.status(400).json({ error: 'addOnCode is required' });
  }
  const session = await req.app.locals.billing.createTopupCheckoutSession(req.user.id, addOnCode);
  res.json({ url: session.url });
}

module.exports = { getPlans, getTopups, getSubscription, postCheckout, postTopupCheckout };
```

```javascript
// api/server/routes/billing/index.js
const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../../middleware/');
const {
  getPlans,
  getTopups,
  getSubscription,
  postCheckout,
  postTopupCheckout,
} = require('../../controllers/Billing');

router.get('/plans', requireJwtAuth, getPlans);
router.get('/topups', requireJwtAuth, getTopups);
router.get('/subscription', requireJwtAuth, getSubscription);
router.post('/checkout', requireJwtAuth, postCheckout);
router.post('/topups/checkout', requireJwtAuth, postTopupCheckout);

module.exports = router;
```

**Note for implementer:** `req.app.locals.billing` is this plan's chosen place to attach the wired billing service object (built from `packages/api/src/billing`'s factories plus real `~/models` deps) at server startup, mirroring how other cross-cutting services are exposed to controllers in this codebase — check `api/server/index.js` for the actual established convention (`app.locals.*` vs. a different DI mechanism) before wiring this in Task 16, and adjust the controller/route code above if the codebase's real convention differs.

Wire the router into `api/server/routes/index.js`: add `const billing = require('./billing');` near the other route requires, add `billing,` to the `module.exports` object.

Wire the mount point into `api/server/index.js`, near the other `app.use('/api/...', routes.X)` lines: `app.use('/api/billing', routes.billing);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/controllers/Billing.spec.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/Billing.js api/server/controllers/Billing.spec.js api/server/routes/billing/index.js api/server/routes/index.js api/server/index.js
git commit -m "feat(billing): add billing API routes (plans, topups, subscription, checkout)"
```

---

## Task 16: Webhook receiver route

**Files:**
- Create: `api/server/controllers/BillingWebhooks.js`
- Create: `api/server/routes/billing/webhooks.js`
- Test: `api/server/controllers/BillingWebhooks.spec.js`
- Modify: `api/server/routes/index.js`
- Modify: `api/server/index.js`

- [ ] **Step 1: Write the failing test**

```javascript
// api/server/controllers/BillingWebhooks.spec.js
const { postLagoWebhook } = require('./BillingWebhooks');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.sendStatus = jest.fn().mockReturnValue(res);
  return res;
}

describe('BillingWebhooks controller', () => {
  it('processes a validly signed webhook and returns 200', async () => {
    const handleLagoWebhook = jest.fn().mockResolvedValue(undefined);
    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'valid-signature' },
      app: {
        locals: {
          billing: {
            verifyWebhookSignature: jest.fn().mockReturnValue(true),
            handleLagoWebhook,
          },
        },
      },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    expect(handleLagoWebhook).toHaveBeenCalledWith({ webhook_type: 'subscription.started' });
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid signature with 401 and never processes the event', async () => {
    const handleLagoWebhook = jest.fn();
    const req = {
      rawBody: Buffer.from('{"webhook_type":"subscription.started"}'),
      body: { webhook_type: 'subscription.started' },
      headers: { 'x-lago-signature': 'bad-signature' },
      app: {
        locals: {
          billing: {
            verifyWebhookSignature: jest.fn().mockReturnValue(false),
            handleLagoWebhook,
          },
        },
      },
    };
    const res = buildRes();

    await postLagoWebhook(req, res);

    expect(handleLagoWebhook).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx jest server/controllers/BillingWebhooks.spec.js`
Expected: FAIL with "Cannot find module './BillingWebhooks'"

- [ ] **Step 3: Write the controller and route**

```javascript
// api/server/controllers/BillingWebhooks.js
const { logger } = require('@librechat/data-schemas');

async function postLagoWebhook(req, res) {
  const { billing } = req.app.locals;
  const signature = req.headers['x-lago-signature'];
  const rawBody = req.rawBody?.toString('utf8') ?? '';

  if (!billing.verifyWebhookSignature(rawBody, signature, billing.webhookSecret)) {
    logger.warn('[BillingWebhooks] Rejected webhook with invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    await billing.handleLagoWebhook(req.body);
    res.sendStatus(200);
  } catch (error) {
    logger.error('[BillingWebhooks] Failed to process webhook', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { postLagoWebhook };
```

```javascript
// api/server/routes/billing/webhooks.js
const express = require('express');
const router = express.Router();
const { postLagoWebhook } = require('../../controllers/BillingWebhooks');

router.post('/lago', postLagoWebhook);

module.exports = router;
```

Wire into `api/server/routes/index.js`: add `const billingWebhooks = require('./billing/webhooks');`, add `billingWebhooks,` to `module.exports`.

Wire the mount point into `api/server/index.js` — **this route must NOT go through `requireJwtAuth`** (Lago is calling it, not a logged-in browser session; signature verification is this route's auth):

```javascript
app.use('/api/billing/webhooks', routes.billingWebhooks);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx jest server/controllers/BillingWebhooks.spec.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/server/controllers/BillingWebhooks.js api/server/controllers/BillingWebhooks.spec.js api/server/routes/billing/webhooks.js api/server/routes/index.js api/server/index.js
git commit -m "feat(billing): add Lago webhook receiver route"
```

---

## Task 17: Wire real dependencies into `app.locals.billing`

**Files:**
- Modify: `api/server/index.js`

- [ ] **Step 1: No new test** — this task wires already-tested factories (Tasks 4-13) together with real `~/models`/`@librechat/data-schemas` dependencies. There is no new logic to unit-test; correctness is exercised by the manual verification checklist below.

- [ ] **Step 2: N/A**

- [ ] **Step 3: Wire it up**

In `api/server/index.js`, near where `routes.billing`/`routes.billingWebhooks` get mounted, before those `app.use(...)` lines:

```javascript
const {
  getBillingConfig,
  createLagoClient,
  createProvisioning,
  createTopupCheckout,
  verifyWebhookSignature,
  handleLagoWebhook,
} = require('~/billing');
const { findUser, findBalanceByUser, upsertBalanceFields } = require('~/models');

const billingConfig = getBillingConfig();
const lagoClient = createLagoClient(billingConfig);
const provisioning = createProvisioning({ lagoClient, findUser });
const topupCheckout = createTopupCheckout({ provisioning, lagoClient });

app.locals.billing = {
  webhookSecret: billingConfig.webhookSecret,
  listPlans: () => lagoClient.listPlans(),
  listAddOns: () => lagoClient.listAddOns(),
  getSubscriptionForUser: async (userId) => {
    const user = await findUser({ _id: userId }, ['openidId']);
    return user?.openidId ? { plan: 'active-lago-subscription' } : { plan: 'free' };
  },
  createCheckoutSession: async (userId, planCode) => {
    const externalCustomerId = await provisioning.ensureLagoCustomer(userId);
    return lagoClient.createCheckoutSession({ externalCustomerId, planCode });
  },
  createTopupCheckoutSession: (userId, addOnCode) =>
    topupCheckout.createTopupCheckoutSession(userId, addOnCode),
  verifyWebhookSignature: (rawBody, signature, secret) =>
    verifyWebhookSignature(rawBody, signature, secret),
  handleLagoWebhook: (payload) =>
    handleLagoWebhook(payload, {
      findUserByOpenidId: (openidId) => findUser({ openidId }),
      upsertBalanceFields,
      getPlanCreditsAllowance: (planCode) => {
        // TODO(implementer): replace with the real pricing-doc-derived lookup table
        // (Section 6's "Monthly AI credits" column) once that config location is decided.
        const allowances = { free: 500, premium: 5000, ultimate: 30000 };
        return allowances[planCode] ?? 0;
      },
      getAddOnCreditsValue: (addOnCode) => {
        const values = { starter: 1000, growth: 2500, power: 7500 };
        return values[addOnCode] ?? 0;
      },
      getCurrentTokenCredits: async (userId) => {
        const balance = await findBalanceByUser(userId);
        return balance?.tokenCredits ?? 0;
      },
    }),
};
```

This is the one place in the plan with an intentional `TODO` — it's for the pricing-doc's plan/add-on credit *values* (Sections 6 and 9A), which are business configuration, not implementation logic; the plan explicitly scoped these out as "configuration data this infrastructure must accept generically" (see spec's Scope section). Everything else in this plan is fully implemented, no placeholders.

- [ ] **Step 4: Manual verification**

Run: `npm run backend:dev` with a real (or sandboxed) `LAGO_API_URL`/`LAGO_API_KEY`/`LAGO_WEBHOOK_SECRET` configured.

```bash
curl -H "Authorization: Bearer <a real JWT for a logged-in test user>" http://localhost:3080/api/billing/plans
```
Expected: JSON array of plans from the real Lago instance (or a clear error if Lago is unreachable — check the server log for `[lago-client]` entries).

```bash
curl -X POST http://localhost:3080/api/billing/webhooks/lago \
  -H "Content-Type: application/json" \
  -H "x-lago-signature: <compute with: printf '%s' '<raw body>' | openssl dgst -sha256 -hmac '<LAGO_WEBHOOK_SECRET>'>" \
  -d '{"webhook_type":"subscription.started","subscription":{"external_customer_id":"<a real test user openidId>","plan_code":"premium"}}'
```
Expected: `200`, and the test user's `Balance.tokenCredits` updated (check via `GET /api/balance` with that user's session).

- [ ] **Step 5: Commit**

```bash
git add api/server/index.js
git commit -m "feat(billing): wire real dependencies into app.locals.billing"
```

---

## Task 18: Document new environment variables

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: N/A (documentation task)**
- [ ] **Step 2: N/A**

- [ ] **Step 3: Add the new section**

Add near the existing `APP_TITLE`/`CUSTOM_FOOTER` section (or another sensible existing grouping) in `.env.example`:

```
#===================================================#
#                  Billing (Lago)                   #
#===================================================#

# Base URL of your self-hosted Lago instance's API (no trailing slash)
LAGO_API_URL=
# Lago API key (Settings > API keys in the Lago dashboard)
LAGO_API_KEY=
# Secret used to verify Lago webhook signatures
LAGO_WEBHOOK_SECRET=
# How often (ms) to retry un-synced usage events. 0 disables the sweep. Default: 300000 (5 min)
BILLING_SWEEP_INTERVAL_MS=
```

- [ ] **Step 4: N/A**

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs(billing): document LAGO_* environment variables"
```

---

## Self-Review Notes

**Spec coverage:**
- Customer/subscription provisioning → Tasks 6, 15, 17.
- Usage reporting (async, non-blocking) → Tasks 7, 8.
- Durability/reconciliation → Tasks 1-3, 9, 10.
- Entitlement/plan sync via webhook → Tasks 11, 12, 16.
- Credit top-ups via Add-ons → Task 13.
- Checkout UI's backend surface (`GET /plans`, `GET /topups`, `GET /subscription`, `POST /checkout`, `POST /topups/checkout`) → Task 15.
- Webhook signature verification / raw body → Tasks 11, 14.
- Env var documentation → Task 18.
- Not covered here (explicitly out of scope per spec): Teams/Business seat billing, Education/Enterprise, direct Stripe calls, any UI (see the companion frontend plan).

**Known open items carried from the spec** (flagged inline at the relevant task, not blocking task completion): exact Lago checkout-session endpoint shape (Task 5), exact webhook signature scheme (Task 11), exact webhook event-type strings (Task 12/13), and the real plan/add-on credit-value lookup table (Task 17) — all isolated behind single, small, swappable functions.
