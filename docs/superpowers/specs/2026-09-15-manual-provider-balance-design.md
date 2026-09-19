# Manual provider balance

Date: 2026-09-15. Branch: `feat/manual-provider-balance`.

## Problem

Metered (hourly/daily) services are auto-debited from a prepaid balance. For API providers the
panel reads that balance, so runway estimation and low-balance alerts work. Manual providers
(and API providers whose connector returns `balance: null`) never get a balance written, so
their metered services are invisible everywhere: they are skipped in upcoming/overdue by
design (7d63166) and the provider is never a runway candidate. Nothing warns the owner before
the account runs dry.

## Goal

Let the owner keep a balance by hand for such providers, and have the panel drain it by the
metered services' cost over time, so the existing runway/coverage/alert logic applies unchanged.

## Decisions

- The panel debits the balance itself (not a static number the owner keeps updating).
- Only hourly/daily services are debited. Monthly/quarterly/yearly stay on the dated path
  (upcoming/overdue by `nextBillingAt`); the owner records those payments manually.
- Available for `kind = manual` and for connectors that can return `balance: null`.
- Debit accrues by elapsed time on the autosync tick (approach A), not on a fixed daily cron
  and not as a virtual read-time balance: it is cadence-independent, survives downtime without
  skipped or doubled debits, and feeds the existing snapshot history / runway.

## Data model

`Provider.manualBalance Boolean @default(false) @map("manual_balance")`. One migration
`add_provider_manual_balance` adding the column `NOT NULL DEFAULT false`.

The existing `balance`, `balanceCurrency`, `balanceSyncedAt` columns are reused. For a manual
balance, `balanceSyncedAt` is the moment the balance was last correct: the next accrual
charges from there.

## Shared schemas (`packages/shared`)

- `providerSchema`: `manualBalance: boolean`.
- `createProviderSchema` / `updateProviderSchema`: `manualBalance?: boolean`,
  `balance?: money`, `balanceCurrency?: currency`.
- `PROVIDER_KINDS_WITHOUT_BALANCE_API = ['hetzner', 'hostkey', 'netcup', 'stormwall',
  'spaceship', 'beget', 'cloudflare', 'yandex']` and
  `providerKindAllowsManualBalance(kind)` = `kind === 'manual'` or in that list. Same shape as
  `PROVIDER_KINDS_WITH_PAYMENT_IMPORT`.

## Backend

### ProvidersService

Validation (400 on failure):
- `balance` and `balanceCurrency` must come together.
- They are accepted only when `manualBalance` is true, either in the same request or already
  stored on the provider.
- `manualBalance: true` requires `providerKindAllowsManualBalance(kind)`.

`create`: with `manualBalance`, store balance/currency, `balanceSyncedAt = now`, record a
snapshot.

`update`:
- `balance` given → overwrite balance/currency, `balanceSyncedAt = now`, record a snapshot.
  A hand edit is a new point of truth.
- `manualBalance: false` → clear `balance`, `balanceCurrency`, `balanceSyncedAt`. For an API
  kind the next sync refills them if the connector reports a balance.

`mapProvider` exposes `manualBalance`.

### Accrual

Pure function in `apps/backend/src/common/accrual.ts` (next to `runway.ts`):

```
accrueDebit(services, from, now, toCurrency, convert): Decimal
```

For each service with `isActive` and `period ∈ {hourly, daily}`:
- `start = max(from, service.createdAt)`; `hours = max(0, (now - start) / 1h)`.
- hourly: `cost × hours`; daily: `cost × hours / 24`.
- Converted from `service.currency` to `toCurrency` via the supplied `convert`.

Sum of all terms. No metered services → 0.

`BalanceAccrualService` (module `sync`; deps: `ProvidersRepository`, `ServicesRepository`,
`BalanceSnapshotsRepository`, `CurrencyService`):

`accrueAll(now = new Date())`:
- Providers with `manualBalance && balance != null && balanceCurrency`.
- Rates loaded once per run via `currency.getRubRates()`; conversion via
  `currency.convert` (best-effort: a missing rate logs and leaves the amount unchanged, same
  as analytics).
