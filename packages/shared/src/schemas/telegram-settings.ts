import { z } from 'zod';

export const telegramSettingsSchema = z.object({
  notificationsEnabled: z.boolean(),
  upcomingBillingDays: z.number().int().min(1).max(60),
  telegramChatId: z.string().nullable(),
  telegramTopicId: z.string().nullable(),
  telegramProxyUrl: z.string().nullable(),
  // The token is write-only and encrypted at rest.
  telegramConfigured: z.boolean(),
});
export type TelegramSettings = z.infer<typeof telegramSettingsSchema>;

export const updateTelegramSettingsSchema = z
  .object({
    notificationsEnabled: z.boolean().optional(),
    upcomingBillingDays: z.number().int().min(1).max(60).optional(),
    // Empty or omitted token keeps the stored token. Empty destination/proxy clears it.
    telegramBotToken: z.string().trim().optional(),
    telegramChatId: z
      .string()
      .trim()
      .regex(/^$|^-?\d+$/)
      .optional(),
    telegramTopicId: z
      .string()
      .trim()
      .regex(/^$|^[1-9]\d*$/)
      .optional(),
    telegramProxyUrl: z
      .string()
      .trim()
      .regex(/^$|^socks(4a?|5h?)?:\/\/\S+$/)
      .optional(),
  })
  .strict();
export type UpdateTelegramSettings = z.infer<typeof updateTelegramSettingsSchema>;
