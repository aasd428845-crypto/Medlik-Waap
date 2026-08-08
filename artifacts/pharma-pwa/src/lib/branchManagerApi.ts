import { supabase } from '@/lib/supabaseClient';

// Branch manager row as stored in public.users (snake_case).
export interface BranchManagerRow {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  account_status: string;
  requires_password_change: boolean;
  created_at: string;
}

export interface BranchRow {
  id: string;
  name: string;
  governorate: string | null;
  address_text: string | null;
}

// ── Reads (allowed by RLS: company_director can select all users) ──────────
export async function listBranchManagers(): Promise<BranchManagerRow[]> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, name, email, phone, branch_id, branch_name, account_status, requires_password_change, created_at',
    )
    .eq('role', 'branch_manager')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BranchManagerRow[];
}

// ── Reads (branches readable by any authenticated user) ────────────────────
export async function listBranches(): Promise<BranchRow[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, governorate, address_text')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BranchRow[];
}

// ── Writes (all go through the manage-branch-manager-account Edge Function) ─
async function invokeFunction(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(
    'manage-branch-manager-account',
    { body: payload },
  );
  if (error) throw new Error(error.message || 'حدث خطأ في الاتصال بالخادم');
  const result = data as { error?: string } | null;
  if (result?.error) throw new Error(translateError(result.error));
  return data;
}

export async function createBranchManager(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  branchId?: string;
}) {
  return invokeFunction({
    action: 'create',
    name: input.name,
    email: input.email,
    phone: input.phone ?? '',
    password: input.password,
    branchId: input.branchId || undefined,
  });
}

export async function updateBranchManagerStatus(managerId: string, status: 'active' | 'suspended') {
  return invokeFunction({ action: 'update_status', managerId, status });
}

export async function resetBranchManagerPassword(managerId: string, newPassword: string) {
  return invokeFunction({ action: 'reset_password', managerId, newPassword });
}

// ── Arabic error translation for known Edge Function errors ─────────────────
function translateError(raw: string): string {
  const map: Record<string, string> = {
    'Missing Authorization header': 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
    Unauthorized: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
    'Forbidden: only an active company director can call this function':
      'غير مصرح لك بهذا الإجراء',
    'Director profile not found': 'لم يتم العثور على ملف المدير',
    'name, email, and password are required': 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة',
    'Password must be at least 6 characters': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
    'Branch not found': 'الفرع المحدد غير موجود',
    'Branch manager not found': 'مدير الفرع غير موجود',
    'managerId and status (active|suspended) required': 'بيانات غير مكتملة',
    'managerId and newPassword (≥6 chars) required':
      'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل',
    'Email already registered': 'البريد الإلكتروني مسجل مسبقاً',
    'User already registered': 'البريد الإلكتروني مسجل مسبقاً',
    'Unable to validate email address: invalid format':
      'صيغة البريد الإلكتروني غير صحيحة',
  };
  return map[raw] ?? raw;
}
