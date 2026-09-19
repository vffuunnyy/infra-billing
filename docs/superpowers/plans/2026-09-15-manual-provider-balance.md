# Manual Provider Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner keep a prepaid balance by hand for `manual` providers (and connectors without a balance API), and have the panel drain it by hourly/daily service cost on every autosync tick so the existing runway / coverage / alert logic works for them.

**Architecture:** One new boolean `Provider.manualBalance`; the existing `balance` / `balanceCurrency` / `balanceSyncedAt` columns are reused. A pure `accrueDebit()` helper computes the time-proportional debit; `BalanceAccrualService` applies it after each sync run and writes a snapshot. Sync skips the balance write for such providers; owner-entered payments adjust the balance. Analytics needs no change.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), zod schemas in `packages/shared`, decimal.js, React 19 + react-hook-form + shadcn/ui, i18next. Backend tests: `node:test` against the compiled `dist/`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-manual-provider-balance-design.md`.
- **No git commits and no pushes.** The owner commits themselves. Plan steps never run `git commit`.
- Comments only for non-obvious constraints; never comment what the code says.
- Money is a decimal string `^-?\d+(\.\d{1,2})?$` on the wire; `Decimal` (decimal.js) in code; `Prisma.Decimal` from the DB → `new Decimal(x.toString())`.
- Backend test cycle from repo root: `npm run build:shared && npm run build:backend && node --test apps/backend/test/<file>.test.js`. Full suite: `npm test`.
- Lint/format: `npm run check` (biome) and `npm run typecheck` at repo root must pass at the end of every task.
- Path aliases in backend: `@common/*`, `@repositories/*`, `@connectors/*`, `@generated/*`. Feature modules import each other by relative path (`../currency/currency.module`).
- `RepositoriesModule` is `@Global()`: repositories are injectable everywhere without imports. `CurrencyService` is NOT global: a module that needs it imports `CurrencyModule`.
- Prisma client regenerates with `npm run prisma:generate` (needed after the schema change, before the backend compiles). Migrations are hand-written SQL in `apps/backend/prisma/migrations/<timestamp>_<name>/migration.sql`; apply locally with `npm run prisma:deploy` (needs the compose DB running).
- `PROVIDER_KINDS_WITHOUT_BALANCE_API = ['hetzner','hostkey','netcup','stormwall','spaceship','beget','cloudflare','yandex']` (verbatim from the spec).

---

## File map

| File | Responsibility |
|---|---|
| `apps/backend/prisma/schema/provider.prisma` | `manualBalance` column |
| `apps/backend/prisma/migrations/20260915120000_provider_manual_balance/migration.sql` | DDL |
| `packages/shared/src/enums.ts` | kinds list + `providerKindAllowsManualBalance` |
| `packages/shared/src/schemas/provider.ts` | `manualBalance`, `balance`, `balanceCurrency` on DTOs |
| `apps/backend/src/common/mappers.ts` | expose `manualBalance` |
| `apps/backend/src/common/accrual.ts` (new) | pure `accrueDebit()` |
| `apps/backend/src/repositories/providers/providers.repository.ts` | `setBalance()` (no `balanceSyncedAt` touch), `findCredentials` select |
| `apps/backend/src/repositories/payments/payments.repository.ts` | `findByUuid()` |
| `apps/backend/src/providers/providers.service.ts` | validation, balance write, snapshot, clear |
| `apps/backend/src/sync/balance-accrual.service.ts` (new) | `accrueAll()` |
| `apps/backend/src/sync/sync.service.ts` | skip balance write; call accrual |
| `apps/backend/src/sync/sync.module.ts` | register accrual, import `CurrencyModule` |
| `apps/backend/src/payments/payments.service.ts` + `payments.module.ts` | payment → balance adjustment |
| `apps/backend/test/accrual.test.js`, `balance-accrual-service.test.js`, `providers-service.test.js`, `payments-service.test.js`, `sync-service-manual-balance.test.js` | tests |
| `apps/frontend/src/pages/providers/providerForm.ts`, `ProviderFormFields.tsx`, `ProvidersPage.tsx`, `ProviderDetailModal.tsx` | form + payload + detail hint |
| `apps/frontend/src/i18n/locales/providers.ts` | en + ru strings |

---

### Task 1: Schema, migration, shared schemas, mapper

**Files:**
- Modify: `apps/backend/prisma/schema/provider.prisma:14`
- Create: `apps/backend/prisma/migrations/20260915120000_provider_manual_balance/migration.sql`
- Modify: `packages/shared/src/enums.ts:47-55`
- Modify: `packages/shared/src/schemas/provider.ts:23-26, 88-106`
- Modify: `apps/backend/src/common/mappers.ts:28-31`

**Interfaces:**
- Produces: `Provider.manualBalance: boolean` (Prisma + DTO); `CreateProvider`/`UpdateProvider` gain `manualBalance?: boolean`, `balance?: string`, `balanceCurrency?: string`; `PROVIDER_KINDS_WITHOUT_BALANCE_API`, `providerKindAllowsManualBalance(kind: string): boolean` exported from `@infra/shared`.

- [ ] **Step 1: Add the Prisma column**

In `apps/backend/prisma/schema/provider.prisma`, after the `isPostpaid` line:

```prisma
  isPostpaid      Boolean   @default(false) @map("is_postpaid")
  manualBalance   Boolean   @default(false) @map("manual_balance")
```

- [ ] **Step 2: Write the migration**

Create `apps/backend/prisma/migrations/20260915120000_provider_manual_balance/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "manual_balance" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Shared enums**

In `packages/shared/src/enums.ts`, right after the `providerKindSupportsPaymentImport` function:

```ts
/**
 * Connector kinds whose `fetchAccount` can return `balance: null` (no balance API, or one that
 * needs an optional credential). Together with `manual` these may keep a balance by hand.
 */
export const PROVIDER_KINDS_WITHOUT_BALANCE_API = [
  'hetzner',
  'hostkey',
  'netcup',
  'stormwall',
  'spaceship',
  'beget',
  'cloudflare',
  'yandex',
] as const satisfies readonly ProviderKind[];

const manualBalanceKindSet = new Set<string>(['manual', ...PROVIDER_KINDS_WITHOUT_BALANCE_API]);

/** Whether a provider of this kind may keep a hand-maintained, panel-debited balance. */
export function providerKindAllowsManualBalance(kind: string): boolean {
  return manualBalanceKindSet.has(kind);
}
```

- [ ] **Step 4: Shared provider schemas**

In `packages/shared/src/schemas/provider.ts`, in `providerSchema` after `isPostpaid`:

```ts
  // Balance kept by the owner and drained by the panel (hourly/daily services, journal payments).
  manualBalance: z.boolean().describe('Hand-maintained balance'),
```

In `createProviderSchema` after `isPostpaid`:

```ts
  manualBalance: z.boolean().describe('Hand-maintained balance').optional(),
  balance: moneySchema.describe('Starting balance').optional(),
  balanceCurrency: currencySchema.describe('Balance currency').optional(),