- Per provider: `debit = accrueDebit(...)`, `newBalance = balance − debit` (may go negative;
  that is the signal), `providers.updateBalance(uuid, newBalance, currency)` (sets
  `balanceSyncedAt = now`), `snapshots.record(...)`.
- `balanceSyncedAt` advances even when `debit = 0`, so the chart shows flat history and the
  point of truth stays fresh.
- One provider's failure is logged and does not stop the others; its `balanceSyncedAt` stays
  put so the debit lands on the next tick.

### SyncService

- `syncAllProviders()` (scheduler) and `syncAll()` (UI "sync all") call
  `accrual.accrueAll()` after the API providers are synced.
- `syncProvider()` skips the `updateBalance` + `snapshots.record` block when
  `provider.manualBalance` is true. Services, payments, favicon sync unchanged.
- `syncProvider()` for `kind = manual` stays a 400. No per-provider "accrue now" button.

### PaymentsService

Only when the provider has `manualBalance && balance != null`:
- `create`: `topup` → `balance += amount`, `charge` → `balance −= amount`, amount converted
  to `balanceCurrency`; then a snapshot. `balanceSyncedAt` untouched (a payment is not an
  accrual point).
- `remove`: the reverse, only for owner-entered payments (`externalId == null`).
- Payments imported by sync (`upsertPayments`) never touch the balance.
- `paymentDate` is ignored; the adjustment applies when entered.

### Analytics and notifications

No code changes. A provider with a manual balance becomes a runway candidate (snapshots
first, services-cost fallback), dated charges get real `covered` instead of `null`, and the
low-runway alert fires at ≤3 days. Known limitation kept: a provider mixing monthly and
metered services stays on the dated path.

## Frontend

### Provider form (`ProviderFormFields.tsx`, `providerForm.ts`)

- `FormValues`: `manualBalance: boolean`, `balance: string`, `balanceCurrency: string`.
- Checkbox "Вести баланс вручную" under `isPostpaid`, shown only when
  `providerKindAllowsManualBalance(kind)`. Description: the panel debits hourly/daily
  services and applies journal payments.
- When checked: one row with "Баланс" (number, required) and "Валюта" (select, same
  `currencyOptions` as the service form, default = base currency).
- Validation: balance required and numeric when the checkbox is on.

### Payload (`ProvidersPage.tsx`)

- Always send `manualBalance`.
- Send `balance` + `balanceCurrency` only when the checkbox is on and one of
  `dirtyFields.balance | balanceCurrency | manualBalance` is set. Editing the name must not
  reset `balanceSyncedAt`.
- Edit mode prefills the three fields from the provider.

### Detail modal (`ProviderDetailModal.tsx`)

Next to the balance row, when `manualBalance`: a "вручную" hint and `balanceSyncedAt` shown as
"списано на …". The history chart already renders when `balance != null`.

### Table

Unchanged.

### i18n (`locales/providers.ts`, en + ru)

`field.manualBalance`, `field.manualBalanceDesc`, `field.balance`, `field.balanceCurrency`,
`err.balanceRequired`, `detail.balanceManual`, `detail.accruedAt`.

## Tests (`apps/backend/test/*.test.js`, node:test against `dist`)

- `accrual.test.js` (pure function): hourly × elapsed hours; daily / 24; clamp to service
  `createdAt`; inactive and monthly ignored; currency conversion applied; no services → 0.
- `balance-accrual-service.test.js` (mocked repos): updates balance and records a snapshot;
  advances `balanceSyncedAt` on zero debit; one provider's error does not stop the rest.
- `sync-service` addition: `syncProvider` leaves the balance alone when `manualBalance`.
- `payments-service.test.js`: topup adds, charge subtracts, `remove` reverses, provider
  without the flag untouched, imported payment untouched on remove.
- `providers-service.test.js`: enabling with a balance records a snapshot; disabling clears;
  disallowed kind → 400; balance without currency → 400.

## Out of scope

- Debiting monthly/yearly services on `nextBillingAt`.
- A per-provider "accrue now" action.
- Applying `paymentDate` retroactively.
