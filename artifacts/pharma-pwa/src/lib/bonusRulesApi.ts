import { supabase } from '@/lib/supabaseClient';
import { listBranches } from '@/lib/branchManagerApi';

// Bonus rule row as stored in public.bonus_rules (snake_case),
// with the product name joined from public.products.
export interface BonusRuleRow {
  id: string;
  product_id: string | null;
  product_name: string | null;
  buy_quantity: number;
  free_quantity: number;
  is_stackable: boolean;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BonusRuleInput {
  product_id: string;
  buy_quantity: number;
  free_quantity: number;
  is_stackable: boolean;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
}

function mapRow(row: Record<string, unknown>): BonusRuleRow {
  const product = row.products as Record<string, unknown> | null;
  return {
    id: row.id as string,
    product_id: (row.product_id as string) ?? null,
    product_name: (product?.name as string) ?? null,
    buy_quantity: (row.buy_quantity as number) ?? 0,
    free_quantity: (row.free_quantity as number) ?? 0,
    is_stackable: (row.is_stackable as boolean) ?? false,
    start_date: (row.start_date as string) ?? null,
    end_date: (row.end_date as string) ?? null,
    target_governorate: (row.target_governorate as string) ?? null,
    is_active: (row.is_active as boolean) ?? true,
    created_at: (row.created_at as string) ?? '',
  };
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
  return data.user.id;
}

// ── Reads ──────────────────────────────────────────────────────────────────
export async function listBonusRules(): Promise<BonusRuleRow[]> {
  const { data, error } = await supabase
    .from('bonus_rules')
    .select('*, products(name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function getBonusRule(id: string): Promise<BonusRuleRow | null> {
  const { data, error } = await supabase
    .from('bonus_rules')
    .select('*, products(name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

// ── Writes ─────────────────────────────────────────────────────────────────
function branchIdForGovernorate(governorate: string | null, branches: { id: string; governorate: string | null }[]): string | null {
  if (!governorate) return null;
  const target = governorate.trim();
  return (
    branches.find(
      (b) => (b.governorate ?? '').trim().toLowerCase() === target.toLowerCase(),
    )?.id ?? null
  );
}

function bonusSummary(input: BonusRuleInput, productName: string | null): { title: string; body: string } {
  const name = productName || 'جميع الأصناف';
  const period = input.start_date || input.end_date
    ? `، سارٍ من ${input.start_date ?? 'الآن'} حتى ${input.end_date ?? 'بدون نهاية'}`
    : '';
  const stack = input.is_stackable ? ' (قابل للتراكم)' : '';
  return {
    title: 'عرض بونص جديد',
    body: `اشترِ ${input.buy_quantity} واحصل على ${input.free_quantity} مجاناً من ${name}${stack}${period}`,
  };
}

export async function createBonusRule(input: BonusRuleInput): Promise<BonusRuleRow> {
  const directorId = await currentUserId();
  const branches = await listBranches();

  const productName =
    input.product_id === '' ? null : (await getProductName(input.product_id));

  const { data: rule, error: insertError } = await supabase
    .from('bonus_rules')
    .insert({
      product_id: input.product_id === '' ? null : input.product_id,
      buy_quantity: input.buy_quantity,
      free_quantity: input.free_quantity,
      is_stackable: input.is_stackable,
      start_date: input.start_date,
      end_date: input.end_date,
      target_governorate: input.target_governorate,
      is_active: true,
    })
    .select('*, products(name)')
    .single();
  if (insertError) throw new Error(insertError.message);

  const created = mapRow(rule as Record<string, unknown>);

  const summary = bonusSummary(input, created.product_name);
  const { error: notifError } = await supabase.from('notifications').insert({
    title: summary.title,
    body: summary.body,
    target_role: 'client',
    target_branch_id: branchIdForGovernorate(input.target_governorate, branches),
    created_by: directorId,
  });
  if (notifError) throw new Error(notifError.message);

  return created;
}

export async function updateBonusRule(id: string, input: BonusRuleInput): Promise<void> {
  const { error } = await supabase
    .from('bonus_rules')
    .update({
      product_id: input.product_id === '' ? null : input.product_id,
      buy_quantity: input.buy_quantity,
      free_quantity: input.free_quantity,
      is_stackable: input.is_stackable,
      start_date: input.start_date,
      end_date: input.end_date,
      target_governorate: input.target_governorate,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setBonusRuleActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('bonus_rules')
    .update({ is_active: active })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteBonusRule(id: string): Promise<void> {
  const { error } = await supabase.from('bonus_rules').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function getProductName(productId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('products')
    .select('name')
    .eq('id', productId)
    .maybeSingle();
  if (error) return null;
  return (data?.name as string) ?? null;
}