```

In `updateProviderSchema` after `isPostpaid`:

```ts
  manualBalance: z.boolean().describe('Hand-maintained balance').optional(),
  balance: moneySchema.describe('Balance as of now').optional(),
  balanceCurrency: currencySchema.describe('Balance currency').optional(),
```

- [ ] **Step 5: Mapper**

In `apps/backend/src/common/mappers.ts` `mapProvider`, after `isPostpaid: p.isPostpaid,`:

```ts
    manualBalance: p.manualBalance,
```

- [ ] **Step 6: Regenerate and build**

Run:
```bash
npm run prisma:generate && npm run build:shared && npm run typecheck
```
Expected: no errors. (If `typecheck` complains about `manualBalance` missing in a test fixture or mapper, that is the only expected kind of failure at this point; fix by adding the field.)

- [ ] **Step 7: Apply the migration locally (DB must be up)**

Run:
```bash
npm run prisma:deploy
```
Expected: `1 migration found ... Applying migration 20260915120000_provider_manual_balance`. If the DB is not running, note it and continue; the rest of the plan does not need it.

---

### Task 2: Pure accrual helper

**Files:**
- Create: `apps/backend/src/common/accrual.ts`
- Test: `apps/backend/test/accrual.test.js`

**Interfaces:**
- Produces:
  ```ts
  export interface AccrualServiceRow { cost: Decimal.Value; currency: string; period: string; isActive: boolean; createdAt: Date }
  export type ConvertFn = (amount: Decimal, from: string, to: string) => Decimal;
  export function accrueDebit(services: AccrualServiceRow[], from: Date, now: Date, toCurrency: string, convert: ConvertFn): Decimal
  ```

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/test/accrual.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { accrueDebit } = require('../dist/common/accrual');

const T0 = new Date('2026-09-01T00:00:00Z');
const hoursLater = (h) => new Date(T0.getTime() + h * 3_600_000);
const identity = (amount) => amount;

const row = (overrides) => ({
  cost: '1.00',
  currency: 'USD',
  period: 'hourly',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

test('hourly service: cost × elapsed hours', () => {
  const debit = accrueDebit([row({ cost: '0.50' })], T0, hoursLater(6), 'USD', identity);
  assert.equal(debit.toFixed(2), '3.00');
});

test('daily service: cost × elapsed hours / 24', () => {
  const debit = accrueDebit([row({ cost: '24.00', period: 'daily' })], T0, hoursLater(6), 'USD', identity);
  assert.equal(debit.toFixed(2), '6.00');
});

test('service created after `from` is charged only from its createdAt', () => {
  const debit = accrueDebit(
    [row({ cost: '1.00', createdAt: hoursLater(4) })],
    T0,
    hoursLater(6),
    'USD',
    identity,
  );
  assert.equal(debit.toFixed(2), '2.00');
});

test('service created after `now` contributes nothing', () => {
  const debit = accrueDebit([row({ createdAt: hoursLater(10) })], T0, hoursLater(6), 'USD', identity);
  assert.equal(debit.toFixed(2), '0.00');
});

test('inactive and non-metered services are ignored', () => {
  const debit = accrueDebit(
    [row({ isActive: false }), row({ period: 'monthly' }), row({ period: 'onetime' })],
    T0,
    hoursLater(6),
    'USD',
    identity,
  );
  assert.equal(debit.toFixed(2), '0.00');
});

test('each term is converted into the balance currency', () => {
  const convert = (amount, from, to) => (from === 'EUR' && to === 'USD' ? amount.mul(2) : amount);
  const debit = accrueDebit(
    [row({ cost: '1.00', currency: 'EUR' }), row({ cost: '1.00', currency: 'USD' })],
    T0,
    hoursLater(1),
    'USD',
    convert,
  );
  assert.equal(debit.toFixed(2), '3.00');
});

test('no services → zero', () => {
  assert.equal(accrueDebit([], T0, hoursLater(6), 'USD', identity).toFixed(2), '0.00');
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npm run build:backend && node --test apps/backend/test/accrual.test.js
```
Expected: FAIL with `Cannot find module '../dist/common/accrual'`.

- [ ] **Step 3: Implement**

Create `apps/backend/src/common/accrual.ts`:

```ts
import Decimal from 'decimal.js';
import type { Period } from '@infra/shared';
import { isMeteredPeriod } from './money';

const MS_PER_HOUR = 3_600_000;

export interface AccrualServiceRow {
  cost: Decimal.Value;
  currency: string;
  period: string;
  isActive: boolean;
  createdAt: Date;
}

export type ConvertFn = (amount: Decimal, from: string, to: string) => Decimal;

/**
 * Time-proportional debit of a hand-maintained balance by its metered services between `from`
 * (the last accrual) and `now`. A service created inside the window is charged from its
 * createdAt, never for time before it existed.
 */
export function accrueDebit(
  services: AccrualServiceRow[],
  from: Date,
  now: Date,
  toCurrency: string,
  convert: ConvertFn,
): Decimal {
  let debit = new Decimal(0);
  for (const s of services) {
    if (!s.isActive || !isMeteredPeriod(s.period as Period)) continue;
    const start = Math.max(from.getTime(), s.createdAt.getTime());
    const hours = (now.getTime() - start) / MS_PER_HOUR;
    if (hours <= 0) continue;
    // `.toString()`: Prisma.Decimal comes from its own decimal.js copy (same idiom as analytics).
    const cost = new Decimal(s.cost.toString());
    const perHour = s.period === 'daily' ? cost.div(24) : cost;
    debit = debit.add(convert(perHour.mul(hours), s.currency, toCurrency));
  }
  return debit;
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
npm run build:backend && node --test apps/backend/test/accrual.test.js
```
Expected: `# pass 7`, `# fail 0`.

---

### Task 3: BalanceAccrualService + wiring into sync

**Files:**
- Create: `apps/backend/src/sync/balance-accrual.service.ts`
- Modify: `apps/backend/src/sync/sync.module.ts`
- Modify: `apps/backend/src/sync/sync.service.ts:40-51, 86-104, 150-156`
- Test: `apps/backend/test/balance-accrual-service.test.js`, `apps/backend/test/sync-service-manual-balance.test.js`

**Interfaces:**
- Consumes: `accrueDebit` (Task 2); `ProvidersRepository.listAll()`, `updateBalance(uuid, balance, currency)`; `ServicesRepository.listActive()`; `BalanceSnapshotsRepository.record(uuid, balance, currency)`; `CurrencyService.getRubRates()`, `convert(amount, from, to, rates)`.
- Produces: `BalanceAccrualService.accrueAll(now?: Date): Promise<void>`; `SyncService` constructor gains an 11th parameter `accrual: BalanceAccrualService`.

- [ ] **Step 1: Write the failing accrual-service test**

