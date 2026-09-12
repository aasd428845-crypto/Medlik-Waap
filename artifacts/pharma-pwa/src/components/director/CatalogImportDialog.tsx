import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react';
import {
  CatalogImportRow,
  CatalogImportValues,
  catalogImportColumnLabel,
  parseCatalogImportFile,
} from '@/lib/catalogImport';

interface CatalogImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (rows: CatalogImportValues[]) => Promise<void>;
}

export function CatalogImportDialog({ isOpen, onClose, onConfirm }: CatalogImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CatalogImportRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setFileName('');
      setRows([]);
      setParseError('');
      setConfirmError('');
      setIsReading(false);
      setIsImporting(false);
    }
  }, [isOpen]);

  const validRows = useMemo(() => rows.filter((row) => row.errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter((row) => row.errors.length > 0), [rows]);

  if (!isOpen) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setRows([]);
    setParseError('');
    setConfirmError('');
    setIsReading(true);
    try {
      setRows(await parseCatalogImportFile(file));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'تعذر قراءة الملف');
    } finally {
      setIsReading(false);
      event.target.value = '';
    }
  };

  const handleConfirm = async () => {
    if (validRows.length === 0) return;
    setConfirmError('');
    setIsImporting(true);
    try {
      await onConfirm(validRows.map((row) => row.values));
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : 'تعذر استيراد المنتجات');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <div className="my-8 flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/20 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              استيراد منتجات Excel / CSV
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">راجع الصفوف والأخطاء قبل إدراجها أو تحديثها حسب SKU.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} className="hidden" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 bg-primary/5 px-4 py-6 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
          >
            <Upload className="h-5 w-5" />
            {fileName || 'اختر ملف Excel أو CSV'}
          </button>

          {isReading && <p className="text-sm text-muted-foreground">جارٍ قراءة الملف...</p>}
          {parseError && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">{parseError}</div>}

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <p className="text-xs text-muted-foreground">صفوف صحيحة</p>
                  <p className="mt-1 text-2xl font-extrabold text-emerald-600">{validRows.length}</p>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-xs text-muted-foreground">صفوف بها أخطاء</p>
                  <p className="mt-1 text-2xl font-extrabold text-amber-600">{invalidRows.length}</p>
                </div>
                <div className="col-span-2 rounded-xl border border-border bg-muted/20 p-3 sm:col-span-1">
                  <p className="text-xs text-muted-foreground">الإجمالي</p>
                  <p className="mt-1 text-2xl font-extrabold">{rows.length}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[760px] text-right text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">الصف</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">الاسم التجاري</th>
                      <th className="px-3 py-2">الشكل</th>
                      <th className="px-3 py-2">السعر</th>
                      <th className="px-3 py-2">النتيجة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.slice(0, 12).map((row) => (
                      <tr key={row.rowNumber} className={row.errors.length > 0 ? 'bg-destructive/5' : ''}>
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2 font-mono">{row.values.sku || '—'}</td>
                        <td className="px-3 py-2">{row.values.commercial_name || '—'}</td>
                        <td className="px-3 py-2">{row.values.dosage_form || '—'}</td>
                        <td className="px-3 py-2">{row.values.price}</td>
                        <td className="px-3 py-2">
                          {row.errors.length > 0 ? (
                            <span className="flex items-start gap-1 font-semibold text-destructive">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {row.errors.join('، ')}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> صالح</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 12 && <p className="text-xs text-muted-foreground">يتم عرض أول 12 صفًا فقط، وسيتم فحص جميع الصفوف قبل التأكيد.</p>}
              {invalidRows.length > 0 && <p className="rounded-lg bg-amber-500/10 p-3 text-xs font-semibold text-amber-700">لن تُدرج الصفوف التي بها أخطاء. صححها في الملف وأعد اختياره، أو استورد الصفوف الصحيحة فقط.</p>}
            </>
          )}

          {confirmError && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">{confirmError}</div>}
        </div>

        <div className="flex justify-end gap-3 border-t border-border bg-muted/10 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">إلغاء</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={validRows.length === 0 || isReading || isImporting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? 'جارٍ الاستيراد...' : `تأكيد استيراد ${validRows.length} صف`}
          </button>
        </div>
      </div>
    </div>
  );
}