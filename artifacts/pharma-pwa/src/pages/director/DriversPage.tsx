import { useCallback, useEffect, useState } from 'react';
import { Truck, Users, MapPin, Phone, PackageCheck } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  fetchDriversWithStats,
  driverStatusBadge,
  type DriverBranchGroup,
} from '@/lib/driverStatsApi';

export function DriversPage() {
  const [groups, setGroups] = useState<DriverBranchGroup[]>([]);
  const [totalDrivers, setTotalDrivers] = useState(0);
  const [totalActive, setTotalActive] = useState(0);
  const [leastCovered, setLeastCovered] = useState<{ branchName: string; activeCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchDriversWithStats();
      setGroups(data.groups);
      setTotalDrivers(data.totalDrivers);
      setTotalActive(data.totalActive);
      setLeastCovered(data.leastCovered);
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات المندوبين. تأكد من تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">المندوبون</h2>
        <p className="text-muted-foreground text-sm">
          مندوبو التوصيل مجمّعون حسب الفرع، مع عدد الطلبات المكتملة لكل مندوب.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl shadow-sm p-5 flex items-center gap-4">
          <div className="bg-blue-50 text-blue-700 p-3 rounded-lg">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">{totalDrivers}</p>
            <p className="text-sm text-muted-foreground">إجمالي المندوبين بالشركة</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl shadow-sm p-5 flex items-center gap-4">
          <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">{totalActive}</p>
            <p className="text-sm text-muted-foreground">مندوبون نشطون</p>
          </div>
        </div>
        <div className="bg-card border rounded-xl shadow-sm p-5 flex items-center gap-4">
          <div className="bg-amber-50 text-amber-700 p-3 rounded-lg">
            <MapPin className="w-6 h-6" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground leading-7">
              {leastCovered ? leastCovered.branchName : '—'}
            </p>
            <p className="text-sm text-muted-foreground">
              أقل فرع تغطية ({leastCovered?.activeCount ?? 0} مندوب نشط)
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.branchId ?? 'no-branch'} className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <MapPin className="w-4 h-4 text-primary" />
                  <h3 className="font-bold text-foreground">{group.branchName}</h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                    <Users className="w-3.5 h-3.5" />
                    {group.activeCount} نشط
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium border bg-muted text-muted-foreground">
                    {group.drivers.length} إجمالاً
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                    <tr>
                      <th className="px-4 py-2.5 whitespace-nowrap">اسم المندوب</th>
                      <th className="px-4 py-2.5 whitespace-nowrap">الهاتف</th>
                      <th className="px-4 py-2.5 whitespace-nowrap text-center">الحالة</th>
                      <th className="px-4 py-2.5 whitespace-nowrap text-center">الطلبات المكتملة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.drivers.map((d) => {
                      const badge = driverStatusBadge(d.account_status);
                      return (
                        <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            {d.name || '—'}
                            <div className="text-xs text-muted-foreground font-normal" dir="ltr">
                              {d.email}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-left" dir="ltr">
                            <span className="inline-flex items-center gap-1.5">
                              <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                              {d.phone || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                              <PackageCheck className="w-3.5 h-3.5" />
                              {group.deliveredByDriver[d.id] ?? 0}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {group.drivers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                          لا يوجد مندوبون في هذا الفرع.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <div className="bg-card border rounded-xl shadow-sm p-10 text-center text-muted-foreground">
              لا يوجد مندوبون مسجلون بعد.
            </div>
          )}
        </div>
      )}
    </div>
  );
}