Create `apps/backend/test/balance-accrual-service.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { BalanceAccrualService } = require('../dist/sync/balance-accrual.service');

const T0 = new Date('2026-09-01T00:00:00Z');
const hoursLater = (h) => new Date(T0.getTime() + h * 3_600_000);

const provider = (uuid, overrides = {}) => ({
  uuid,
  name: uuid,
  kind: 'manual',
  manualBalance: true,
  balance: new Decimal('10.00'),
  balanceCurrency: 'USD',
  balanceSyncedAt: T0,
  isPostpaid: false,
  ...overrides,
});

const service = (providerUuid, overrides = {}) => ({
  uuid: `${providerUuid}-svc`,
  providerUuid,
  cost: new Decimal('1.00'),
  currency: 'USD',
  period: 'hourly',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

function makeService({ providers, services, failUpdateFor = null }) {
  const balanceWrites = [];
  const snapshots = [];
  const providersRepo = {
    listAll: async () => providers,
    updateBalance: async (uuid, balance, currency) => {
      if (uuid === failUpdateFor) throw new Error('boom');
      balanceWrites.push({ uuid, balance, currency });
    },
  };
  const servicesRepo = { listActive: async () => services };
  const snapshotsRepo = {
    record: async (uuid, balance, currency) => snapshots.push({ uuid, balance, currency }),
  };
  const currency = {
    getRubRates: async () => new Map(),
    convert: (amount) => amount,
  };
  return {
    accrual: new BalanceAccrualService(providersRepo, servicesRepo, snapshotsRepo, currency),
    balanceWrites,
    snapshots,
  };
}

test('debits the balance by elapsed hourly cost and records a snapshot', async () => {
  const { accrual, balanceWrites, snapshots } = makeService({
    providers: [provider('p1')],
    services: [service('p1', { cost: new Decimal('0.50') })],
  });
  await accrual.accrueAll(hoursLater(4));
  assert.deepEqual(balanceWrites, [{ uuid: 'p1', balance: '8.00', currency: 'USD' }]);
  assert.deepEqual(snapshots, [{ uuid: 'p1', balance: '8.00', currency: 'USD' }]);
});

test('zero debit still writes (advances balanceSyncedAt) and snapshots', async () => {
  const { accrual, balanceWrites, snapshots } = makeService({
    providers: [provider('p1')],
    services: [service('p1', { period: 'monthly' })],
  });
  await accrual.accrueAll(hoursLater(4));
  assert.deepEqual(balanceWrites, [{ uuid: 'p1', balance: '10.00', currency: 'USD' }]);
  assert.equal(snapshots.length, 1);
});

test('skips providers without the flag, without a balance, or without a currency', async () => {
  const { accrual, balanceWrites } = makeService({
    providers: [
      provider('api', { manualBalance: false }),
      provider('nobal', { balance: null }),
      provider('noccy', { balanceCurrency: null }),
    ],
    services: [service('api'), service('nobal'), service('noccy')],
  });
  await accrual.accrueAll(hoursLater(4));
  assert.deepEqual(balanceWrites, []);
});

test('balance may go negative', async () => {
  const { accrual, balanceWrites } = makeService({
    providers: [provider('p1', { balance: new Decimal('1.00') })],
    services: [service('p1')],
  });
  await accrual.accrueAll(hoursLater(4));
  assert.equal(balanceWrites[0].balance, '-3.00');
});

test('one provider failing does not stop the others', async () => {
  const { accrual, balanceWrites } = makeService({
    providers: [provider('bad'), provider('good')],
    services: [service('bad'), service('good')],
    failUpdateFor: 'bad',
  });
  await accrual.accrueAll(hoursLater(1));
  assert.deepEqual(balanceWrites, [{ uuid: 'good', balance: '9.00', currency: 'USD' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npm run build:backend && node --test apps/backend/test/balance-accrual-service.test.js
```
Expected: FAIL with `Cannot find module '../dist/sync/balance-accrual.service'`.

- [ ] **Step 3: Implement the service**

Create `apps/backend/src/sync/balance-accrual.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BalanceSnapshotsRepository } from '@repositories/balance-snapshots/balance-snapshots.repository';
import { ProvidersRepository } from '@repositories/providers/providers.repository';
import { ServicesRepository } from '@repositories/services/services.repository';
import { accrueDebit } from '@common/accrual';
import { CurrencyService } from '../currency/currency.service';

/**
 * Drains hand-maintained balances by their metered services. Runs after every sync pass so the
 * cadence follows the autosync interval; the debit is proportional to elapsed time, so a missed
 * or late tick never skips or doubles a charge.
 */
@Injectable()
export class BalanceAccrualService {
  private readonly logger = new Logger(BalanceAccrualService.name);

  constructor(
    private readonly providers: ProvidersRepository,
    private readonly services: ServicesRepository,
    private readonly snapshots: BalanceSnapshotsRepository,
    private readonly currency: CurrencyService,
  ) {}

  async accrueAll(now = new Date()): Promise<void> {
    const providers = (await this.providers.listAll()).filter(
      (p) => p.manualBalance && p.balance != null && p.balanceCurrency,
    );
    if (providers.length === 0) return;
    const [services, rates] = await Promise.all([
      this.services.listActive(),
      this.currency.getRubRates(),
    ]);
    const convert = (amount: Decimal, from: string, to: string) =>
      this.currency.convert(amount, from, to, rates);

    for (const p of providers) {
      const currency = p.balanceCurrency as string;
      try {
        const debit = accrueDebit(
          services.filter((s) => s.providerUuid === p.uuid),
          p.balanceSyncedAt ?? now,
          now,
          currency,
          convert,
        );
        const balance = new Decimal(p.balance!.toString()).sub(debit).toFixed(2);
        await this.providers.updateBalance(p.uuid, balance, currency);
        await this.snapshots.record(p.uuid, balance, currency);
      } catch (e) {
        this.logger.error(
          `Balance accrual "${p.name}" (${p.uuid}) failed`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
npm run build:backend && node --test apps/backend/test/balance-accrual-service.test.js
```
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Write the failing sync test**

