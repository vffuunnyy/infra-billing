import { Injectable, Logger } from '@nestjs/common';
import { ProjectNotificationSettingsRepository } from '@repositories/project-notification-settings/project-notification-settings.repository';
import { Api } from 'grammy';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CryptoService } from '../crypto/crypto.service';

interface TelegramConfig {
  token: string;
  chatId: string;
  topicId: string;
  proxyUrl: string;
}

// Outbound-only: grammY `Api`, no Bot/polling/webhook. Config (token AES-GCM encrypted) read from
// project settings on every send so edits apply without a restart. No global or env fallback.
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly settings: ProjectNotificationSettingsRepository,
    private readonly crypto: CryptoService,
  ) {}

  /** Telegram config belongs only to the requested project; null if not configured. */
  private resolveConfig(
    s: {
      telegramBotTokenEnc: Uint8Array | null;
      telegramChatId: string | null;
      telegramTopicId: string | null;
      telegramProxyUrl: string | null;
    } | null,
  ): TelegramConfig | null {
    if (s?.telegramBotTokenEnc && s.telegramChatId) {
      try {
        return {
          token: this.crypto.decrypt(s.telegramBotTokenEnc),
          chatId: s.telegramChatId,
          topicId: s.telegramTopicId ?? '',
          proxyUrl: s.telegramProxyUrl ?? '',
        };
      } catch {
        this.logger.error('Failed to decrypt the Telegram token from settings');
      }
    }
    return null;
  }

  /** Automatic notifications are on only when the master switch is on AND config exists. */
  async isEnabled(projectUuid: string): Promise<boolean> {
    const s = await this.settings.find(projectUuid);
    if (s && !s.notificationsEnabled) return false;
    return this.resolveConfig(s) !== null;
  }

  /** Send a message. Ignores the master switch (used by the manual "test" too). */
  async send(html: string, projectUuid: string, automatic = false): Promise<boolean> {
    const s = await this.settings.find(projectUuid);
    if (automatic && !s?.notificationsEnabled) return false;
    const cfg = this.resolveConfig(s);
    if (!cfg) return false;
    const options: {
      parse_mode: 'HTML';
      message_thread_id?: number;
      link_preview_options: { is_disabled: true };
    } = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    if (cfg.topicId) options.message_thread_id = Number(cfg.topicId);

    try {
      const api = cfg.proxyUrl
        ? new Api(cfg.token, {
            timeoutSeconds: 10,
            baseFetchConfig: { agent: new SocksProxyAgent(cfg.proxyUrl), compress: true },
          })
        : new Api(cfg.token, { timeoutSeconds: 10 });
      await api.sendMessage(cfg.chatId, html, options);
      return true;
    } catch (e) {
      // Transport errors may include the request URL with the bot token; do not log it.
      this.logger.error(
        `Failed to send Telegram notification for project ${projectUuid}: ${e instanceof Error ? e.name : 'unknown error'}`,
      );
      return false;
    }
  }
}
