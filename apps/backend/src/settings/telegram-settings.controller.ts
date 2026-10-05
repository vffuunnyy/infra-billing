import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { API, API_SUB, CONTROLLERS_INFO, ID_PARAM } from '@infra/shared';
import { TelegramSettingsService } from './telegram-settings.service';
import { TelegramSettingsDto, UpdateTelegramSettingsDto } from './dto/telegram-settings.dto';

// Admin-only, like global settings. AuthGuard denies members unless explicitly opted in.
@ApiBearerAuth()
@ApiTags(CONTROLLERS_INFO.SETTINGS.TAG)
@Controller(API.SETTINGS)
export class TelegramSettingsController {
  constructor(private readonly settings: TelegramSettingsService) {}

  @Get(API_SUB.SETTINGS_TELEGRAM)
  @ApiOperation({ summary: 'Get project Telegram settings' })
  @ApiOkResponse({ type: TelegramSettingsDto })
  get(@Param(ID_PARAM, ParseUUIDPipe) uuid: string) {
    return this.settings.get(uuid);
  }

  @Patch(API_SUB.SETTINGS_TELEGRAM)
  @ApiOperation({ summary: 'Update project Telegram settings' })
  @ApiOkResponse({ type: TelegramSettingsDto })
  update(@Param(ID_PARAM, ParseUUIDPipe) uuid: string, @Body() dto: UpdateTelegramSettingsDto) {
    return this.settings.update(uuid, dto);
  }
}
