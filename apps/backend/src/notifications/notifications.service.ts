import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import dayjs from 'dayjs';
import { NotificationLogRepository } from '@repositories/notification-log/notification-log.repository';
import { ProjectNotificationSettingsRepository } from '@repositories/project-notification-settings/project-notification-settings.repository';
import { ServicesRepository } from '@repositories/services/services.repository';
import { SyncRunsRepository } from '@repositories/sync-runs/sync-runs.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  esc,
  lowBalanceMessage,
  lowRunwayMessage,
  overdueBillingMessage,
  sampleMessages,
  syncErrorMessage,
  unknownCoverageMessage,
  upcomingBillingMessage,
} from './messages';
import { TelegramService } from './telegram.service';

const THROTTLE_HOURS = 24;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly settings: ProjectNotificationSettingsRepository,
    private readonly syncRuns: SyncRunsRepository,
    private readonly notificationLog: NotificationLogRepository,
    private readonly analytics: AnalyticsService,
    private readonly telegram: TelegramService,
    private readonly services: ServicesRepository,
  ) {}

  /** Scheduled checks cover enabled projects; manual checks require a specific project. */
  async checkAndNotify(projectUuid?: string): Promise<number> {
    const configs = projectUuid
      ? [await this.settings.find(projectUuid)]
      : await this.settings.listEnabled();
    let sent = 0;
    for (const config of configs) {
      if (!config?.notificationsEnabled) continue;
      try {
        if (!(await this.telegram.isEnabled(config.projectUuid))) continue;
        sent += await this.checkProject(
          config.projectUuid,
          config.project.name,
          config.upcomingBillingDays,
        );
      } catch {
        this.logger.error(`Notification check failed for project ${config.projectUuid}`);
      }
    }
    if (sent > 0) this.logger.log(`Notifications sent: ${sent}`);
    return sent;
  }

  private async checkProject(
    projectUuid: string,
    projectName: string,
    upcomingDays: number,
  ): Promise<number> {
    const summary = await this.analytics.summary({
      projectUuids: [projectUuid],
      explicitFilter: true,
      includeBalances: true,
      includePayments: false,
    });
    const send = (key: string, html: string) => this.maybeSend(projectUuid, projectName, key, html);
    let sent = 0;

    for (const ub of summary.upcomingBillings) {
      if (ub.severity !== 'critical') continue;
      const unknown = ub.covered === null;
      const html = unknown ? unknownCoverageMessage(ub) : lowBalanceMessage(ub);
      const key = unknown ? `unknown-coverage:${ub.serviceUuid}` : `low-balance:${ub.serviceUuid}`;
      if (await send(key, html)) sent += 1;
    }
    for (const r of summary.balanceRunway) {
      if (r.severity !== 'critical') continue;
      if (await send(`runway:${r.providerUuid}`, lowRunwayMessage(r))) sent += 1;
    }
    for (const ob of summary.overdueBillings) {
      if (await send(`overdue:${ob.serviceUuid}`, overdueBillingMessage(ob))) sent += 1;
    }

    const horizon = dayjs().add(upcomingDays, 'day');
    for (const ub of summary.upcomingBillings) {
      if (dayjs(ub.nextBillingAt).isAfter(horizon)) continue;
      const day = dayjs(ub.nextBillingAt).format('YYYY-MM-DD');
      if (await send(`upcoming:${ub.serviceUuid}:${day}`, upcomingBillingMessage(ub, day)))
        sent += 1;
    }

    // Providers are shared. Only notify projects with active services on the failing provider.
    const activeServices = await this.services.listActiveByProject(projectUuid);
    const providers = new Set(activeServices.map((s) => s.providerUuid));
    const since = dayjs().subtract(THROTTLE_HOURS, 'hour').toDate();
    const errorRuns = await this.syncRuns.listErrorsSince(since);
    const seenProviders = new Set<string>();
    for (const run of errorRuns) {
      if (!providers.has(run.providerUuid) || seenProviders.has(run.providerUuid)) continue;
      seenProviders.add(run.providerUuid);
      const html = syncErrorMessage(
        run.provider.name,
        run.error ?? 'unknown error',
        run.provider.loginUrl,
      );
      if (await send(`sync-error:${run.providerUuid}`, html)) sent += 1;
    }
    return sent;
  }

  /** Test sends ignore the enabled switch, but use only this project's saved destination. */
  async sendSamples(projectUuid: string): Promise<number> {
    const config = await this.settings.find(projectUuid);
    if (!config) return 0;
    let sent = 0;
    for (const html of sampleMessages()) {
      if (
        await this.telegram.send(
          `<b>Проект: ${esc(config.project.name)}</b>\n\n${html}`,
          projectUuid,
        )
      )
        sent += 1;
    }
    return sent;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduled(): Promise<void> {
    try {
      await this.checkAndNotify();
    } catch {
      this.logger.error('Notification check failed');
    }
  }

  private async maybeSend(
    projectUuid: string,
    projectName: string,
    key: string,
    html: string,
  ): Promise<boolean> {
    const dedupKey = `project:${projectUuid}:${key}`;
    const since = dayjs().subtract(THROTTLE_HOURS, 'hour').toDate();
    if (await this.notificationLog.wasSentSince(dedupKey, since)) return false;
    const ok = await this.telegram.send(
      `<b>Проект: ${esc(projectName)}</b>\n\n${html}`,
      projectUuid,
      true,
    );
    if (ok) await this.notificationLog.record(dedupKey);
    return ok;
  }
}