Create `apps/backend/test/sync-service-manual-balance.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { SyncService } = require('../dist/sync/sync.service');

function makeSync({ manualBalance }) {
  const balanceWrites = [];
  const snapshots = [];
  const accrualCalls = [];
  const provider = {
    uuid: 'p1',
    name: 'Hetz',
    kind: 'hetzner',
    manualBalance,
    credentialsEnc: new Uint8Array([1]),
    faviconLink: null,
  };
  const providersRepo = {
    findByUuid: async () => provider,
    listSyncable: async () => [{ uuid: 'p1', name: 'Hetz' }],
    updateBalance: async (uuid, balance, currency) => balanceWrites.push({ uuid, balance, currency }),
    updateFaviconLink: async () => {},
    markSynced: async () => {},
    recordSyncError: async () => {},
  };
  const servicesRepo = {
    findByExternalId: async () => null,
    create: async () => {},
    update: async () => {},
    deactivateMissing: async () => {},
    listExternalIds: async () => [],
  };
  const paymentsRepo = { upsertExternal: async () => {} };
  const snapshotsRepo = { record: async (uuid, balance, currency) => snapshots.push({ uuid, balance, currency }) };
  const run = { id: 1n, providerUuid: 'p1', status: 'running', startedAt: new Date(), finishedAt: null, servicesFound: 0, error: null };
  const syncRuns = {
    createRunning: async () => run,
    markOk: async () => ({ ...run, status: 'ok' }),
    markError: async (_id, error) => ({ ...run, status: 'error', error }),
  };
  const settings = { find: async () => ({ syncIntervalHours: 6 }) };
  const crypto = { decrypt: () => 'token' };
  const favicons = { invalidateProvider: () => {} };
  const connectors = {
    create: () => ({
      fetchAccount: async () => ({ balance: new Decimal('42.00'), currency: 'EUR' }),
      fetchServices: async () => [],
    }),
  };
  const scheduler = { addInterval: () => {}, deleteInterval: () => {} };
  const accrual = { accrueAll: async () => accrualCalls.push(1) };
  const sync = new SyncService(
    providersRepo,
    servicesRepo,
    paymentsRepo,
    snapshotsRepo,
    syncRuns,
    settings,
    crypto,
    favicons,
    connectors,
    scheduler,
    accrual,
  );
  return { sync, balanceWrites, snapshots, accrualCalls };
}

test('syncProvider writes the API balance for a normal provider', async () => {
  const { sync, balanceWrites, snapshots } = makeSync({ manualBalance: false });
  const run = await sync.syncProvider('p1');
  assert.equal(run.status, 'ok');
  assert.deepEqual(balanceWrites, [{ uuid: 'p1', balance: '42.00', currency: 'EUR' }]);
  assert.equal(snapshots.length, 1);
});

test('syncProvider leaves a hand-maintained balance alone', async () => {
  const { sync, balanceWrites, snapshots } = makeSync({ manualBalance: true });
  const run = await sync.syncProvider('p1');
  assert.equal(run.status, 'ok');
  assert.deepEqual(balanceWrites, []);
  assert.deepEqual(snapshots, []);
});

test('syncAllProviders and syncAll run the accrual after the API sync', async () => {
  const a = makeSync({ manualBalance: false });
  await a.sync.syncAllProviders();
  assert.equal(a.accrualCalls.length, 1);
  const b = makeSync({ manualBalance: false });
  const res = await b.sync.syncAll();
  assert.equal(res.ok, 1);
  assert.equal(b.accrualCalls.length, 1);
});
```

- [ ] **Step 6: Run to verify it fails**

Run:
```bash
npm run build:backend && node --test apps/backend/test/sync-service-manual-balance.test.js
```
Expected: the second and third tests FAIL (balance is written for the manual-balance provider; `accrueAll` never called).

- [ ] **Step 7: Wire the accrual into SyncService**

In `apps/backend/src/sync/sync.service.ts`:

Add the import after the `mapSyncRun` import:
```ts
import { BalanceAccrualService } from './balance-accrual.service';
```

Add the constructor parameter after `scheduler`:
```ts
    private readonly scheduler: SchedulerRegistry,
    private readonly accrual: BalanceAccrualService,
  ) {}
```

Replace `syncAllProviders` and `syncAll`:
```ts
  /** Sync every non-manual provider (failures isolated), then drain hand-maintained balances. */
  async syncAllProviders(): Promise<void> {
    const providers = await this.providers.listSyncable();
    for (const p of providers) {
      try {
        await this.syncProvider(p.uuid);
      } catch (e) {
        this.logger.error(
          `Sync "${p.name}" (${p.uuid}) failed`,
          e instanceof Error ? e.stack : String(e),
        );
      }
    }
    await this.accrual.accrueAll();
  }

  /** Manually sync every non-manual provider in parallel; returns a summary for the UI. */
  async syncAll(): Promise<{ total: number; ok: number; failed: number }> {
    const providers = await this.providers.listSyncable();
    const results = await Promise.allSettled(providers.map((p) => this.syncProvider(p.uuid)));
    await this.accrual.accrueAll();
    let ok = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 'ok') ok += 1;
      else failed += 1;
    }
    return { total: providers.length, ok, failed };
  }
```

Replace the balance block inside `syncProvider`:
```ts
      // Some providers (e.g. Hetzner) expose no account balance → skip balance/snapshot. A
      // hand-maintained balance is owned by the accrual, not the connector.
      if (account.balance !== null && !provider.manualBalance) {
        const balance = account.balance.toFixed(2);
        await this.providers.updateBalance(uuid, balance, account.currency);
        await this.snapshots.record(uuid, balance, account.currency);
      }
```

- [ ] **Step 8: Register in the module**

Replace `apps/backend/src/sync/sync.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConnectorsModule } from '@connectors/connectors.module';
import { CurrencyModule } from '../currency/currency.module';
import { BalanceAccrualService } from './balance-accrual.service';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [ConnectorsModule, CurrencyModule],
  controllers: [SyncController],
  providers: [SyncService, BalanceAccrualService],
  exports: [SyncService],
})
export class SyncModule {}
```

- [ ] **Step 9: Run to verify it passes**

Run:
```bash
npm run build:backend && node --test apps/backend/test/sync-service-manual-balance.test.js apps/backend/test/balance-accrual-service.test.js
```
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 10: Check the whole backend**

Run:
```bash
npm run typecheck && npm run check && npm test
```
Expected: all pass. If `npm run check` flags import ordering, run `npm run check:fix`.

---

### Task 4: ProvidersService — validation, balance write, snapshot, clear

**Files:**
- Modify: `apps/backend/src/repositories/providers/providers.repository.ts:37-42, 65-70`
- Modify: `apps/backend/src/providers/providers.service.ts:1-36, 248-278`
- Test: `apps/backend/test/providers-service.test.js`

**Interfaces:**
- Consumes: `providerKindAllowsManualBalance` (Task 1); `BalanceSnapshotsRepository.record`.
- Produces: `ProvidersRepository.setBalance(uuid, balance, currency)` (does not touch `balanceSyncedAt`); `findCredentials` now also selects `manualBalance`; `ProvidersService` constructor gains a 4th parameter `snapshots: BalanceSnapshotsRepository`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/test/providers-service.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const Decimal = require('decimal.js');
const { ProvidersService } = require('../dist/providers/providers.service');

const rejection = (fn) =>
  fn().then(
    () => assert.fail('expected rejection'),
    (e) => e,
  );

const row = (data) => ({
  uuid: 'p1',
  name: 'X',
  kind: 'manual',
  faviconLink: null,
  loginUrl: null,
  iconName: null,
  iconBg: null,
  credentialsEnc: null,
  balance: null,
  balanceCurrency: null,
  balanceSyncedAt: null,
  isPostpaid: false,
  manualBalance: false,
  lastSyncAt: null,
  lastSyncError: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  _count: { services: 0, payments: 0 },
  ...data,
});

