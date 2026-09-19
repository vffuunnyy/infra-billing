import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { API, API_SUB, CONTROLLERS_INFO, ID_PARAM } from '@infra/shared';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { BalanceHistoryQueryDto, BalancePointDto, ProviderRunwayDto } from './dto/analytics.dto';

@ApiTags(CONTROLLERS_INFO.BALANCE_HISTORY.TAG)
@ApiBearerAuth()
@Controller(API.PROVIDERS)
export class BalanceHistoryController {
  constructor(private readonly analytics: AnalyticsService) {}

  @ApiOperation({ summary: 'Get provider balance history' })
  @ApiOkResponse({ type: [BalancePointDto] })
  @Get(API_SUB.PROVIDER_BALANCE_HISTORY)
  history(@Param(ID_PARAM, ParseUUIDPipe) uuid: string, @Query() query: BalanceHistoryQueryDto) {
    return this.analytics.balanceHistory(uuid, query.from, query.to);
  }

  @ApiOperation({ summary: 'Estimate how long the provider balance lasts at current spend' })
  @ApiOkResponse({ type: ProviderRunwayDto })
  @Get(API_SUB.PROVIDER_RUNWAY)
  runway(@Param(ID_PARAM, ParseUUIDPipe) uuid: string) {
    return this.analytics.providerRunway(uuid);
  }
}
