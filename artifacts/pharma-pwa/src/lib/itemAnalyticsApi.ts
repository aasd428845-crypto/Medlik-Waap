import { supabase } from '@/lib/supabaseClient';

// Analytics based on the ACTUAL schema (migrations 0001-0002 of the Flutter
// project, verified against the live database):
//   order_items(id, order_id, product_id, quantity, unit_price, is_bonus, created_at)
//   orders(id, status['pending'|'assigned'|'in_progress'|'delivered'|'cancelled'], created_at)
//   products(id, name, name_en, category, unit, is_active)
//   inventory(branch_id, product_id, quantity)

export interface TopProduct {
  productId: string;
  name: string;
  totalQty: number;
  orderCount: number;
}

export interface StagnantProduct {
  productId: string;
  name: string;
  totalAvailableQty: number;
  lastRequestAt: string | null; // null = لم يُطلب مطلقاً
  neverRequested: boolean;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function measure(query: any): Promise<any[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

// ── الأكثر طلباً: مجموع الكميات المطلوبة لكل صنف خلال آخر N يوماً ─────────
export async function fetchTopRequested(days: number, limit = 10): Promise<TopProduct[]> {
  const since = isoDaysAgo(days);

  // خطوط الطلب مع طلبها الأصلي (join داخلي) خلال الفترة وغير الملغاة.
  const rows = await measure(
    supabase
      .from('order_items')
      .select('product_id, quantity, order_id, orders!inner(status, created_at)')
      .filter('orders.created_at', 'gte', since)
      .neq('orders.status', 'cancelled'),
  );

  const agg = new Map<string, { totalQty: number; orderIds: Set<string> }>();
  for (const row of rows) {
    const pid = row.product_id as string;
    if (!pid) continue;
    const qty = Number(row.quantity ?? 0);
    if (!agg.has(pid)) agg.set(pid, { totalQty: 0, orderIds: new Set() });
    const entry = agg.get(pid)!;
    entry.totalQty += qty;
    if (row.order_id) entry.orderIds.add(row.order_id as string);
  }

  if (agg.size === 0) return [];

  const sorted = [...agg.entries()].sort((a, b) => b[1].totalQty - a[1].totalQty).slice(0, limit);

  // اسم الصنف من جدول products
  const names = await fetchProductNames(sorted.map(([pid]) => pid));
  return sorted.map(([pid, entry]) => ({
    productId: pid,
    name: names.get(pid) ?? 'غير معروف',
    totalQty: entry.totalQty,
    orderCount: entry.orderIds.size,
  }));
}

// ── الأصناف الراكدة: متوفرة بالمخزون ولم تُطلب خلال آخر N يوماً ────────────
export async function fetchStagnantProducts(days: number): Promise<StagnantProduct[]> {
  const since = isoDaysAgo(days);

  // 1) الأصناف المتوفرة في أي فرع (quantity > 0)
  const invRows = await measure(
    supabase.from('inventory').select('product_id, quantity'),
  );
  const availableByProduct = new Map<string, number>();
  for (const row of invRows) {
    const pid = row.product_id as string;
    const qty = Number(row.quantity ?? 0);
    if (!pid || qty <= 0) continue;
    availableByProduct.set(pid, (availableByProduct.get(pid) ?? 0) + qty);
  }
  if (availableByProduct.size === 0) return [];

  const candidateIds = [...availableByProduct.keys()];

  // 2) الأصناف التي طُلبت خلال الفترة (حتى نستبعدها)
  const requestedRecently = new Set<string>();
  for (const chunk of chunkify(candidateIds)) {
    const rows = await measure(
      supabase
        .from('order_items')
        .select('product_id, orders!inner(status, created_at)')
        .in('product_id', chunk)
        .filter('orders.created_at', 'gte', since)
        .neq('orders.status', 'cancelled'),
    );
    for (const row of rows) requestedRecently.add((row as { product_id: string }).product_id);
  }

  const stagnantIds = candidateIds.filter((pid) => !requestedRecently.has(pid));
  if (stagnantIds.length === 0) return [];

  // 3) آخر مرة طُلبت فيها (كل الفترات) لكل صنف راكد
  const lastRequest = new Map<string, string>();
  const requestedProducts = new Set<string>();
  for (const chunk of chunkify(stagnantIds)) {
    const rows = await measure(
      supabase
        .from('order_items')
        .select('product_id, created_at, orders!inner(created_at)')
        .in('product_id', chunk)
        .neq('orders.status', 'cancelled'),
    );
    for (const row of rows) {
      const pid = row.product_id as string;
      requestedProducts.add(pid);
      const ts = (row.created_at ?? row.orders?.created_at ?? '') as string;
      if (ts && (!lastRequest.has(pid) || ts > lastRequest.get(pid)!)) {
        lastRequest.set(pid, ts);
      }
    }
  }

  // 4) أسماء الأصناف
  const names = await fetchProductNames(stagnantIds);

  const result: StagnantProduct[] = stagnantIds.map((pid) => ({
    productId: pid,
    name: names.get(pid) ?? 'غير معروف',
    totalAvailableQty: availableByProduct.get(pid) ?? 0,
    lastRequestAt: lastRequest.get(pid) ?? null,
    neverRequested: !requestedProducts.has(pid),
  }));

  result.sort((a, b) => b.totalAvailableQty - a.totalAvailableQty);
  return result;
}

function chunkify(ids: string[], chunkSize = 100): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchProductNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const chunk of chunkify(ids)) {
    const rows = await measure(
      supabase.from('products').select('id, name, unit').in('id', chunk),
    );
    for (const row of rows) {
      const unit = (row.unit ?? '') as string;
      names.set(row.id as string, unit ? `${row.name} (${unit})` : (row.name as string));
    }
  }
  return names;
}