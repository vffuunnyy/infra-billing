import {
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API, API_SUB, CONTROLLERS_INFO, ID_PARAM } from '@infra/shared';
import { NotificationResultDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { ProjectsRepository } from '@repositories/projects/projects.repository';

@ApiTags(CONTROLLERS_INFO.NOTIFICATIONS.TAG)
@ApiBearerAuth()
@Controller(API.NOTIFICATIONS)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly projects: ProjectsRepository,
  ) {}

  /** Run the alert checks now (and report how many messages were sent). */
  @ApiOperation({ summary: 'Run notification checks' })
  @ApiOkResponse({ type: NotificationResultDto })
  @Post(API_SUB.NOTIFICATIONS_CHECK)
  @HttpCode(200)
  async check(@Param(ID_PARAM, ParseUUIDPipe) uuid: string) {
    if (!(await this.projects.exists(uuid))) throw new NotFoundException('Project not found');
    const sent = await this.notifications.checkAndNotify(uuid);
    return { enabled: await this.telegram.isEnabled(uuid), sent };
  }

  /** Send a sample of every notification type (preview formats + verify Telegram config). */
  @ApiOperation({ summary: 'Send sample notifications' })
  @ApiOkResponse({ type: NotificationResultDto })
  @Post(API_SUB.NOTIFICATIONS_TEST)
  @HttpCode(200)
  async test(@Param(ID_PARAM, ParseUUIDPipe) uuid: string) {
    if (!(await this.projects.exists(uuid))) throw new NotFoundException('Project not found');
    const sent = await this.notifications.sendSamples(uuid);
    return { enabled: await this.telegram.isEnabled(uuid), sent };
  }
}
