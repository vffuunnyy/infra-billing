import { createZodDto } from 'nestjs-zod';
import { telegramSettingsSchema, updateTelegramSettingsSchema } from '@infra/shared';

export class TelegramSettingsDto extends createZodDto(telegramSettingsSchema) {}
export class UpdateTelegramSettingsDto extends createZodDto(updateTelegramSettingsSchema) {}
