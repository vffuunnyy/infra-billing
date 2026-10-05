import { z } from 'zod';
import { rateSourceSchema } from '../enums';
import { currencySchema, isoDateSchema } from './common';

export const settingsSchema = z.object({
  baseCurrency: currencySchema.describe('Base currency for analytics'),
  syncIntervalHours: z.number().int().positive().describe('Auto-sync interval in hours'),
  // When the next scheduled autosync will run (read-only; not part of the update payload).
  nextSyncAt: isoDateSchema.describe('Next scheduled autosync').nullable(),
  rateSource: rateSourceSchema.describe('Exchange rate source'),
  forecastTariffBackfill: z
    .boolean()
    .describe('Fill forecast history with full portfolio monthly tariffs'),
  forecastTariffBackfillRespectCreatedAt: z
    .boolean()
    .describe('Only include services whose createdAt falls on or before each month'),
  forecastTariffBackfillBackdateFromPayments: z
    .boolean()
    .describe(
      'If a provider has payments before its services were created, count tariffs from the first payment month',
    ),
  forecastTariffBackfillForce: z
    .boolean()
    .describe('Ignore payments and write full tariff total into actual and estimated'),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = z
  .object({
    baseCurrency: currencySchema.describe('Base currency for analytics').optional(),
    syncIntervalHours: z
      .number()
      .int()
      .positive()
      .describe('Auto-sync interval in hours')
      .optional(),
    rateSource: rateSourceSchema.describe('Exchange rate source').optional(),
    forecastTariffBackfill: z
      .boolean()
      .describe('Fill forecast history with full portfolio monthly tariffs')
      .optional(),
    forecastTariffBackfillRespectCreatedAt: z
      .boolean()
      .describe('Only include services whose createdAt falls on or before each month')
      .optional(),
    forecastTariffBackfillBackdateFromPayments: z
      .boolean()
      .describe(
        'If a provider has payments before its services were created, count tariffs from the first payment month',
      )
      .optional(),
    forecastTariffBackfillForce: z
      .boolean()
      .describe('Ignore payments and write full tariff total into actual and estimated')
      .optional(),
  })
  .strict();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
