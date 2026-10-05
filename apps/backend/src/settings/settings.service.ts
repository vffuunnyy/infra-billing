import { Injectable } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { RateSource, Settings, UpdateSettings } from '@infra/shared';
import { SettingsRepository } from '@repositories/settings/settings.repository';
import { SyncService } from '../sync/sync.service';

interface SettingsRow {
  baseCurrency: string;
  syncIntervalHours: number;
  rateSource: string;
  forecastTariffBackfill: boolean;
  forecastTariffBackfillRespectCreatedAt: boolean;
  forecastTariffBackfillBackdateFromPayments: boolean;
  forecastTariffBackfillForce: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly sync: SyncService,
  ) {}

  /** Read the singleton settings row, seeding it with the schema column defaults on first access. */
  async get(): Promise<Settings> {
    const row = await this.settings.ensure();
    return this.toDto(row);
  }

  async update(dto: UpdateSettings): Promise<Settings> {
    await this.get(); // ensure the row exists
    const data: Prisma.SettingsUpdateInput = {};
    if (dto.baseCurrency !== undefined) data.baseCurrency = dto.baseCurrency;
    if (dto.syncIntervalHours !== undefined) data.syncIntervalHours = dto.syncIntervalHours;
    if (dto.rateSource !== undefined) data.rateSource = dto.rateSource;
    if (dto.forecastTariffBackfill !== undefined)
      data.forecastTariffBackfill = dto.forecastTariffBackfill;
    if (dto.forecastTariffBackfillRespectCreatedAt !== undefined)
      data.forecastTariffBackfillRespectCreatedAt = dto.forecastTariffBackfillRespectCreatedAt;
    if (dto.forecastTariffBackfillBackdateFromPayments !== undefined)
      data.forecastTariffBackfillBackdateFromPayments =
        dto.forecastTariffBackfillBackdateFromPayments;
    if (dto.forecastTariffBackfillForce !== undefined)
      data.forecastTariffBackfillForce = dto.forecastTariffBackfillForce;

    const row = await this.settings.update(data);
    // The autosync interval lives here now. Re-arm the scheduler when it changes.
    if (dto.syncIntervalHours !== undefined) this.sync.reschedule(row.syncIntervalHours);
    return this.toDto(row);
  }

  private toDto(row: SettingsRow): Settings {
    return {
      baseCurrency: row.baseCurrency,
      syncIntervalHours: row.syncIntervalHours,
      nextSyncAt: this.sync.getNextSyncAt()?.toISOString() ?? null,
      rateSource: row.rateSource as RateSource,
      forecastTariffBackfill: row.forecastTariffBackfill,
      forecastTariffBackfillRespectCreatedAt: row.forecastTariffBackfillRespectCreatedAt,
      forecastTariffBackfillBackdateFromPayments: row.forecastTariffBackfillBackdateFromPayments,
      forecastTariffBackfillForce: row.forecastTariffBackfillForce,
    };
  }
}