function makeService({ existing = row({}) } = {}) {
  const writes = [];
  const snapshots = [];
  const providersRepo = {
    create: async (data) => {
      writes.push(data);
      return row({ ...data, balance: data.balance ? new Decimal(data.balance) : null });
    },
    update: async (_uuid, data) => {
      writes.push(data);
      return row({
        ...existing,
        ...data,
        balance:
          data.balance === undefined
            ? existing.balance
            : data.balance === null
              ? null
              : new Decimal(data.balance),
      });
    },
    findCredentials: async () => ({
      kind: existing.kind,
      credentialsEnc: existing.credentialsEnc,
      manualBalance: existing.manualBalance,
    }),
  };
  const crypto = { encrypt: () => new Uint8Array([1]), decrypt: () => '' };
  const favicons = { invalidateProvider: () => {} };
  const snapshotsRepo = {
    record: async (uuid, balance, currency) => snapshots.push({ uuid, balance, currency }),
  };
  return {
    service: new ProvidersService(providersRepo, crypto, favicons, snapshotsRepo),
    writes,
    snapshots,
  };
}

test('create: manual balance stores balance, currency, syncedAt and records a snapshot', async () => {
  const { service, writes, snapshots } = makeService();
  const before = Date.now();
  const dto = await service.create({
    name: 'X',
    kind: 'manual',
    manualBalance: true,
    balance: '15.50',
    balanceCurrency: 'USD',
  });
  assert.equal(dto.manualBalance, true);
  assert.equal(dto.balance, '15.50');
  assert.equal(writes[0].manualBalance, true);
  assert.equal(writes[0].balance, '15.50');
  assert.equal(writes[0].balanceCurrency, 'USD');
  assert.ok(writes[0].balanceSyncedAt.getTime() >= before);
  assert.deepEqual(snapshots, [{ uuid: 'p1', balance: '15.50', currency: 'USD' }]);
});

test('create: balance without manualBalance → 400', async () => {
  const { service } = makeService();
  const e = await rejection(() =>
    service.create({ name: 'X', kind: 'manual', balance: '1.00', balanceCurrency: 'USD' }),
  );
  assert.ok(e instanceof BadRequestException);
});

test('create: balance without currency → 400', async () => {
  const { service } = makeService();
  const e = await rejection(() =>
    service.create({ name: 'X', kind: 'manual', manualBalance: true, balance: '1.00' }),
  );
  assert.ok(e instanceof BadRequestException);
});

test('create: manualBalance on a kind with a balance API → 400', async () => {
  const { service } = makeService();
  const e = await rejection(() =>
    service.create({ name: 'X', kind: 'timeweb', token: 't', manualBalance: true }),
  );
  assert.ok(e instanceof BadRequestException);
});

test('update: balance accepted when the flag is already stored; resets syncedAt and snapshots', async () => {
  const { service, writes, snapshots } = makeService({
    existing: row({ manualBalance: true, balance: new Decimal('5.00'), balanceCurrency: 'USD' }),
  });
  await service.update('p1', { balance: '20.00', balanceCurrency: 'EUR' });
  assert.equal(writes[0].balance, '20.00');
  assert.equal(writes[0].balanceCurrency, 'EUR');
  assert.ok(writes[0].balanceSyncedAt instanceof Date);
  assert.deepEqual(snapshots, [{ uuid: 'p1', balance: '20.00', currency: 'EUR' }]);
});

test('update: name-only edit does not touch balance fields', async () => {
  const { service, writes, snapshots } = makeService({
    existing: row({ manualBalance: true, balance: new Decimal('5.00'), balanceCurrency: 'USD' }),
  });
  await service.update('p1', { name: 'Y' });
  assert.equal('balance' in writes[0], false);
  assert.equal('balanceSyncedAt' in writes[0], false);
  assert.deepEqual(snapshots, []);
});

test('update: turning the flag off clears balance, currency and syncedAt', async () => {
  const { service, writes } = makeService({
    existing: row({ manualBalance: true, balance: new Decimal('5.00'), balanceCurrency: 'USD' }),
  });
  await service.update('p1', { manualBalance: false });
  assert.equal(writes[0].manualBalance, false);
  assert.equal(writes[0].balance, null);
  assert.equal(writes[0].balanceCurrency, null);
  assert.equal(writes[0].balanceSyncedAt, null);
});

