import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  ArrowUpRight,
  Banknote,
  CircleDollarSign,
  FileText,
  HandCoins,
  Landmark,
  ReceiptText,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  formatYer,
  getFinancialDashboardData,
  type FinancialDashboardData,
} from '@/lib/dashboardApi';

const deltaPct = (v: number) => (v > 0 ? `+${v}%` : `${v}%`);
const isUp = (v: number) => v >= 0;

const TRANSACTION_META: Record<string, { label: string; icon: typeof FileText; tone: string }> = {
  invoice: { label: 'فاتورة صدرت', icon: FileText, tone: 'bg-primary/10 text-primary' },
  commission: { label: 'عمولة دُفعت', icon: HandCoins, tone: 'bg-emerald-400/10 text-emerald-300' },
  expense: { label: 'مصروف سُجّل', icon: ReceiptText, tone: 'bg-amber-400/10 text-amber-300' },
  receipt: { label: 'سند قبض', icon: ArrowDownLeft, tone: 'bg-accent/10 text-accent' },
  entry: { label: 'قيد محاسبي', icon: Landmark, tone: 'bg-violet-400/10 text-violet-300' },
};

function KpiCard({ title, value, display, icon, delta, tone }: {
  title: string;
  value: string;
  display: string;
  icon: React.ReactNode;
  delta: number;
  tone: string;
}) {
  const up = isUp(delta);
  return (
    <article className="director-panel director-reveal group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className="absolute inset-x-0 top-0 h-px director-glow-line opacity-60" />
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone} transition-transform duration-300 group-hover:scale-105`}>
          {icon}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-extrabold ${up ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border border-red-400/20 bg-red-400/10 text-red-400'}`} dir="ltr">
          {up ? <ArrowUpRight className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {deltaPct(delta)}
        </span>
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</p>
        <h3 className="mt-1 text-2xl font-extrabold tracking-tight md:text-[1.6rem]" dir="ltr">{display}</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">{value}</p>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-2/3 rounded-full bg-gradient-to-l from-primary to-accent transition-all duration-500 group-hover:w-4/5" />
      </div>
    </article>
  );
}

