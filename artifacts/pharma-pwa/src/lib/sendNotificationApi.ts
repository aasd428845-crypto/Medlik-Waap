import { supabase } from '@/lib/supabaseClient';

// User row as stored in public.users, for the target-selection list.
export interface TargetUserRow {
  id: string;
  name: string | null;
  phone: string | null;
  branch_name: string | null;
}

// Notification row as stored in public.notifications, for the sent log.
export interface SentNotificationRow {
  id: string;
  title: string | null;
  body: string | null;
  target_role: string | null;
  target_user_ids: string[];
  created_at: string;
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  return data.user.id;
}

// ── Reads ──────────────────────────────────────────────────────────────────
export async function listUsersByRole(role: string): Promise<TargetUserRow[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone, branch_name')
    .eq('role', role)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TargetUserRow[];
}

export async function listSentNotifications(limit = 20): Promise<SentNotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, target_role, target_user_ids, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? null,
    body: (r.body as string) ?? null,
    target_role: (r.target_role as string) ?? null,
    target_user_ids: (r.target_user_ids as string[]) ?? [],
    created_at: (r.created_at as string) ?? '',
  }));
}

// ── Write ──────────────────────────────────────────────────────────────────
// "الكل": سجل واحد بـ target_role محدداً و target_user_ids فارغة.
// "مجموعة/فرد": سجل واحد بـ target_role = null و target_user_ids = المختارين.
export async function sendNotification(input: {
  title: string;
  body: string;
  targetRole: string;
  targetUserIds: string[];
}): Promise<void> {
  const directorId = await currentUserId();
  const { error } = await supabase.from('notifications').insert({
    title: input.title,
    body: input.body,
    target_role: input.targetUserIds.length === 0 ? input.targetRole : null,
    target_user_ids: input.targetUserIds,
    created_by: directorId,
  });
  if (error) throw new Error(error.message);
}
