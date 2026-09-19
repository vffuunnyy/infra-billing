import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { BalanceSnapshotsRepository } from '@repositories/balance-snapshots/balance-snapshots.repository';
import { ProvidersRepository } from '@repositories/providers/providers.repository';
import { ServicesRepository } from '@repositories/services/services.repository';
import { accrueDebit } from '@common/accrual';
import { CurrencyService } from '../currency/currency.service';

/**
 * Drains hand-maintained balances by their metered services after every sync pass. The debit is
 * proportional to elapsed time: a missed or late tick never skips or doubles a charge.
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
