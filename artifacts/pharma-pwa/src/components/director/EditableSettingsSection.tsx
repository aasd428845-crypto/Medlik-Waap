import { Fragment, useCallback, useMemo, useState } from 'react';
import { SettingsCategoryCard } from '@/components/director/SettingsCategoryCard';
import {
  SETTINGS_BY_KEY,
  type SettingSectionMeta,
} from '@/lib/bonusSettingsRegistry';
import { useBonusSettings } from '@/hooks/useBonusSettings';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

export interface EditableSettingsSectionProps {
  /** Page heading shown above the cards. */
  title: string;
  /** Optional sub-heading / description. */
  description?: string;
  /** Registry keys rendered as cards on this section. */
  keys: string[];
  /** Fallback message shown when the DB has extra unknown keys worth a glance. */
  showUnmodelled?: boolean;
}

/**
 * Shared scaffolding for the editable settings sections (General, Cash
 * Withdrawal, Redemption, Order Discount, Cancellation, Expiration).
 *
 * Loads the settings table once via `useBonusSettings`, maps each requested
 * registry key to its `<SettingsCategoryCard>`, and wires the save callback.
 * Cards that model a key absent from the DB are still rendered (the user can
 * create the row via the upsert path).
 */
export function EditableSettingsSection({
  title,
  description,
  keys,
  showUnmodelled,
}: EditableSettingsSectionProps) {
  const { settings, loading, error, getValue, save, savingKey, lastSavedKey, saveError } =
    useBonusSettings();
  const [localSaveError, setLocalSaveError] = useState<string>('');

  const metas = useMemo(
    () => keys.map((k) => SETTINGS_BY_KEY[k]).filter(Boolean) as SettingSectionMeta[],
    [keys],
  );

  const handleSave = useCallback(
    async (meta: SettingSectionMeta, value: unknown) => {
      setLocalSaveError('');
      try {
        await save(meta.key, value);
      } catch (err) {
        setLocalSaveError(
          err instanceof Error ? err.message : 'تعذر حفظ هذا الإعداد.',
        );
      }
    },
    [save],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <LoadingSpinner />
        <span>جارٍ تحميل الإعدادات…</span>
      </div>
    );
  }
  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Keys present in the DB that we don't model here (transparency, not editing).
  const unmodelled = showUnmodelled
    ? (settings ?? []).filter((r) => !SETTINGS_BY_KEY[r.key] && !r.key.startsWith('accounting_policy'))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>

      <div className="space-y-6">
        {metas.map((meta) => {
          const current = getValue(meta.key);
          return (
          <SettingsCategoryCard
            key={meta.key}
            section={meta}
            value={current}
            saving={savingKey === meta.key}
            saved={lastSavedKey === meta.key && savingKey === null}
            saveError={localSaveError}
            onSave={handleSave}
          />
          );
        })}

        {metas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            لا توجد إعدادات مُعرّفة في هذا القسم بعد.
          </p>
        )}
      </div>

      {unmodelled.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
          <p className="text-xs font-medium text-amber-800">
            مفاتيح إعدادات غير مُنمذجة تم اكتشافها في قاعدة البيانات:
          </p>
          <ul className="mt-1 list-disc list-inside text-xs text-amber-800">
            {unmodelled.map((u) => (
              <li key={u.key}>{u.key}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
