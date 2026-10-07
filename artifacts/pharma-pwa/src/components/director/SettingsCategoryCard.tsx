import { useState, useEffect, useCallback } from 'react';
import { Check, Save } from 'lucide-react';
import type { SettingSectionMeta, SettingField, FieldKind } from '@/lib/bonusSettingsRegistry';
import { ErrorMessage } from '@/components/ErrorMessage';

const FIELD_LABELS: Record<FieldKind, string> = {
  toggle: 'تفعيل/تعطيل',
  text: 'نص',
  number: 'رقم',
  select: 'اختيار',
  currency: 'مبلغ',
  json: 'JSON',
};

function getPathValue(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object' && seg in acc) {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, value);
}

function setPathValue(value: unknown, path: string, next: unknown): unknown {
  if (!path) return next;
  const segs = path.split('.');
  const root: unknown = Array.isArray(value)
    ? [...(value as unknown[])]
    : { ...(value ? (value as Record<string, unknown>) : {}) };
  let cur: Record<string, unknown> = root as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const existing = cur[s];
    if (existing && typeof existing === 'object' && existing !== null) {
      cur[s] = { ...(existing as Record<string, unknown>) };
    } else {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = next;
  return root;
}

function renderField(field: SettingField, draft: unknown, onChange: (field: SettingField, value: unknown) => void) {
  const raw = getPathValue(draft, field.path);
  switch (field.kind) {
    case 'toggle': {
      const checked = !!raw;
      return (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(field, e.target.checked)}
            className="h-5 w-5 rounded border-primary"
          />
          <span className="text-sm font-medium">{field.label}</span>
        </label>
      );
    }
    case 'select':
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{field.label}</label>
          <select
            value={raw == null ? '' : String(raw)}
            onChange={(e) => onChange(field, e.target.value || null)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      );
    case 'number':
    case 'currency':
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{field.label}</label>
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={raw == null || raw === '' ? '' : Number(raw)}
            onChange={(e) => {
              const v = e.target.value;
              onChange(field, v === '' ? null : Number(v));
            }}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
            placeholder={field.hint}
          />
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      );
    case 'text':
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{field.label}</label>
          <input
            type="text"
            value={raw == null ? '' : String(raw)}
            onChange={(e) => onChange(field, e.target.value === '' ? null : e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
            placeholder={field.hint}
          />
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      );
    case 'json':
      return (
        <div className="space-y-1">
          <label className="text-sm font-medium">{field.label}</label>
          <textarea
            value={raw == null ? '' : JSON.stringify(raw, null, 2)}
            onChange={(e) => onChange(field, parseJson(e.target.value))}
            rows={4}
            className="w-full font-mono text-xs border rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary"
            dir="ltr"
            placeholder={field.hint ?? '{}'}
          />
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      );
    default:
      return null;
  }
}

function parseJson(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return s;
  }
}

export interface SettingsCategoryCardProps {
  section: SettingSectionMeta;
  /** Current value for section.key (may be null if the row has no value). */
  value: unknown;
  saving: boolean;
  saved: boolean;
  saveError: string;
  onSave: (section: SettingSectionMeta, value: unknown) => void;
}

/**
 * Renders a single `bonus_settings` key as a self-contained editable card,
 * driven entirely by the metadata in `SetttingSectionMeta`. Reused by every
 * editable settings section page.
 */
export function SettingsCategoryCard({
  section,
  value,
  saving,
  saved,
  saveError,
  onSave,
}: SettingsCategoryCardProps) {
  const [draft, setDraft] = useState<unknown>(value);

  // Reset the draft only when the underlying value changes (e.g. after a
  // successful save reloads), not while the user is editing.
  const valueKey = JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(value); }, [valueKey]);

  const handleChange = useCallback(
    (field: SettingField, next: unknown) => {
      setDraft((prev: unknown) => setPathValue(prev, field.path, next));
    },
    [],
  );

  const handleSave = () => {
    onSave(section, draft);
  };

  const isScalar = section.fields.length === 1 && section.fields[0]!.path === '';

  return (
    <div className="border rounded-xl p-5 bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-bold text-lg">{section.title}</h3>
          {section.description && (
            <p className="text-sm text-muted-foreground">{section.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-lg hover:bg-muted disabled:opacity-60"
          aria-label={`حفظ ${section.title}`}
        >
          {saving ? 'جارٍ الحفظ...' : saved ? <><Check className="w-4 h-4" /> حفظ</> : <><Save className="w-4 h-4" /> حفظ</>}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {section.fields.map((f, i) => (
          <div key={f.path || `field-${i}`} className="space-y-1">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              {FIELD_LABELS[f.kind]}
            </div>
            {renderField(f, draft, handleChange)}
          </div>
        ))}
      </div>

      {saveError && <ErrorMessage message={saveError} />}
    </div>
  );
}
