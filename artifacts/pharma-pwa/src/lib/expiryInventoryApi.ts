import { supabase } from '@/lib/supabaseClient';

// Stock batch row as stored in public.warehouse_inventory (snake_case),
// with product + branch names joined.
export interface WarehouseRow {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
  expiry_date: string | null;
  unit_price: number | null;
  catalog_price: number | null;
  days_left: number | null; // أيام متبقية حتى انتهاء الصلاحية (سالبة = منتهي)
  value: number; // الكمية × السعر الفعّال
}

export type ExpiryBucket = 30 | 60 | 90;

function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = parseDateOnly(iso);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

export function bucketOf(days: number | null): ExpiryBucket | null {
  if (days == null) return null;
  if (days <= 30) return 30;
  if (days <= 60) return 60;
  if (days <= 90) return 90;
  return null;
}

export async function listWarehouseInventory(): Promise<WarehouseRow[]> {
  const { data, error } = await supabase
    .from('warehouse_inventory')
    .select('*, products(name, unit_price), branches(name)')
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const product = row.products as Record<string, unknown> | null;
    const branch = row.branches as Record<string, unknown> | null;
    const qty = (row.quantity as number) ?? 0;
    const unitPrice = (row.unit_price as number) ?? null;
    const catalogPrice = (product?.unit_price as number) ?? null;
    const price = unitPrice ?? catalogPrice ?? 0;
    return {
      id: row.id as string,
      branch_id: (row.branch_id as string) ?? null,
      branch_name: (branch?.name as string) ?? null,
      product_id: (row.product_id as string) ?? null,
      product_name: (product?.name as string) ?? null,
      quantity: qty,
      expiry_date: (row.expiry_date as string) ?? null,
      unit_price: unitPrice,
      catalog_price: catalogPrice,
      days_left: daysUntil((row.expiry_date as string) ?? null),
      value: qty * price,
    };
  });
}

// تصدير CSV (مع BOM لدعم العربية في Excel)
export function exportExpiryCsv(filename: string, rows: WarehouseRow[]): void {
  const header = [
    'اسم الصنف',
    'الفرع',
    'الكمية المتبقية',
    'تاريخ الانتهاء',
    'الأيام المتبقية',
    'سعر الوحدة',
    'القيمة المالية',
  ];
  const lines = rows.map((r) => [
    r.product_name ?? '',
    r.branch_name ?? '',
    r.quantity,
    r.expiry_date ?? '',
    r.days_left ?? '',
    r.unit_price ?? r.catalog_price ?? '',
    r.value.toFixed(2),
  ]);
  const escape = (c: unknown) => `"${String(c).replace(/"/g, '""')}"`;
  const csv =
    '\uFEFF' +
    [header, ...lines].map((l) => l.map(escape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}