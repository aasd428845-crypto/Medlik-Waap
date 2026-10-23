import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Layers,
  Link2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Unlink,
  User,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';
import {
  listClientAddresses,
  type ClientAddressRow,
} from '@/lib/clientAddressesApi';

const UNLINKED_KEY = '__unlinked__';

interface AddressGroup {
  key: string;
  name: string;
  governorate: string | null;
  linked: boolean;
  rows: ClientAddressRow[];
}

export function ClientAddressesPage() {
  const [addresses, setAddresses] = useState<ClientAddressRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');

  const fetchAll = useCallback(async (refresh = false) => {
    try {
      refresh ? setRefreshing(true) : setLoading(true);
      setError('');
      const [addressRows, branchRows] = await Promise.all([
        listClientAddresses(),
        listBranches(),
      ]);
      setAddresses(addressRows);
      setBranches(branchRows);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : 'تعذر تحميل عناوين العملاء. تأكد من تسجيل الدخول.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const linkedCount = addresses.filter((row) => row.branch_id !== null).length;
  const unlinkedCount = addresses.length - linkedCount;

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return addresses.filter((row) => {
      if (branchFilter === UNLINKED_KEY && row.branch_id !== null) {
        return false;
      }
      if (
        branchFilter !== 'all' &&
        branchFilter !== UNLINKED_KEY &&
        row.branch_id !== branchFilter
      ) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        row.client?.name,
        row.client?.org_name,
        row.client?.email,
        row.client?.phone,
        row.label,
        row.address_text,
        row.governorate,
        row.city,
        row.district,
        row.branch?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [addresses, branchFilter, searchTerm]);

  const groups = useMemo<AddressGroup[]>(() => {
    const map = new Map<string, AddressGroup>();
    for (const row of filtered) {
      const key = row.branch_id ?? UNLINKED_KEY;
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        map.set(key, {
          key,
          name: row.branch?.name ?? 'غير مرتبطة بفرع',
          governorate: row.branch?.governorate ?? null,
          linked: row.branch_id !== null,
          rows: [row],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.linked !== b.linked) return a.linked ? -1 : 1;
      return a.name.localeCompare(b.name, 'ar');
    });
  }, [filtered]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-border bg-card/80 p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold text-primary">
              <Layers className="h-4 w-4" />
              قراءة فقط
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight">
              عناوين العملاء حسب الفرع
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              عرض موحّد لعناوين العملاء وربطها بفروع الشركة. كل عنوان مرتبط بفرع
              واحد على الأكثر، ولا يمكن تعديل البيانات من هذه الصفحة.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<MapPin className="h-5 w-5" />}
            label="إجمالي العناوين"
            value={addresses.length}
            tone="primary"
          />
          <StatCard
            icon={<Link2 className="h-5 w-5" />}
            label="مرتبطة بفرع"
            value={linkedCount}
            tone="success"
          />
          <StatCard
            icon={<Unlink className="h-5 w-5" />}
            label="غير مرتبطة"
            value={unlinkedCount}
            tone="warning"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card/80 p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="ابحث باسم العميل أو العنوان أو الفرع..."
              className="h-11 w-full rounded-xl border border-border bg-background/70 pr-10 pl-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            className="h-11 rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
          >
            <option value="all">كل الفروع</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.governorate ? ` — ${branch.governorate}` : ''}
              </option>
            ))}
            <option value={UNLINKED_KEY}>غير مرتبطة بفرع</option>
          </select>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          عرض {filtered.length} من أصل {addresses.length} عنواناً
        </p>
      </section>

      {error && <ErrorMessage message={error} />}

      {loading ? (
        <LoadingSpinner />
      ) : groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-bold">لا توجد عناوين مطابقة</p>
          <p className="mt-1 text-xs text-muted-foreground">
            جرّب تغيير الفرع أو كلمة البحث.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section
              key={group.key}
              className="overflow-hidden rounded-3xl border border-border bg-card/70"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                      group.linked
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                    }`}
                  >
                    {group.linked ? (
                      <Building2 className="h-5 w-5" />
                    ) : (
                      <Unlink className="h-5 w-5" />
                    )}
                  </span>
                  <div>
                    <h2 className="text-sm font-black">{group.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {group.governorate ?? 'بدون محافظة'} · {group.rows.length}{' '}
                      عنواناً
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    group.linked
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-amber-500/10 text-amber-500'
                  }`}
                >
                  {group.linked ? 'مرتبط بفرع' : 'بانتظار الربط'}
                </span>
              </div>

              <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((row) => (
                  <AddressCard key={row.id} row={row} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'primary' | 'success' | 'warning';
}) {
  const toneClass = {
    primary: 'border-primary/20 bg-primary/10 text-primary',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-500',
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/50 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${toneClass}`}>
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p className="text-xl font-black">{value.toLocaleString('ar-YE')}</p>
      </div>
    </div>
  );
}

function AddressCard({ row }: { row: ClientAddressRow }) {
  const clientName = row.client?.org_name?.trim() || row.client?.name?.trim();
  return (
    <article className="rounded-2xl border border-border/80 bg-background/55 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold" title={clientName || 'عميل'}>
              {clientName || 'عميل غير مسمى'}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {row.client?.email || row.client?.phone || '—'}
            </p>
          </div>
        </div>
        {row.is_default && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold text-primary">
            <CheckCircle2 className="h-3 w-3" />
            افتراضي
          </span>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-border/60 bg-card/45 p-3">
        <p className="text-xs font-bold">{row.label || 'عنوان بدون وسم'}</p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
          {row.address_text || '—'}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold text-muted-foreground">
        {[row.governorate, row.city, row.district].filter(Boolean).map((part, index) => (
          <span
            key={`${part}-${index}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1"
          >
            <MapPin className="h-3 w-3" />
            {part}
          </span>
        ))}
        {row.phone && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1">
            <Phone className="h-3 w-3" />
            {row.phone}
          </span>
        )}
      </div>
    </article>
  );
}
