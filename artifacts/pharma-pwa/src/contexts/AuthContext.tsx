import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { User } from '@/types/models';

interface AuthContextType {
  session: Session | null;
  userProfile: User | null;
  loading: boolean;
  isPreviewMode: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  previewAs: (role: 'company_director' | 'branch_manager') => void;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  async function loadProfile(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !data) {
        await supabase.auth.signOut();
        setUserProfile(null);
        setSession(null);
        return false;
      }

      const role = data.role as string;
      if (role !== 'branch_manager' && role !== 'company_director') {
        await supabase.auth.signOut();
        setUserProfile(null);
        setSession(null);
        return false;
      }

      setUserProfile(mapDbRowToUser(data));
      return true;
    } catch {
      await supabase.auth.signOut();
      setUserProfile(null);
      setSession(null);
      return false;
    }
  }

  useEffect(() => {
    // Get the initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) {
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Subscribe to future changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s) {
        await loadProfile(s.user.id);
      } else {
        // Only clear if we're not in local preview mode
        setIsPreviewMode(prev => {
          if (!prev) setUserProfile(null);
          return prev;
        });
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);

    const { data: userRow, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError || !userRow) {
      await supabase.auth.signOut();
      throw new Error('المستخدم غير موجود في النظام. تواصل مع مسؤول النظام.');
    }

    if (userRow.role !== 'branch_manager' && userRow.role !== 'company_director') {
      await supabase.auth.signOut();
      throw new Error('هذا التطبيق مخصص لمدراء الفروع والمدير العام فقط.');
    }
  };

  const previewAs = (role: 'company_director' | 'branch_manager') => {
    const mockProfile: User = {
      userId: 'preview-user',
      name: role === 'company_director' ? 'مدير عام (معاينة)' : 'مدير فرع (معاينة)',
      email: 'preview@example.com',
      role,
      branchId: role === 'branch_manager' ? 'preview-branch' : undefined,
      branchName: role === 'branch_manager' ? 'فرع التجريبي' : undefined,
    };
    setIsPreviewMode(true);
    setUserProfile(mockProfile);
    setSession(null);
  };

  const logout = async () => {
    setIsPreviewMode(false);
    setUserProfile(null);
    if (session) await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, userProfile, loading, isPreviewMode, login, logout, previewAs }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