test('update: balance on a provider without the flag → 400', async () => {
  const { service } = makeService();
  const e = await rejection(() => service.update('p1', { balance: '1.00', balanceCurrency: 'USD' }));
  assert.ok(e instanceof BadRequestException);
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npm run build:backend && node --test apps/backend/test/providers-service.test.js
```
Expected: FAIL (the 400s are not thrown, balance is not written, `snapshots.record` never called).

- [ ] **Step 3: Repository changes**

In `apps/backend/src/repositories/providers/providers.repository.ts`:

Replace `findCredentials`:
```ts
  findCredentials(uuid: string) {
    return this.prisma.provider.findUnique({
      where: { uuid },
      select: { kind: true, credentialsEnc: true, manualBalance: true },
    });
  }
```

Add after `updateBalance`:
```ts
  /** Balance adjustment that is not an accrual point: `balanceSyncedAt` stays where it was. */
  async setBalance(uuid: string, balance: string, currency: string): Promise<void> {
    await this.prisma.provider.update({
      where: { uuid },
      data: { balance, balanceCurrency: currency },
    });
  }
```

- [ ] **Step 4: Service changes**

In `apps/backend/src/providers/providers.service.ts`:

Imports: extend the `@infra/shared` import and add the snapshots repository:
```ts
import {
  Provider as ProviderDto,
  ProviderCredentialsReveal,
  Service as ServiceDto,
  YandexDiscoverResult,
  providerKindAllowsManualBalance,
} from '@infra/shared';
import { BalanceSnapshotsRepository } from '@repositories/balance-snapshots/balance-snapshots.repository';
import { ProvidersRepository } from '@repositories/providers/providers.repository';
```

Constructor:
```ts
  constructor(
    private readonly providers: ProvidersRepository,
    private readonly crypto: CryptoService,
    private readonly favicons: FaviconsService,
    private readonly snapshots: BalanceSnapshotsRepository,
  ) {}
```

Replace `create` and `update`:
```ts
  async create(dto: CreateProviderDto): Promise<ProviderDto> {
    this.assertManualBalance(dto.kind, dto, false);
    const manualBalance = dto.manualBalance ?? false;
    const p = await this.providers.create({
      name: dto.name,
      kind: dto.kind,
      loginUrl: dto.loginUrl ?? null,
      iconName: dto.iconName ?? null,
      iconBg: dto.iconBg ?? null,
      isPostpaid: dto.isPostpaid ?? false,
      manualBalance,
      ...(manualBalance && dto.balance !== undefined
        ? { balance: dto.balance, balanceCurrency: dto.balanceCurrency, balanceSyncedAt: new Date() }
        : {}),
      credentialsEnc: this.buildCredentials(dto.kind, dto),
    });
    if (manualBalance && dto.balance !== undefined && dto.balanceCurrency) {
      await this.snapshots.record(p.uuid, dto.balance, dto.balanceCurrency);
    }
    return this.withCredentialHints(mapProvider(p), p.kind, p.credentialsEnc);
  }

  async update(uuid: string, dto: UpdateProviderDto): Promise<ProviderDto> {
    const existing = await this.providers.findCredentials(uuid);
    if (!existing) throw new NotFoundException('Provider not found');
    this.assertManualBalance(existing.kind, dto, existing.manualBalance);
    const data: Prisma.ProviderUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.loginUrl !== undefined) data.loginUrl = dto.loginUrl;
    if (dto.iconName !== undefined) data.iconName = dto.iconName;
    if (dto.iconBg !== undefined) data.iconBg = dto.iconBg;
    if (dto.isPostpaid !== undefined) data.isPostpaid = dto.isPostpaid;
    if (dto.manualBalance !== undefined) data.manualBalance = dto.manualBalance;
    if (dto.manualBalance === false) {
      data.balance = null;
      data.balanceCurrency = null;
      data.balanceSyncedAt = null;
    } else if (dto.balance !== undefined) {
      // A hand edit is a new point of truth: the next accrual charges from now.
      data.balance = dto.balance;
      data.balanceCurrency = dto.balanceCurrency;
      data.balanceSyncedAt = new Date();
    }
    // Merge onto existing credentials so a partial edit works, e.g. adding only a TOTP
    // secret to an existing BILLmanager provider without re-entering the password.
    const creds = this.buildCredentials(existing.kind, dto, existing.credentialsEnc);
    if (creds !== null) data.credentialsEnc = creds;
    const p = await this.providers.update(uuid, data);
    if (dto.manualBalance !== false && dto.balance !== undefined && dto.balanceCurrency) {
      await this.snapshots.record(uuid, dto.balance, dto.balanceCurrency);
    }
    if (dto.loginUrl !== undefined) this.favicons.invalidateProvider(uuid);
    return this.withCredentialHints(mapProvider(p), p.kind, p.credentialsEnc);
  }

  private assertManualBalance(
    kind: string,
    dto: { manualBalance?: boolean; balance?: string; balanceCurrency?: string },
    storedFlag: boolean,
  ): void {
    if (dto.manualBalance && !providerKindAllowsManualBalance(kind)) {
      throw new BadRequestException('This provider kind reports its balance via API');
    }
    if ((dto.balance === undefined) !== (dto.balanceCurrency === undefined)) {
      throw new BadRequestException('Balance and balance currency must be set together');
    }
    const flag = dto.manualBalance ?? storedFlag;
    if (dto.balance !== undefined && !flag) {
      throw new BadRequestException('Balance can only be set on a hand-maintained balance');
    }
  }
```

- [ ] **Step 5: Run to verify it passes**

Run:
```bash
npm run build:backend && node --test apps/backend/test/providers-service.test.js
```
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 6: Whole backend**

Run:
```bash
npm run typecheck && npm run check && npm test
```
Expected: all pass.

---

### Task 5: PaymentsService — owner payments adjust the balance

**Files:**
- Modify: `apps/backend/src/repositories/payments/payments.repository.ts:85-91`
- Modify: `apps/backend/src/payments/payments.service.ts`
- Modify: `apps/backend/src/payments/payments.module.ts`
- Test: `apps/backend/test/payments-service.test.js`

**Interfaces:**
- Consumes: `ProvidersRepository.findByUuid`, `setBalance` (Task 4); `BalanceSnapshotsRepository.record`; `CurrencyService.getRubRates`, `convert`.
- Produces: `PaymentsRepository.findByUuid(uuid)`; `PaymentsService` constructor becomes `(payments, providers, services, snapshots, currency)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/test/payments-service.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Decimal = require('decimal.js');
const { PaymentsService } = require('../dist/payments/payments.service');

const PROVIDER = '00000000-0000-0000-0000-000000000001';

function makeService({ provider, stored = null }) {
  const balanceWrites = [];
  const snapshots = [];
  const deleted = [];
  const paymentsRepo = {
    create: async (data) => ({
      uuid: 'pay-1',
      externalId: null,
      serviceUuid: null,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
      amount: new Decimal(data.amount),
    }),
    findByUuid: async () => stored,
    exists: async () => stored !== null,
    delete: async (uuid) => deleted.push(uuid),
  };
  const providersRepo = {
    exists: async () => true,
    findByUuid: async () => provider,
    setBalance: async (uuid, balance, currency) => balanceWrites.push({ uuid, balance, currency }),
  };
  const servicesRepo = { exists: async () => true };
  const snapshotsRepo = {
    record: async (uuid, balance, currency) => snapshots.push({ uuid, balance, currency }),
  };
  const currency = {
    getRubRates: async () => new Map(),
    convert: (amount, from, to) => (from === 'EUR' && to === 'USD' ? amount.mul(2) : amount),
  };
  return {
    service: new PaymentsService(paymentsRepo, providersRepo, servicesRepo, snapshotsRepo, currency),
    balanceWrites,
    snapshots,
    deleted,
  };
}

const manualProvider = (balance = '10.00') => ({
  uuid: PROVIDER,
  manualBalance: true,
  balance: new Decimal(balance),
  balanceCurrency: 'USD',
});

const dto = (over = {}) => ({
  providerUuid: PROVIDER,
  amount: '4.00',
  currency: 'USD',
  paymentDate: '2026-09-01T00:00:00.000Z',
  ...over,
});

test('create topup adds to a hand-maintained balance and snapshots', async () => {
  const { service, balanceWrites, snapshots } = makeService({ provider: manualProvider() });
  await service.create(dto());
  assert.deepEqual(balanceWrites, [{ uuid: PROVIDER, balance: '14.00', currency: 'USD' }]);
  assert.deepEqual(snapshots, [{ uuid: PROVIDER, balance: '14.00', currency: 'USD' }]);
});

test('create charge subtracts', async () => {
  const { service, balanceWrites } = makeService({ provider: manualProvider() });
  await service.create(dto({ type: 'charge' }));
  assert.equal(balanceWrites[0].balance, '6.00');
});

test('amount is converted into the balance currency', async () => {
  const { service, balanceWrites } = makeService({ provider: manualProvider() });
  await service.create(dto({ currency: 'EUR' }));
  assert.equal(balanceWrites[0].balance, '18.00');
});

test('provider without the flag is untouched', async () => {
  const { service, balanceWrites, snapshots } = makeService({
    provider: { ...manualProvider(), manualBalance: false },
  });
  await service.create(dto());
  assert.deepEqual(balanceWrites, []);
  assert.deepEqual(snapshots, []);
});

test('remove reverses an owner-entered topup', async () => {
  const stored = {
    uuid: 'pay-1',
    providerUuid: PROVIDER,
    amount: new Decimal('4.00'),
    currency: 'USD',
    type: 'topup',
    externalId: null,
  };
  const { service, balanceWrites, deleted } = makeService({ provider: manualProvider(), stored });
  await service.remove('pay-1');
  assert.deepEqual(deleted, ['pay-1']);
  assert.equal(balanceWrites[0].balance, '6.00');
});

test('remove of an imported payment leaves the balance alone', async () => {
  const stored = {
    uuid: 'pay-1',
    providerUuid: PROVIDER,
    amount: new Decimal('4.00'),
    currency: 'USD',
    type: 'charge',
    externalId: 'expense:1',
  };
  const { service, balanceWrites, deleted } = makeService({ provider: manualProvider(), stored });
  await service.remove('pay-1');
  assert.deepEqual(deleted, ['pay-1']);
  assert.deepEqual(balanceWrites, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
npm run build:backend && node --test apps/backend/test/payments-service.test.js
```
Expected: FAIL (`balanceWrites` empty; `remove` may throw because `findByUuid` is unused / constructor arity differs).

- [ ] **Step 3: Repository**

In `apps/backend/src/repositories/payments/payments.repository.ts`, add before `exists`:
```ts
  findByUuid(uuid: string) {
    return this.prisma.payment.findUnique({ where: { uuid } });
  }
```

- [ ] **Step 4: Service**

Replace `apps/backend/src/payments/payments.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PaginatedPayments, Payment as PaymentDto } from '@infra/shared';
import { BalanceSnapshotsRepository } from '@repositories/balance-snapshots/balance-snapshots.repository';
import { PaymentsRepository } from '@repositories/payments/payments.repository';
import { ProvidersRepository } from '@repositories/providers/providers.repository';
import { ServicesRepository } from '@repositories/services/services.repository';
import { mapPayment } from '@common/mappers';
import { CurrencyService } from '../currency/currency.service';
import { CreatePaymentDto, PaymentQueryDto } from './dto/payment.dto';

interface BalanceAffectingPayment {
  providerUuid: string;
  amount: Decimal.Value;
  currency: string;
  type: string;
  externalId: string | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly payments: PaymentsRepository,
    private readonly providers: ProvidersRepository,
    private readonly services: ServicesRepository,
    private readonly snapshots: BalanceSnapshotsRepository,
    private readonly currency: CurrencyService,
  ) {}

  async list(query: PaymentQueryDto): Promise<PaginatedPayments> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const { rows, total } = await this.payments.listPaginated(query, page, pageSize);
    return { items: rows.map(mapPayment), total };
  }

  async create(dto: CreatePaymentDto): Promise<PaymentDto> {
    await this.ensureProvider(dto.providerUuid);
    if (dto.serviceUuid) await this.ensureService(dto.serviceUuid);
    const p = await this.payments.create({
      providerUuid: dto.providerUuid,
      serviceUuid: dto.serviceUuid ?? null,
      amount: dto.amount,
      currency: dto.currency,
      description: dto.description ?? null,
      paymentDate: new Date(dto.paymentDate),
      type: dto.type ?? 'topup',
    });
    await this.applyToManualBalance(p, 1);
    return mapPayment(p);
  }

  async remove(uuid: string): Promise<void> {
    const p = await this.payments.findByUuid(uuid);
    if (!p) throw new NotFoundException('Payment not found');
    await this.payments.delete(uuid);
    await this.applyToManualBalance(p, -1);
  }

  /**
   * Owner-entered payments move a hand-maintained balance (topup up, charge down); `direction`
   * -1 undoes one on delete. Imported payments (externalId set) never touch it: metered spend is
   * already accrued from the services, and a connector ledger would double-count it.
   */
  private async applyToManualBalance(
    payment: BalanceAffectingPayment,
    direction: 1 | -1,
  ): Promise<void> {
    if (payment.externalId) return;
    const provider = await this.providers.findByUuid(payment.providerUuid);
    if (!provider?.manualBalance || provider.balance == null || !provider.balanceCurrency) return;
    const rates = await this.currency.getRubRates();
    const amount = this.currency.convert(
      new Decimal(payment.amount.toString()),
      payment.currency,
      provider.balanceCurrency,
      rates,
    );
    const signed = payment.type === 'charge' ? amount.neg() : amount;
    const balance = new Decimal(provider.balance.toString()).add(signed.mul(direction)).toFixed(2);
    await this.providers.setBalance(provider.uuid, balance, provider.balanceCurrency);
    await this.snapshots.record(provider.uuid, balance, provider.balanceCurrency);
  }

  private async ensureProvider(uuid: string): Promise<void> {
    if (!(await this.providers.exists(uuid))) throw new NotFoundException('Provider not found');
  }

  private async ensureService(uuid: string): Promise<void> {
    if (!(await this.services.exists(uuid))) throw new NotFoundException('Service not found');
  }
}
```

- [ ] **Step 5: Module**

Replace `apps/backend/src/payments/payments.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [CurrencyModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
```

- [ ] **Step 6: Run to verify it passes**

Run:
```bash
npm run build:backend && node --test apps/backend/test/payments-service.test.js
```
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 7: Whole backend**

Run:
```bash
npm run typecheck && npm run check && npm test
```
Expected: all pass.

---

### Task 6: Frontend — form fields, payload, detail hint, i18n

**Files:**
- Modify: `apps/frontend/src/pages/providers/providerForm.ts:5-23, 51-68`
- Modify: `apps/frontend/src/pages/providers/ProviderFormFields.tsx:1-18, 137-156`
- Modify: `apps/frontend/src/pages/providers/ProvidersPage.tsx:65-84, 100-135`
- Modify: `apps/frontend/src/pages/providers/ProviderDetailModal.tsx:113-118`
- Modify: `apps/frontend/src/i18n/locales/providers.ts` (en `detail`, `field`, `err`; ru `detail`, `field`, `err`)

**Interfaces:**
- Consumes: `providerKindAllowsManualBalance` from `@infra/shared` (Task 1); `CURRENCY_OPTIONS` from `@/constants`; `trimMoney` from `@/utils/format`; `useSettings().data?.baseCurrency`.
- Produces: `FormValues.manualBalance: boolean`, `FormValues.balance: string`, `FormValues.balanceCurrency: string`.

- [ ] **Step 1: Form state**

In `apps/frontend/src/pages/providers/providerForm.ts`, `FormValues` after `isPostpaid: boolean;`:
```ts
  manualBalance: boolean;
  balance: string;
  balanceCurrency: string;
```
`EMPTY_FORM` after `isPostpaid: false,`:
```ts
  manualBalance: false,
  balance: '',
  balanceCurrency: 'RUB',
```

- [ ] **Step 2: i18n strings**

In `apps/frontend/src/i18n/locales/providers.ts`:

en `detail` — add after `historyTitle`:
```ts
      balanceManual: 'manual',
      accruedAt: 'Debited as of',
```
en `field` — add after `isPostpaidDesc`:
```ts
      manualBalance: 'Keep balance by hand',
      manualBalanceDesc:
        'The panel debits hourly/daily services from it and applies journal payments (top-ups add, charges subtract)',
      balance: 'Balance',
      balanceCurrency: 'Currency',
```
en `err` — add after `loginUrlInvalid`:
```ts
      balanceRequired: 'Enter the current balance',
      balanceFormat: 'Balance: a number with up to 2 decimals, e.g. 1500 or -12.50',
```
ru `detail` — add after `historyTitle`:
```ts
      balanceManual: 'вручную',
      accruedAt: 'Списано на',
```
ru `field` — add after `isPostpaidDesc`:
```ts
      manualBalance: 'Вести баланс вручную',
      manualBalanceDesc:
        'Панель списывает почасовые и дневные услуги и учитывает платежи из журнала (пополнение прибавляет, списание вычитает)',
      balance: 'Баланс',
      balanceCurrency: 'Валюта',
```
ru `err` — add after `loginUrlInvalid`:
```ts
      balanceRequired: 'Укажите текущий баланс',
      balanceFormat: 'Баланс: число не более чем с 2 знаками после точки, например 1500 или -12.50',
```

- [ ] **Step 3: Form fields**

In `apps/frontend/src/pages/providers/ProviderFormFields.tsx`:

Imports — add:
```ts
import { providerKindAllowsManualBalance } from '@infra/shared';
import { CURRENCY_OPTIONS } from '@/constants';
import { trimMoney } from '@/utils/format';
```

Inside the component, after `const iconBg = form.watch('iconBg');`:
```ts
  const manualBalance = form.watch('manualBalance');
  const balanceError = form.formState.errors.balance;
```

After the `isPostpaid` `<Controller ... />` block (still inside the first `FormSection`), add:
```tsx
        {providerKindAllowsManualBalance(kind) && (
          <>
            <Controller
              control={form.control}
              name="manualBalance"
              render={({ field }) => (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="provider-manual-balance"
                    checked={field.value}
                    onCheckedChange={(c) => field.onChange(c === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="provider-manual-balance">
                      {t('providers.field.manualBalance')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('providers.field.manualBalanceDesc')}
                    </p>
                  </div>
                </div>
              )}
            />
            {manualBalance && (
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="provider-balance">
                    {t('providers.field.balance')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="provider-balance"
                    inputMode="decimal"
                    aria-invalid={balanceError ? true : undefined}
                    {...form.register('balance', {
                      validate: (v) => {
                        if (!form.getValues('manualBalance')) return true;
                        if (!v.trim()) return t('providers.err.balanceRequired');
                        return /^-?\d+(\.\d{1,2})?$/.test(v.trim())
                          ? true
                          : t('providers.err.balanceFormat');
                      },
                      onBlur: (e) =>
                        form.setValue('balance', trimMoney(e.target.value), {
                          shouldDirty: true,
                        }),
                    })}
                  />
                  {balanceError && (
                    <p className="text-xs text-destructive">{balanceError.message}</p>
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="provider-balance-currency">
                    {t('providers.field.balanceCurrency')}
                  </Label>
                  <Controller
                    control={form.control}
                    name="balanceCurrency"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="provider-balance-currency" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            )}
          </>
        )}
```

- [ ] **Step 4: Payload and prefill**

In `apps/frontend/src/pages/providers/ProvidersPage.tsx`:

`openCreate` — default the currency to the base currency:
```ts
  const openCreate = () => {
    form.reset({ ...EMPTY_FORM, balanceCurrency: settings?.baseCurrency ?? 'RUB' });
    openCreateModal();
  };
```

`openDetail` — after `isPostpaid: p.isPostpaid,`:
```ts
      manualBalance: p.manualBalance,
      balance: p.balance ?? '',
      balanceCurrency: p.balanceCurrency ?? settings?.baseCurrency ?? 'RUB',
```

In `submit`, before `try {`:
```ts
    // Balance fields travel only when they changed: re-sending the same number would reset the
    // accrual point (balanceSyncedAt) on every unrelated edit, e.g. a rename.
    const dirty = form.formState.dirtyFields;
    const balanceTouched = Boolean(
      dirty.balance || dirty.balanceCurrency || dirty.manualBalance,
    );
    const balanceFields =
      v.manualBalance && (balanceTouched || !selected)
        ? { balance: trimMoney(v.balance), balanceCurrency: v.balanceCurrency }
        : {};
```
Add `import { formatDate, trimMoney } from '@/utils/format';` (replacing the existing `formatDate` import).

Update payload (`update.mutateAsync`) — after `isPostpaid: v.isPostpaid,`:
```ts
            manualBalance: v.manualBalance,
            ...balanceFields,
```
Create payload (`create.mutateAsync`) — after `isPostpaid: v.isPostpaid,`:
```ts
          manualBalance: v.manualBalance,
          ...balanceFields,
```

- [ ] **Step 5: Detail modal hint**

In `apps/frontend/src/pages/providers/ProviderDetailModal.tsx`, replace the balance `InfoRow`:
```tsx
                <InfoRow
                  label={t('providers.th.balance')}
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      {formatMoney(shown.balance, shown.balanceCurrency)}
                      {shown.manualBalance && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          {t('providers.detail.balanceManual')}
                        </Badge>
                      )}
                    </span>
                  }
                />
                {shown.manualBalance && shown.balanceSyncedAt && (
                  <InfoRow
                    label={t('providers.detail.accruedAt')}
                    value={formatDate(shown.balanceSyncedAt)}
                  />
                )}
```

- [ ] **Step 6: Typecheck and lint**

Run:
```bash
npm run build:shared && npm run typecheck && npm run check
```
Expected: no errors. Fix formatting with `npm run check:fix` if biome reports only style issues.

- [ ] **Step 7: Verify in the browser**

Start the dev servers via the `preview_start` tool with the `.claude/launch.json` entry (see memory: local dev env uses colima + compose db + launch.json). Then:
1. Providers → Add → kind `manual`: the checkbox appears; tick it → balance + currency row appears; submit with an empty balance → inline "Укажите текущий баланс"; enter `100` → provider created, detail modal shows `100,00 RUB` with the "вручную" badge and "Списано на".
2. Switch kind to `timeweb` in the create modal → checkbox hidden. Kind `hetzner` → visible.
3. Open the manual provider, rename only, save → reopen: balance unchanged and "Списано на" unchanged.
4. Add an hourly service (cost `1`, RUB) to that provider, press "Синхронизировать все" → detail modal: balance decreased by the elapsed-hours amount (tiny if seconds passed), "Списано на" moved to now, a new point on the history chart.
5. Payments → add a `topup` of `50` for that provider → balance `+50`; delete it → back.
6. Untick the checkbox, save → balance shows `—`.

Take a screenshot of the detail modal from step 4 as proof.

---

### Task 7: Final verification

- [ ] **Step 1: Full suite**

Run:
```bash
npm run build:shared && npm run build:backend && npm test && npm run typecheck && npm run check
```
Expected: every test file passes (`# fail 0`), typecheck clean, biome clean.

- [ ] **Step 2: Review the diff against the spec**

Run:
```bash
git status --short && git diff --stat
```
Walk the spec's sections (data model, shared schemas, ProvidersService, accrual, SyncService, PaymentsService, frontend, i18n, tests) and confirm each has a corresponding change. Nothing is committed: the owner commits.
