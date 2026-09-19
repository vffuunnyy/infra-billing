import { providerKindAllowsManualBalance } from '@infra/shared';
import { IconKey, IconServer2 } from '@tabler/icons-react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormSection } from '@/components/FormSection';
import { IconAppearanceFields } from '@/components/IconAppearanceFields';
import { DEFAULT_ICON_BG, resolveTablerIcon } from '@/components/tablerIconCatalog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CURRENCY_OPTIONS } from '@/constants';
import { trimMoney } from '@/utils/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProviderCredentialFields } from './ProviderCredentialFields';
import { DEFAULT_LOGIN_URLS, type FormValues } from './providerForm';

export type StoredSecretFlags = {
  hasToken?: boolean;
  hasPassword?: boolean;
  hasTotpSecret?: boolean;
  hasApiPassword?: boolean;
  hasSecretKey?: boolean;
};

interface ProviderFormFieldsProps {
  form: UseFormReturn<FormValues>;
  editing: boolean;
  kindOptions: { value: string; label: string }[];
  // Passed in edit mode so Yandex discovery can reuse the stored key.
  providerUuid?: string;
  storedSecrets?: StoredSecretFlags;
}

// The provider form body, shared by the create modal and the detail modal (editing mode).
export function ProviderFormFields({
  form,
  editing,
  kindOptions,
  providerUuid,
  storedSecrets,
}: ProviderFormFieldsProps) {
  const { t } = useTranslation();
  const nameError = form.formState.errors.name;
  const kind = form.watch('kind');
  const previewName = form.watch('name');
  const iconName = form.watch('iconName');
  const iconBg = form.watch('iconBg');
  const manualBalance = form.watch('manualBalance');
  const balanceError = form.formState.errors.balance;
  const HeaderIcon = resolveTablerIcon(iconName) ?? IconServer2;
  return (
    <>
      <FormSection
        icon={HeaderIcon}
        iconBg={iconName ? iconBg || DEFAULT_ICON_BG : null}
        title={t('providers.section.main')}
      >
        <div className="space-y-2">
          <Label htmlFor="provider-name">
            {t('providers.field.name')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="provider-name"
            aria-invalid={nameError ? true : undefined}
            {...form.register('name', {
              validate: (v) => (v.trim() ? true : t('validation.enterName')),
            })}
          />
          {nameError && <p className="text-xs text-destructive">{nameError.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="provider-kind">{t('providers.field.type')}</Label>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  // Keep the cabinet link in sync with the kind until the owner types their own
                  // (the select is disabled when editing, so this only runs on create).
                  const url = form.getValues('loginUrl');
                  if (!url || url === DEFAULT_LOGIN_URLS[field.value]) {
                    form.setValue('loginUrl', DEFAULT_LOGIN_URLS[v] ?? '');
                  }
                  field.onChange(v);
                }}
                disabled={editing}
              >
                <SelectTrigger id="provider-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="provider-login-url">{t('providers.field.loginUrl')}</Label>
          <p className="text-xs text-muted-foreground">{t('providers.field.loginUrlDesc')}</p>
          <Input
            id="provider-login-url"
            placeholder="https://my.example.com"
            aria-invalid={form.formState.errors.loginUrl ? true : undefined}
            {...form.register('loginUrl', {
              // The backend rejects non-URLs with an opaque 400 — explain it before submit.
              validate: (v) => {
                if (!v.trim()) return true;
                try {
                  const u = new URL(v);
                  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
                  return true;
                } catch {
                  return t('providers.err.loginUrlInvalid');
                }
              },
            })}
          />
          {form.formState.errors.loginUrl && (
            <p className="text-xs text-destructive">{form.formState.errors.loginUrl.message}</p>
          )}
        </div>
        <IconAppearanceFields
          previewName={previewName}
          iconName={iconName}
          iconBg={iconBg}
          onIconNameChange={(v) => form.setValue('iconName', v, { shouldDirty: true })}
          onIconBgChange={(v) => form.setValue('iconBg', v, { shouldDirty: true })}
        />
        <Controller
          control={form.control}
          name="isPostpaid"
          render={({ field }) => (
            <div className="flex items-start gap-2">
              <Checkbox
                id="provider-postpaid"
                checked={field.value}
                onCheckedChange={(c) => field.onChange(c === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="provider-postpaid">{t('providers.field.isPostpaid')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('providers.field.isPostpaidDesc')}
                </p>
              </div>
            </div>
          )}
        />
        {providerKindAllowsManualBalance(kind) && (
          <>
            <Controller
              control={form.control}
              name="manualBalance"
              render={({ field }) => (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="provider-manual-balance"
                    checked={field.value}
                    onCheckedChange={(c) => field.onChange(c === true)}
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="provider-manual-balance">
                      {t('providers.field.manualBalance')}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t('providers.field.manualBalanceDesc')}
                    </p>
                  </div>
                </div>
              )}
            />
            {manualBalance && (
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="provider-balance">
                    {t('providers.field.balance')} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="provider-balance"
                    inputMode="decimal"
                    aria-invalid={balanceError ? true : undefined}
                    {...form.register('balance', {
                      validate: (v) => {
                        if (!form.getValues('manualBalance')) return true;
                        if (!v.trim()) return t('providers.err.balanceRequired');
                        return /^-?\d+(\.\d{1,2})?$/.test(v.trim())
                          ? true
                          : t('providers.err.balanceFormat');
                      },
                      onBlur: (e) =>
                        form.setValue('balance', trimMoney(e.target.value), {
                          shouldDirty: true,
                        }),
                    })}
                  />
                  {balanceError && (
                    <p className="text-xs text-destructive">{balanceError.message}</p>
                  )}
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="provider-balance-currency">
                    {t('providers.field.balanceCurrency')}
                  </Label>
                  <Controller
                    control={form.control}
                    name="balanceCurrency"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="provider-balance-currency" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCY_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </FormSection>

      {/* Manual providers have no credentials — skip the empty section shell. */}
      {kind !== 'manual' && (
        <FormSection icon={IconKey} title={t('providers.section.credentials')}>
          {/* Keyed by provider: switching rows remounts the inputs, so a reveal still in flight
              for the previous provider can never resolve into this one's form. */}
          <ProviderCredentialFields
            key={providerUuid ?? 'new'}
            form={form}
            providerUuid={providerUuid}
            storedSecrets={storedSecrets}
          />
        </FormSection>
      )}
    </>
  );
}
