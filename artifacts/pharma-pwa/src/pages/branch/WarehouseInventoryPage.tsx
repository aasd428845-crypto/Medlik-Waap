import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Search, RefreshCw, XCircle } from 'lucide-react';

interface InventoryRow {
  sku: string;
  commercialName: string;
  scientificName: string;
  dosageForm: string;
  availableQuantity: number;
  expiryDate?: string;
  hasRecord: boolean;
}

export function WarehouseInventoryPage() {
  const { userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [editingRow, setEditingRow] = useState<InventoryRow | null>(null);
  const [newQty, setNewQty] = useState(0);
  const [newExpiry, setNewExpiry] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchData(); }, [userProfile?.branchId]);

  const fetchData = async () => {
    if (!userProfile?.branchId) return;
    try {
      setLoading(true);

      // Fetch active products
      const { data: pData, error: pErr } = await supabase
        .from('products')
        .select('sku, commercial_name, scientific_name, dosage_form')
        .eq('is_active', true);
      if (pErr) throw pErr;

      // Fetch branch inventory
      const { data: iData, error: iErr } = await supabase
        .from('warehouse_inventory')
        .select('sku, available_quantity, expiry_date')
        .eq('branch_id', userProfile.branchId);
      if (iErr) throw iErr;

      const invMap = new Map<string, { qty: number; expiry?: string }>();
      for (const row of (iData ?? [])) {
        invMap.set(row.sku ?? '', {
          qty: row.available_quantity ?? 0,
          expiry: row.expiry_date ?? undefined,
        });
      }

      const rows: InventoryRow[] = (pData ?? []).map(p => {
        const inv = invMap.get(p.sku ?? '');
        return {
          sku: p.sku ?? '',
          commercialName: p.commercial_name ?? '',
          scientificName: p.scientific_name ?? '',
          dosageForm: p.dosage_form ?? '',
          availableQuantity: inv?.qty ?? 0,
          expiryDate: inv?.expiry ?? '',
          hasRecord: !!inv,
        };
      });

      setInventory(rows);
    } catch {
      setError('تعذر جلب المخزون');
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (row: InventoryRow) => {
    setEditingRow(row);
    setNewQty(row.availableQuantity);
    setNewExpiry(row.expiryDate || '');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRow || !userProfile?.branchId) return;
    setSaving(true);
    try {
      const { error: err } = await supabase
        .from('warehouse_inventory')
        .upsert(
          {
            branch_id: userProfile.branchId,
            sku: editingRow.sku,
            name: editingRow.commercialName,
            dosage_form: editingRow.dosageForm,
            available_quantity: newQty,
            expiry_date: newExpiry || null,
          },
          { onConflict: 'branch_id,sku' }
        );
      if (err) throw err;

      setInventory(inventory.map(r =>
        r.sku === editingRow.sku
          ? { ...r, availableQuantity: newQty, expiryDate: newExpiry, hasRecord: true }
          : r
      ));
      setEditingRow(null);
    } catch {
      alert('خطأ أثناء تحديث الكمية');
    } finally {
      setSaving(false);
    }
  };

  const filtered = inventory.filter(r => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return r.commercialName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s);
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">مخزون المستودع</h2>
          <p className="text-muted-foreground text-sm">مراجعة وتحديث كميات المنتجات المتوفرة</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث بالاسم أو الباركود..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 border rounded-lg bg-card text-sm focus:ring-2 focus:ring-primary shadow-sm"
          />
        </div>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden flex flex-col max-h-[70vh]">
        <div className="overflow-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3">الاسم التجاري / SKU</th>
                <th className="px-4 py-3">الشكل الدوائي</th>
                <th className="px-4 py-3 text-center">الكمية المتاحة</th>
                <th className="px-4 py-3 text-center">تاريخ الانتهاء</th>
                <th className="px-4 py-3 text-center">تحديث</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(row => {
                const isLow = row.availableQuantity < 10;
                return (
                  <tr key={row.sku} className={`hover:bg-muted/30 transition-colors ${isLow ? 'bg-red-50/10' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.commercialName}</div>
                      <div className="text-xs text-muted-foreground font-mono">{row.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.dosageForm}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full font-bold text-xs ${isLow ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {row.availableQuantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground" dir="ltr">{row.expiryDate || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openEdit(row)}
                        className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors inline-flex"
                        title="تحديث الكمية"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">تحديث الكمية</h3>
              <button onClick={() => setEditingRow(null)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg border mb-4">
                <p className="font-medium text-sm text-foreground">{editingRow.commercialName}</p>
                <p className="text-xs text-muted-foreground font-mono">{editingRow.sku}</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">الكمية المتاحة فعلياً</label>
                <input
                  type="number"
                  min="0"
                  required
                  className="w-full border rounded-lg px-3 py-2 text-center text-lg font-bold focus:ring-2 focus:ring-primary bg-background"
                  value={newQty}
                  onChange={e => setNewQty(parseInt(e.target.value) || 0)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">تاريخ الانتهاء</label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary bg-background text-sm"
                  value={newExpiry}
                  onChange={e => setNewExpiry(e.target.value)}
                />
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => setEditingRow(null)} className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted transition-colors">
                  إلغاء
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {saving ? 'جاري الحفظ...' : 'حفظ التحديث'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
