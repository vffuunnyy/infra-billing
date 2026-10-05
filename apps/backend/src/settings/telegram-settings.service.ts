import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { TelegramSettings, UpdateTelegramSettings } from '@infra/shared';
import { ProjectNotificationSettingsRepository } from '@repositories/project-notification-settings/project-notification-settings.repository';
import { ProjectsRepository } from '@repositories/projects/projects.repository';
import { CryptoService } from '../crypto/crypto.service';

@Injectable()
export class TelegramSettingsService {
  constructor(
    private readonly settings: ProjectNotificationSettingsRepository,
    private readonly projects: ProjectsRepository,
    private readonly crypto: CryptoService,
  ) {}

  private async requireProject(projectUuid: string): Promise<void> {
    if (!(await this.projects.exists(projectUuid)))
      throw new NotFoundException('Project not found');
  }

  async get(projectUuid: string): Promise<TelegramSettings> {
    await this.requireProject(projectUuid);
    return this.toDto(await this.settings.find(projectUuid));
  }

  async update(projectUuid: string, dto: UpdateTelegramSettings): Promise<TelegramSettings> {
    await this.requireProject(projectUuid);
    const data: Prisma.ProjectNotificationSettingsUncheckedUpdateInput = {};
    if (dto.notificationsEnabled !== undefined)
      data.notificationsEnabled = dto.notificationsEnabled;
    if (dto.upcomingBillingDays !== undefined) data.upcomingBillingDays = dto.upcomingBillingDays;
    if (dto.telegramChatId !== undefined) data.telegramChatId = dto.telegramChatId || null;
    if (dto.telegramTopicId !== undefined) data.telegramTopicId = dto.telegramTopicId || null;
    if (dto.telegramProxyUrl !== undefined) data.telegramProxyUrl = dto.telegramProxyUrl || null;
    if (dto.telegramBotToken) data.telegramBotTokenEnc = this.crypto.encrypt(dto.telegramBotToken);
    return this.toDto(await this.settings.upsert(projectUuid, data));
  }

  private toDto(
    row: {
      notificationsEnabled: boolean;
      upcomingBillingDays: number;
      telegramBotTokenEnc: Uint8Array | null;
      telegramChatId: string | null;
      telegramTopicId: string | null;
      telegramProxyUrl: string | null;
    } | null,
  ): TelegramSettings {
    return {
      notificationsEnabled: row?.notificationsEnabled ?? false,
      upcomingBillingDays: row?.upcomingBillingDays ?? 3,
      telegramChatId: row?.telegramChatId ?? null,
      telegramTopicId: row?.telegramTopicId ?? null,
      telegramProxyUrl: row?.telegramProxyUrl ?? null,
      telegramConfigured: row?.telegramBotTokenEnc != null,
    };
  }
}
