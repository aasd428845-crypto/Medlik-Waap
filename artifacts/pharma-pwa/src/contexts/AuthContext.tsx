import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { User } from '@/types/models';

// This web app is exclusively for the company director. Branch managers and
// drivers use the Flutter MedLink app; clients have their own experience there.
const ALLOWED_ROLE = 'company_director';

interface AuthContextType {
  session: Session | null;
  userProfile: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function mapDbRowToUser(row: Record<string, unknown>): User {
  return {
    userId: row.id as string,
    name: (row.name as string) ?? '',
    email: (row.email as string) ?? '',
    role: row.role as User['role'],
    branchId: (row.branch_id as string) ?? undefined,
    branchName: (row.branch_name as string) ?? undefined,
    orgName: (row.org_name as string) ?? undefined,
    phone: (row.phone as string) ?? undefined,
    city: (row.city as string) ?? undefined,
    governorate: (row.governorate as string) ?? undefined,
  };
}

type ProfileCheck =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: 'missing' | 'role' | 'status' };

/** Load the profile for `userId`; sign out and return the failure reason
 *  if the role or account status is not allowed. */
async function fetchAllowedProfile(userId: string): Promise<ProfileCheck> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'missing' };
    }

    if ((data.role as string) !== ALLOWED_ROLE) {
      await supabase.auth.signOut();
      return { ok: false, reason: 'role' };
    }

    // Only an ACTIVE director can access the panel — a self-registered
    // account with a forged role stays pending_approval and is rejected.
    if ((data.account_status as string) !== 'active') {
      await supabase.auth.signOut();
      return { ok: false, reason: 'status' };
    }

    return { ok: true, row: data };
  } catch {
    await supabase.auth.signOut();
    return { ok: false, reason: 'missing' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        fetchAllowedProfile(s.user.id)
          .then((res) => setUserProfile(res.ok ? mapDbRowToUser(res.row) : null))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) {
        const res = await fetchAllowedProfile(s.user.id);
        setUserProfile(res.ok ? mapDbRowToUser(res.row) : null);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error(error.message);

    const res = await fetchAllowedProfile(data.user.id);
    if (!res.ok) {
      if (res.reason === 'status') {
        throw new Error(
          'هذا الحساب غير مفعّل بعد. يرجى التواصل مع إدارة النظام لتفعيل حسابك.',
        );
      }
      throw new Error(
        'هذا التطبيق مخصص للمدير العام فقط. يرجى استخدام تطبيق MedLink على الجوال.',
      );
    }
    // onAuthStateChange will populate userProfile; no extra work needed here.
  };

  const logout = async () => {
    setUserProfile(null);
    if (session) await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, userProfile, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
