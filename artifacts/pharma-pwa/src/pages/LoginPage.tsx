import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pill, LogIn, Eye } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorMessage } from '@/components/ErrorMessage';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, previewAs } = useAuth();
  const navigate = useNavigate();

  const handlePreview = (role: 'company_director' | 'branch_manager') => {
    previewAs(role);
    navigate(role === 'company_director' ? '/director' : '/branch');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      // Let RootRedirect handle the redirection natively after context updates,
      // or we can manually force it based on role if we fetched it here,
      // but the easiest is redirecting to "/" and let RootRedirect do its job.
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-emerald-500/5 blur-3xl" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center items-center gap-3">
          <div className="bg-primary p-3 rounded-2xl shadow-lg shadow-primary/20">
            <Pill className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">نظام إدارة الأدوية</h1>
        </div>
        <h2 className="mt-6 text-center text-xl text-muted-foreground font-medium">
          بوابة الإدارة المركزية
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-card py-8 px-4 shadow-xl border sm:rounded-2xl sm:px-10">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && <ErrorMessage message={error} />}

            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                البريد الإلكتروني
              </label>
              <input
                type="email"
                required
                className="appearance-none block w-full px-4 py-3 border border-input rounded-xl bg-background placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                كلمة المرور
              </label>
              <input
                type="password"
                required
                className="appearance-none block w-full px-4 py-3 border border-input rounded-xl bg-background placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                dir="ltr"
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all items-center gap-2"
              >
                {isSubmitting ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    تسجيل الدخول
                    <LogIn className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* ── وضع المعاينة المؤقتة ── */}
          <div className="mt-6 pt-6 border-t border-dashed border-amber-300">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wide">
                معاينة مؤقتة — بدون تسجيل دخول
              </span>
              <Eye className="w-4 h-4 text-amber-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handlePreview('company_director')}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all text-blue-700 font-semibold text-sm"
              >
                <span className="text-xl">🏢</span>
                <span>واجهة المدير العام</span>
              </button>
              <button
                type="button"
                onClick={() => handlePreview('branch_manager')}
                className="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-all text-emerald-700 font-semibold text-sm"
              >
                <span className="text-xl">🏪</span>
                <span>واجهة مدير الفرع</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
