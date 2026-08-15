import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, LockKeyhole, Pill, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorMessage } from '@/components/ErrorMessage';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      // RootRedirect handles the redirection after the auth context updates.
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
      setIsSubmitting(false);
    }
  };

  return (
    <main className="director-shell director-grid relative flex min-h-[100dvh] items-center overflow-hidden px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute -right-32 -top-40 h-[32rem] w-[32rem] rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -left-32 h-[32rem] w-[32rem] rounded-full bg-accent/10 blur-3xl" />
      <div className="relative mx-auto grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-border/80 bg-card/40 shadow-2xl shadow-black/30 backdrop-blur-xl lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden border-l border-border/70 bg-gradient-to-br from-primary/20 via-card/60 to-accent/10 p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(hsl(195_50%_30%_/_0.12)_1px,transparent_1px),linear-gradient(90deg,hsl(195_50%_30%_/_0.12)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div className="relative">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px_hsl(var(--primary)/.16)]">
                <Pill className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-primary">NOVA DISTRIBUTION</p>
                <p className="mt-1 text-lg font-extrabold">مركز القيادة</p>
              </div>
            </div>
            <p className="max-w-sm text-4xl font-extrabold leading-[1.25] tracking-tight">
              قرار أسرع، <span className="text-primary">رؤية أوضح.</span>
            </p>
            <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">
              مساحة تنفيذية موحدة لمراقبة الأداء المالي والتشغيلي لشبكة توزيع الأدوية.
            </p>
          </div>
          <div className="relative grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-background/35 p-4">
              <Activity className="h-5 w-5 text-accent" />
              <p className="mt-6 text-[11px] text-muted-foreground">البيانات التشغيلية</p>
              <p className="mt-1 text-sm font-bold text-emerald-300">متصلة ومحدثة</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/35 p-4">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <p className="mt-6 text-[11px] text-muted-foreground">مستوى الوصول</p>
              <p className="mt-1 text-sm font-bold">مدير عام</p>
            </div>
          </div>
        </section>

        <section className="flex min-h-[620px] flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 text-primary shadow-[0_0_24px_hsl(var(--primary)/.16)]">
                <Pill className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-primary">NOVA DISTRIBUTION</p>
                <h1 className="mt-1 text-lg font-extrabold">مركز القيادة</h1>
              </div>
            </div>
          </div>
          <div className="mb-8">
            <p className="text-[10px] font-bold tracking-[0.16em] text-primary">SECURE ACCESS</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight">تسجيل الدخول إلى المنظومة</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">أدخل بيانات المدير العام للوصول إلى لوحة القيادة المركزية.</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && <ErrorMessage message={error} />}
            <div>
              <label className="mb-2 block text-xs font-bold text-foreground">البريد الإلكتروني</label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className="block w-full rounded-xl border border-input bg-background/70 py-3.5 pl-4 pr-11 text-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  dir="ltr"
                />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-foreground">كلمة المرور</label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  className="block w-full rounded-xl border border-input bg-background/70 py-3.5 pl-4 pr-11 text-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="group flex w-full items-center justify-center gap-2 rounded-xl border border-primary/70 bg-primary py-3.5 text-sm font-extrabold text-primary-foreground shadow-[0_10px_26px_hsl(var(--primary)/.18)] transition-all hover:-translate-y-0.5 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : (
                <>
                  دخول آمن
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            هذا النظام مخصص للإدارة التنفيذية المعتمدة
          </div>
        </section>
      </div>
    </main>
  );
}
