import { supabase } from '@/lib/supabaseClient';

// Client row as stored in public.users (snake_case).
export interface PendingClientRow {
  id: string;
  name: string | null;
  org_name: string | null;
  client_type: string | null;
  phone: string | null;
  city: string | null;
  governorate: string | null;
  email: string;
  created_at: string;
}

// ── Reads (allowed by RLS: company_director can select all users) ──────────
export async function listPendingClients(): Promise<PendingClientRow[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('role', 'client')
    .eq('account_status', 'pending_approval')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data as Record<string, unknown>[];
  return (rows ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string) ?? null,
    org_name: (row.org_name as string) ?? null,
    client_type: (row.client_type as string) ?? null,
    phone: (row.phone as string) ?? null,
    city: (row.city as string) ?? null,
    governorate: (row.governorate as string) ?? null,
    email: (row.email as string) ?? '',
    created_at: (row.created_at as string) ?? '',
  }));
}

// ── Writes (go through the manage-client-account Edge Function) ────────────
async function invokeFunction(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-client-account', {
    body: payload,
  });
  if (error) throw new Error(error.message || 'حدث خطأ في الاتصال بالخادم');
  const result = data as { error?: string } | null;
  if (result?.error) throw new Error(translateError(result.error));
  return data;
}

export function approveClient(clientId: string) {
  return invokeFunction({ action: 'approve', clientId });
}

export function rejectClient(clientId: string) {
  return invokeFunction({ action: 'reject', clientId });
}

// ── Arabic error translation for known Edge Function errors ─────────────────
function translateError(raw: string): string {
  const map: Record<string, string> = {
    'Missing Authorization header': 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
    Unauthorized: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
    'Forbidden: only an active company director can call this function':
      'غير مصرح لك بهذا الإجراء',
    'Director profile not found': 'لم يتم العثور على ملف المدير',
    'clientId is required': 'بيانات غير مكتملة',
    'Client not found': 'العميل غير موجود',
    'Only pending_approval clients can be processed':
      'لا يمكن معالجة هذا الطلب لأن حالته تغيّرت مسبقاً',
  };
  return map[raw] ?? raw;
}