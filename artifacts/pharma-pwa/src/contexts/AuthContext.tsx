import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { User } from '@/types/models';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userProfile: User | null;
  loading: boolean;
  isPreviewMode: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  previewAs: (role: 'company_director' | 'branch_manager') => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
          if (userDoc.exists()) {
            const profile = userDoc.data() as User;
            if (profile.role !== 'branch_manager' && profile.role !== 'company_director') {
              await signOut(auth);
              setUserProfile(null);
              setFirebaseUser(null);
            } else {
              setUserProfile({ ...profile, userId: fbUser.uid });
            }
          } else {
            // No matching profile in Firestore — fail closed: sign out immediately
            await signOut(auth);
            setUserProfile(null);
            setFirebaseUser(null);
          }
        } catch (e) {
          // Network/permission error — fail closed as well
          await signOut(auth);
          setUserProfile(null);
          setFirebaseUser(null);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    try {
      const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
      if (!userDoc.exists()) {
        await signOut(auth);
        throw new Error('المستخدم غير موجود في النظام. تواصل مع مسؤول النظام.');
      }
      const profile = userDoc.data() as User;
      if (profile.role !== 'branch_manager' && profile.role !== 'company_director') {
        await signOut(auth);
        throw new Error('ليس لديك صلاحية الوصول لهذه الواجهة. هذا التطبيق مخصص للمديرين فقط.');
      }
    } catch (err) {
      // If error was thrown above, re-throw it; otherwise sign out for safety
      if ((err as Error).message && (err as Error).message !== 'Firebase: Error (auth/wrong-password).') {
        throw err;
      }
      await signOut(auth);
      throw err;
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
    setFirebaseUser(null);
  };

  const logout = async () => {
    setIsPreviewMode(false);
    setUserProfile(null);
    if (firebaseUser) await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, userProfile, loading, isPreviewMode, login, logout, previewAs }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
