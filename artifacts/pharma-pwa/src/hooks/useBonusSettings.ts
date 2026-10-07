import { useCallback, useEffect, useState } from 'react';
import {
  listSettings,
  upsertSetting,
  type SettingRow,
} from '@/lib/bonusFinancialApi';

/**
 * Loads the full `bonus_settings` key/value table (director-managed) and
 * exposes typed accessors + a `save` mutator that upserts and auto-refreshes.
 *
 * Feedback model
 *   The PWA does not mount a global Toaster; existing director pages render
 *   feedback inline (LoadingSpinner / ErrorMessage). This hook therefore
 *   exposes load + save state and lets each component render its own banner.
 *   Call `save(key, value)`; on success `lastSavedKey` flips to `key` (so a
 *   field can show a "saved" tick), and on failure the thrown Error carries
 *   the message.
 */
export interface UseBonusSettingsResult {
  /** All settings rows sorted by key (null while loading / on error). */
  settings: SettingRow[] | null;
  loading: boolean;
  error: string;
  /** True while a `save` write is in flight. */
  saving: boolean;
  /** The key currently being saved (for per-card "saving" indicators). */
  savingKey: string | null;
  /** The key that was most recently saved successfully (for "saved" ticks). */
  lastSavedKey: string | null;
  /** The load error from the most recent save attempt (clears on next save). */
  saveError: string;
  /** Returns the jsonb value for a given key (or `null` if absent). */
  getValue: (key: string) => unknown;
  /** Upserts a single setting; reloads on success. Throws on failure. */
  save: (key: string, value: unknown) => Promise<void>;
  reload: () => Promise<void>;
}

export function useBonusSettings(): UseBonusSettingsResult {
  const [settings, setSettings] = useState<SettingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lastSavedKey, setLastSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setSettings(await listSettings());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل إعدادات البونص');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const getValue = useCallback(
    (key: string): unknown => {
      if (!settings) return null;
      const row = settings.find((s) => s.key === key);
      return row?.value ?? null;
    },
    [settings],
  );

  const save = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      setSaving(true);
      setSavingKey(key);
      setSaveError('');
      setLastSavedKey(null);
      try {
        await upsertSetting(key, value);
        await reload();
        setLastSavedKey(key);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'تعذر حفظ الإعداد';
        console.error(err);
        setSaveError(msg);
        throw err;
      } finally {
        setSaving(false);
        setSavingKey(null);
      }
    },
    [reload],
  );

  return {
    settings,
    loading,
    error,
    saving,
    savingKey,
    lastSavedKey,
    saveError,
    getValue,
    save,
    reload,
  };
}
