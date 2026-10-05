import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { TelegramSettingsService } from './telegram-settings.service';
import { TelegramSettingsController } from './telegram-settings.controller';

@Module({
  imports: [SyncModule], // SettingsService re-arms the sync scheduler when the interval changes
  controllers: [SettingsController, TelegramSettingsController],
  providers: [SettingsService, TelegramSettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
