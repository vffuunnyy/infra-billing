import { IconBrandTelegram, IconLoader2, IconSend } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { Project } from '@infra/shared';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/api/client';
import { useTelegramSettings, useTestTelegram, useUpdateTelegramSettings } from '@/api/settings';
import { useProjects } from '@/api/projects';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PasswordInput } from '@/components/PasswordInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { notifyError, notifySuccess } from '@/utils/notify';

interface TelegramForm {
  notificationsEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  telegramTopicId: string;
  telegramProxyUrl: string;
  upcomingBillingDays: number;
}

export function TelegramSettingsCard() {
  const { data: projects } = useProjects();
  const [selectedProject, setSelectedProject] = useState('');
  const projectUuid = projects?.some((p) => p.uuid === selectedProject)
    ? selectedProject
    : (projects?.[0]?.uuid ?? '');
  // Remount the form on project changes, including write-only token and mutation state.
  return (
    <TelegramProjectSettingsCard
      key={projectUuid}
      projectUuid={projectUuid}
      projects={projects ?? []}
      onProjectChange={setSelectedProject}
    />
  );
}

function TelegramProjectSettingsCard({
  projectUuid,
  projects,
  onProjectChange,
}: {
  projectUuid: string;
  projects: Project[];
  onProjectChange: (uuid: string) => void;
}) {
  const { t } = useTranslation();
  const { data: settings, isError } = useTelegramSettings(projectUuid);
  const updateSettings = useUpdateTelegramSettings(projectUuid);
  const testTelegram = useTestTelegram(projectUuid);

  const { control, register, handleSubmit, reset, setValue } = useForm<TelegramForm>({
    defaultValues: {
      notificationsEnabled: false,
      telegramBotToken: '',
      telegramChatId: '',
      telegramTopicId: '',
      telegramProxyUrl: '',
      upcomingBillingDays: 3,
    },
    mode: 'onSubmit',
  });

  // Re-seed the form when settings load. Token is write-only: never prefilled, the rest are.
  useEffect(() => {
    if (!settings) return;
    reset({
      notificationsEnabled: settings.notificationsEnabled,
      telegramBotToken: '',
      telegramChatId: settings.telegramChatId ?? '',
      telegramTopicId: settings.telegramTopicId ?? '',
      telegramProxyUrl: settings.telegramProxyUrl ?? '',
      upcomingBillingDays: settings.upcomingBillingDays,
    });
  }, [settings, reset]);

  const saveTelegram = handleSubmit(async (v) => {
    try {
      await updateSettings.mutateAsync({
        notificationsEnabled: v.notificationsEnabled,
        telegramBotToken: v.telegramBotToken || undefined, // empty = keep existing
        telegramChatId: v.telegramChatId,
        telegramTopicId: v.telegramTopicId,
        telegramProxyUrl: v.telegramProxyUrl,
        upcomingBillingDays: v.upcomingBillingDays,
      });
      setValue('telegramBotToken', '');
      notifySuccess(t('settings.telegram.saved'));
    } catch (e) {
      notifyError(apiErrorMessage(e));
    }
  });

  const doTestTelegram = async () => {
    try {
      const res = await testTelegram.mutateAsync();
      if (res.sent) notifySuccess(t('settings.telegram.samplesSent', { count: res.sent }));
      else if (!res.enabled) notifyError(t('settings.telegram.notConfiguredError'));
      else notifyError(t('settings.telegram.sendFailed'));
    } catch (e) {
      notifyError(apiErrorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <IconBrandTelegram className="size-5" />
          {t('settings.telegram.title')}
          {settings?.telegramConfigured ? (
            <Badge className="border-transparent bg-success/15 text-[10px] text-success uppercase tracking-wide">
              {t('settings.telegram.tokenSet')}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              {t('settings.telegram.notConfigured')}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-1.5">
          <Label htmlFor="tg-project">{t('settings.telegram.project')}</Label>
          <Select
            value={projectUuid}
            onValueChange={onProjectChange}
            disabled={updateSettings.isPending || testTelegram.isPending || !projects.length}
          >
            <SelectTrigger id="tg-project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.uuid} value={p.uuid}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('settings.telegram.projectDescription')}
          </p>
        </div>
        {isError && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {t('settings.telegram.loadFailed')}
          </p>
        )}
        <form onSubmit={saveTelegram}>
          <fieldset
            disabled={!settings || updateSettings.isPending || testTelegram.isPending}
            className="space-y-4"
          >
            <div className="flex items-start gap-3">
              <Controller
                control={control}
                name="notificationsEnabled"
                render={({ field }) => (
                  <Switch
                    id="tg-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5"
                  />
                )}
              />
              <div className="space-y-1">
                <Label htmlFor="tg-enabled">{t('settings.telegram.enabled')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('settings.telegram.enabledDescription')}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-bot-token">{t('settings.telegram.botToken')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegram.botTokenDescription')}
              </p>
              <PasswordInput
                id="tg-bot-token"
                placeholder={
                  settings?.telegramConfigured
                    ? t('settings.telegram.botTokenPlaceholderSet')
                    : t('settings.telegram.botTokenPlaceholderNew')
                }
                {...register('telegramBotToken')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-chat-id">{t('settings.telegram.chatId')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegram.chatIdDescription')}
              </p>
              <Input
                id="tg-chat-id"
                placeholder={t('settings.telegram.chatIdPlaceholder')}
                {...register('telegramChatId')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-topic-id">{t('settings.telegram.topicId')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegram.topicIdDescription')}
              </p>
              <Input id="tg-topic-id" {...register('telegramTopicId')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-proxy-url">{t('settings.telegram.proxyUrl')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.telegram.proxyUrlDescription')}
              </p>
              <Input
                id="tg-proxy-url"
                placeholder={t('settings.telegram.proxyUrlPlaceholder')}
                {...register('telegramProxyUrl')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tg-upcoming-days">{t('settings.telegram.upcomingBillingDays')}</Label>
              <Input
                id="tg-upcoming-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                {...register('upcomingBillingDays', { valueAsNumber: true })}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testTelegram.isPending}
                onClick={doTestTelegram}
              >
                {testTelegram.isPending ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconSend className="size-4" />
                )}
                {t('settings.telegram.sendSamples')}
              </Button>
              <Button type="submit" disabled={updateSettings.isPending}>
                {updateSettings.isPending && <IconLoader2 className="size-4 animate-spin" />}
                {t('common.save')}
              </Button>
            </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
