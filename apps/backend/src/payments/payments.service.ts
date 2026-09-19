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
