import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Settings,
  UpdateSettings,
  TelegramSettings,
  UpdateTelegramSettings,
} from '@infra/shared';
import { api } from './client';
import { API_PATH } from '@infra/shared';

export function useSettings(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Settings>(API_PATH.SETTINGS)).data,
    enabled: opts?.enabled ?? true,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: UpdateSettings) =>
      (await api.patch<Settings>(API_PATH.SETTINGS, dto)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      // Forecast series depends on tariff-backfill flags.
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useTelegramSettings(projectUuid: string) {
  return useQuery({
    queryKey: ['telegram-settings', projectUuid],
    queryFn: async () =>
      (await api.get<TelegramSettings>(API_PATH.TELEGRAM_SETTINGS(projectUuid))).data,
    enabled: !!projectUuid,
  });
}

export function useUpdateTelegramSettings(projectUuid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: UpdateTelegramSettings) =>
      (await api.patch<TelegramSettings>(API_PATH.TELEGRAM_SETTINGS(projectUuid), dto)).data,
    onSuccess: (settings) => {
      qc.setQueryData(['telegram-settings', projectUuid], settings);
    },
  });
}

/** Send a sample of every notification type (preview formats + verify token/chat). `sent` = count. */
export function useTestTelegram(projectUuid: string) {
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ enabled: boolean; sent: number }>(API_PATH.NOTIFICATIONS.TEST(projectUuid)))
        .data,
  });
}