function ExchangeRateCard({ usd, sar }: { usd: FinancialDashboardData['exchangeRates']['usdYer']; sar: FinancialDashboardData['exchangeRates']['sarYer'] }) {
  const Rows = ({ label, pair, rate, prevRate, minutesAgo }: { label: string; pair: string; rate: number; prevRate: number; minutesAgo: number }) => {
    const up = rate >= prevRate;
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/15 bg-black/15 px-5 py-4 backdrop-blur-sm">
        <div>
          <p className="text-[11px] font-bold text-white/80">{label}</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl" dir="ltr">
            {rate.toLocaleString('en-US')} <span className="text-base font-bold text-white/70">YER</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${up ? 'bg-emerald-400/20 text-emerald-200' : 'bg-red-400/20 text-red-200'}`} dir="ltr">
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {up ? '+' : ''}{(rate - prevRate).toFixed(2)}
          </span>
          <span className="text-[10px] text-white/60" dir="ltr">{pair}</span>
        </div>
      </div>
    );
  };

  return (
    <section className="director-panel director-reveal director-reveal-1 relative overflow-hidden rounded-2xl p-5 md:p-7">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-accent/25" />
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-1/3 h-56 w-56 rounded-full bg-accent/25 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-white shadow-lg">
              <CircleDollarSign className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white">سعر الصرف الحي</h2>
              <p className="mt-0.5 text-[11px] font-semibold text-white/75">آخر تحديث: قبل {Math.max(usd.minutesAgo, sar.minutesAgo)} دقيقة</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            مباشر — البنك المركزي اليمني
          </span>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Rows label="الدولار الأمريكي" pair="USD / YER" rate={usd.rate} prevRate={usd.prevRate} minutesAgo={usd.minutesAgo} />
          <Rows label="الريال السعودي" pair="SAR / YER" rate={sar.rate} prevRate={sar.prevRate} minutesAgo={sar.minutesAgo} />
        </div>
      </div>
    </section>
  );
}

function ChartTooltipBox({ active, payload, label, moneyFormat }: { active?: boolean; payload?: { value: number }[]; label?: string; moneyFormat?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 px-4 py-3 text-xs shadow-2xl backdrop-blur">
      <p className="mb-1 font-bold text-muted-foreground">{label}</p>
      <p className="font-extrabold text-primary" dir="ltr">{moneyFormat ? formatYer(payload[0].value) : payload[0].value}</p>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  'مسددة': 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  'غير مسددة': 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  'مرحّل': 'border-primary/20 bg-primary/10 text-primary',
  'مطابق': 'border-accent/20 bg-accent/10 text-accent',
};

export function FinancialDashboardPage() {
  const [data, setData] = useState<FinancialDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await getFinancialDashboardData();
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Financial Dashboard Error', err);
      setError('تعذر جلب بيانات اللوحة المالية.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, []);

  const maxRevenue = useMemo(() => Math.max(...(data?.revenue12m ?? []).map((m) => m.revenue), 1), [data]);

  if (loading && !data) {
    return (
      <div className="space-y-6" aria-label="جاري تحميل اللوحة المالية">
        <div className="h-44 animate-pulse rounded-2xl bg-card/70" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-card/70" />)}
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="h-80 animate-pulse rounded-2xl bg-card/70" />
          <div className="h-80 animate-pulse rounded-2xl bg-card/70" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="director-panel flex min-h-[360px] flex-col items-center justify-center rounded-2xl p-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle /></div>
        <h2 className="text-lg font-bold">تعذر تحميل اللوحة المالية</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{error}</p>
        <button onClick={() => void load()} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20">
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </button>
      </div>
    );
  }

  const { kpis, exchangeRates, revenue12m, branchProfit, recentTransactions } = data;
  const maxProfit = Math.max(...branchProfit.map((b) => b.profit), 1);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 h-24 w-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,.7)]" />
              اللوحة المالية — بيانات مباشرة
            </div>
            <h1 className="max-w-2xl text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
              الأداء المالي للشبكة من نظرة واحدة
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              الإيرادات والتدفقات النقدية وسعر الصرف وربحية الفروع — تحديث تلقائي كل 45 ثانية.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-background/30 px-4 py-3">
            <Wallet className="h-5 w-5 text-primary" />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">آخر تحديث</p>
              <p className="text-sm font-bold text-emerald-300" dir="ltr">{lastUpdated.toLocaleTimeString('ar')}</p>
            </div>
            <button onClick={() => void load()} aria-label="تحديث" className="rounded-lg border border-primary/25 bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="الإيرادات (30 يوم)" value="مقارنة بالفترة السابقة" display={formatYer(kpis.revenue30d.value)} delta={kpis.revenue30d.deltaPct} tone="bg-primary/10 text-primary" icon={<CircleDollarSign className="h-5 w-5" />} />
        <KpiCard title="هامش الربح الإجمالي" value="نسبة من الإيرادات" display={`${kpis.grossMarginPct.value.toFixed(1)}%`} delta={kpis.grossMarginPct.deltaPct} tone="bg-accent/10 text-accent" icon={<TrendingUp className="h-5 w-5" />} />
        <KpiCard title="صافي التدفق النقدي" value="داخل مطروحاً منه خارج" display={formatYer(kpis.netCashFlow.value)} delta={kpis.netCashFlow.deltaPct} tone="bg-emerald-400/10 text-emerald-300" icon={<Banknote className="h-5 w-5" />} />
        <KpiCard title="إجمالي الذمم المدينة" value="فواتير غير مسددة" display={formatYer(kpis.receivablesTotal.value)} delta={kpis.receivablesTotal.deltaPct} tone="bg-amber-400/10 text-amber-300" icon={<Wallet className="h-5 w-5" />} />
      </section>

      <ExchangeRateCard usd={exchangeRates.usdYer} sar={exchangeRates.sarYer} />

      <section className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <div className="director-panel director-reveal director-reveal-2 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><TrendingUp className="h-4 w-4" /></div>
                <div>
                  <h2 className="text-base font-extrabold">اتجاه الإيرادات — آخر 12 شهراً</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">إجمالي الفواتير المسددة والمسلّمة شهرياً</p>
                </div>
              </div>
            </div>
            <Link to="/director/financial" className="flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/70">
              الإدارة المالية <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-6 h-[300px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenue12m} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 1_000_000)}M`} width={44} />
                <Tooltip content={<ChartTooltipBox moneyFormat />} cursor={{ stroke: 'hsl(var(--primary))', strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#revFill)" dot={{ r: 2.5, fill: 'hsl(var(--primary))', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>القمة: <span className="font-extrabold text-primary" dir="ltr">{formatYer(maxRevenue)}</span></span>
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> الإيرادات الشهرية</span>
          </div>
        </div>

        <div className="director-panel director-reveal director-reveal-3 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Landmark className="h-4 w-4" /></div>
              <div>
                <h2 className="text-base font-extrabold">ربحية الفروع</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">صافي ربح كل فرع (دورة مالية)</p>
              </div>
            </div>
          </div>
          <div className="mt-6 h-[300px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={branchProfit} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 1_000_000)}M`} />
                <YAxis type="category" dataKey="branch" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} width={96} />
                <Tooltip content={<ChartTooltipBox moneyFormat />} cursor={{ fill: 'hsl(var(--muted))' }} />
                <Bar dataKey="profit" radius={[0, 8, 8, 0]} barSize={16}>
                  {branchProfit.map((b, i) => (
                    <Cell key={b.branch} fill={i === 0 ? 'hsl(var(--primary))' : 'hsl(var(--chart-2))'} fillOpacity={1 - i * 0.11} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
            <span>أعلى ربحية: <span className="font-extrabold text-primary">{branchProfit[0]?.branch}</span></span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> {branchProfit.length} فروع</span>
          </div>
        </div>
      </section>

      <section className="director-panel director-reveal director-reveal-4 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-extrabold">آخر الحركات المالية</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">أحدث الأحداث المسجلة في النظام المالي</p>
          </div>
          <Link to="/director/financial/journal" className="flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/70">
            دفتر اليومية <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
        <ul className="divide-y divide-border/60">
          {recentTransactions.map((tx) => {
            const meta = TRANSACTION_META[tx.type] ?? TRANSACTION_META.entry;
            const Icon = meta.icon;
            const date = new Date(tx.date);
            return (
              <li key={tx.id} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{tx.title} <span className="font-mono text-[10px] font-semibold text-muted-foreground" dir="ltr">{tx.reference}</span></p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground" dir="ltr">{date.toLocaleDateString('ar', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-extrabold" dir="ltr">{formatYer(tx.amount)}</p>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[tx.status] ?? 'border-border bg-muted text-muted-foreground'}`}>{tx.status}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border bg-white/[0.02] px-5 py-3">
          <Link to="/director/financial" className="flex items-center justify-center gap-1.5 text-xs font-bold text-primary transition-colors hover:text-primary/70">
            عرض جميع الحركات المالية <ArrowUpLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}