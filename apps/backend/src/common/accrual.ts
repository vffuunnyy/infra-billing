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
    // Prisma.Decimal comes from its own decimal.js copy; `.toString()` is the idiom used elsewhere.
    const cost = new Decimal(s.cost.toString());
    const perHour = s.period === 'daily' ? cost.div(24) : cost;
    debit = debit.add(convert(perHour.mul(hours), s.currency, toCurrency));
  }
  return debit;
}
