import { useQuery } from '@tanstack/react-query';
import type { AnalyticsSummary, BalancePoint, ForecastPoint, ProviderRunway } from '@infra/shared';
import { api } from './client';
import { API_PATH } from '@infra/shared';

export function useSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: async () => (await api.get<AnalyticsSummary>(API_PATH.ANALYTICS.SUMMARY)).data,
  });
}

export function useForecast(months = 12, monthsBack = 3) {
  return useQuery({
    queryKey: ['analytics', 'forecast', months, monthsBack],
    queryFn: async () =>
      (
        await api.get<ForecastPoint[]>(API_PATH.ANALYTICS.FORECAST, {
          params: { months, monthsBack },
        })
      ).data,
  });
}

export function useProviderRunway(uuid?: string) {
  return useQuery({
    queryKey: ['provider-runway', uuid],
    enabled: Boolean(uuid),
    queryFn: async () =>
      (await api.get<ProviderRunway | null>(API_PATH.PROVIDERS.RUNWAY(uuid!))).data,
  });
}

export function useBalanceHistory(uuid?: string) {
  return useQuery({
    queryKey: ['balance-history', uuid],
    enabled: Boolean(uuid),
    queryFn: async () =>
      (await api.get<BalancePoint[]>(API_PATH.PROVIDERS.BALANCE_HISTORY(uuid!))).data,
  });
}
