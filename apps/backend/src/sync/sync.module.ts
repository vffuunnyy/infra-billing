import { Module } from '@nestjs/common';
import { ConnectorsModule } from '@connectors/connectors.module';
import { CurrencyModule } from '../currency/currency.module';
import { BalanceAccrualService } from './balance-accrual.service';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [ConnectorsModule, CurrencyModule],
  controllers: [SyncController],
  providers: [SyncService, BalanceAccrualService],
  exports: [SyncService],
})
export class SyncModule {}
