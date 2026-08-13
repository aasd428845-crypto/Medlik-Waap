import { supabase } from '@/lib/supabaseClient';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';

// Driver row as stored in public.users (schema: migrations 0001-0008).
export interface DriverRow {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  account_status: string;
  created_at: string;
}

export interface DriverBranchGroup {
  branchId: string | null;
  branchName: string;
  activeCount: number;
  drivers: DriverRow[];
  deliveredByDriver: Record<string, number>;
}

// ── Read-only stats; all reads allowed by RLS (company_director) ──────────
export async function fetchDriversWithStats(): Promise<{
  groups: DriverBranchGroup[];
  totalDrivers: number;
  totalActive: number;
  leastCovered: { branchName: string; activeCount: number } | null;
}> {
  // 1) All drivers
  const { data: drivers, error: driversErr } = await supabase
    .from('users')
    .select('id, name, email, phone, branch_id, branch_name, account_status, created_at')
    .eq('role', 'driver')
    .order('created_at', { ascending: false });
  if (driversErr) throw new Error(driversErr.message);
  const allDrivers = (drivers ?? []) as unknown as DriverRow[];

  // 2) Completed (delivered) orders per driver — schema 0002: status='delivered',
  //    assigned_driver_id links the order to its driver.
  const { data: delivered, error: ordersErr } = await supabase
    .from('orders')
    .select('assigned_driver_id')
    .eq('status', 'delivered')
    .not('assigned_driver_id', 'is', null);
  if (ordersErr) throw new Error(ordersErr.message);

  const deliveredByDriver: Record<string, number> = {};
  for (const row of delivered ?? []) {
    const id = (row as { assigned_driver_id: string }).assigned_driver_id;
    deliveredByDriver[id] = (deliveredByDriver[id] ?? 0) + 1;
  }

  // 3) Branches for fallback display names
  let branches: BranchRow[] = [];
  try {
    branches = await listBranches();
  } catch {
    branches = [];
  }
  const branchNameOf = (dr: DriverRow): string =>
    dr.branch_name ||
    branches.find((b) => b.id === dr.branch_id)?.name ||
    '';

  // 4) Group drivers by branch
  const map = new Map<string, DriverBranchGroup>();
  for (const dr of allDrivers) {
    const key = dr.branch_id ?? '__none__';
    if (!map.has(key)) {
      map.set(key, {
        branchId: dr.branch_id,
        branchName: key === '__none__' ? 'بدون فرع' : branchNameOf(dr),
        activeCount: 0,
        drivers: [],
        deliveredByDriver: {},
      });
    }
    const group = map.get(key)!;
    group.drivers.push(dr);
    if (dr.account_status === 'active') group.activeCount += 1;
    group.deliveredByDriver[dr.id] = deliveredByDriver[dr.id] ?? 0;
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.branchId === null) return 1;
    if (b.branchId === null) return -1;
    return a.branchName.localeCompare(b.branchName, 'ar');
  });

  const totalDrivers = allDrivers.length;
  const totalActive = allDrivers.filter((d) => d.account_status === 'active').length;

  let leastCovered: { branchName: string; activeCount: number } | null = null;
  for (const g of groups) {
    if (g.branchId === null) continue;
    if (!leastCovered || g.activeCount < leastCovered.activeCount) {
      leastCovered = { branchName: g.branchName, activeCount: g.activeCount };
    }
  }

  return { groups, totalDrivers, totalActive, leastCovered };
}

export interface DriverStatusBadge {
  label: string;
  className: string;
}

export function driverStatusBadge(status: string): DriverStatusBadge {
  switch (status) {
    case 'active':
      return { label: 'نشط', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'suspended':
      return { label: 'معلّق', className: 'bg-red-50 text-red-700 border-red-200' };
    case 'pending_approval':
      return { label: 'قيد المراجعة', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'rejected':
      return { label: 'مرفوض', className: 'bg-gray-100 text-gray-600 border-gray-200' };
    default:
      return { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
}