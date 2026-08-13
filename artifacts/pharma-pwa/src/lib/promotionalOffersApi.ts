import { supabase } from '@/lib/supabaseClient';
import { listBranches } from '@/lib/branchManagerApi';

// Promotional offer row as stored in public.promotional_offers (snake_case),
// with the product name joined from public.products.
export interface PromotionalOfferRow {
  id: string;
  title: string | null;
  description: string | null;
  discount_text: string | null;
  product_id: string | null;
  product_name: string | null;
  discount_percent: number | null;
  special_price: number | null;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OfferProduct {
  id: string;
  name: string | null;
  name_en: string | null;
  unit: string | null;
  is_active: boolean;
}

export interface OfferInput {
  product_id: string;
  discount_percent: number | null;
  special_price: number | null;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
}

function mapRow(row: Record<string, unknown>): PromotionalOfferRow {
  const product = row.products as Record<string, unknown> | null;
  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    description: (row.description as string) ?? null,
    discount_text: (row.discount_text as string) ?? null,
    product_id: (row.product_id as string) ?? null,
    product_name: (product?.name as string) ?? null,
    discount_percent: (row.discount_percent as number) ?? null,
    special_price: (row.special_price as number) ?? null,
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
export async function listPromotionalOffers(): Promise<PromotionalOfferRow[]> {
  const { data, error } = await supabase
    .from('promotional_offers')
    .select('*, products(name)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function getPromotionalOffer(id: string): Promise<PromotionalOfferRow | null> {
  const { data, error } = await supabase
    .from('promotional_offers')
    .select('*, products(name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function listActiveProducts(): Promise<OfferProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, name_en, unit, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OfferProduct[];
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

function offerSummary(input: OfferInput, productName: string | null): { title: string; body: string } {
  const name = productName || 'أحد الأصناف';
  const period = input.start_date || input.end_date
    ? `، سارٍ من ${input.start_date ?? 'الآن'} حتى ${input.end_date ?? 'بدون نهاية'}`
    : '';
  if (input.discount_percent != null) {
    return {
      title: 'عرض ترويجي جديد',
      body: `خصم ${input.discount_percent}% على ${name}${period}`,
    };
  }
  if (input.special_price != null) {
    return {
      title: 'عرض ترويجي جديد',
      body: `سعر خاص ${input.special_price} على ${name}${period}`,
    };
  }
  return { title: 'عرض ترويجي جديد', body: `عرض جديد على ${name}${period}` };
}

export async function createPromotionalOffer(input: OfferInput): Promise<PromotionalOfferRow> {
  const directorId = await currentUserId();
  const branches = await listBranches();

  const productName =
    input.product_id === '' ? null : (await getProductName(input.product_id));

  const { data: offer, error: insertError } = await supabase
    .from('promotional_offers')
    .insert({
      product_id: input.product_id === '' ? null : input.product_id,
      discount_percent: input.discount_percent,
      special_price: input.special_price,
      title: offerSummary(input, productName).title,
      description: offerSummary(input, productName).body,
      discount_text: offerSummary(input, productName).body,
      start_date: input.start_date,
      end_date: input.end_date,
      target_governorate: input.target_governorate,
      is_active: true,
    })
    .select('*, products(name)')
    .single();
  if (insertError) throw new Error(insertError.message);

  const created = mapRow(offer as Record<string, unknown>);

  const summary = offerSummary(input, created.product_name);
  const { error: notifError } = await supabase.from('notifications').insert({
    title: summary.title,
    body: summary.body,
    target_role: 'client',
    target_branch_id: branchIdForGovernorate(input.target_governorate, branches),
    related_offer_id: created.id,
    created_by: directorId,
  });
  if (notifError) throw new Error(notifError.message);

  return created;
}

export async function updatePromotionalOffer(id: string, input: OfferInput): Promise<void> {
  const productName = input.product_id === '' ? null : (await getProductName(input.product_id));
  const summary = offerSummary(input, productName);
  const { error } = await supabase
    .from('promotional_offers')
    .update({
      product_id: input.product_id === '' ? null : input.product_id,
      discount_percent: input.discount_percent,
      special_price: input.special_price,
      title: summary.title,
      description: summary.body,
      discount_text: summary.body,
      start_date: input.start_date,
      end_date: input.end_date,
      target_governorate: input.target_governorate,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setOfferActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('promotional_offers')
    .update({ is_active: active })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePromotionalOffer(id: string): Promise<void> {
  await supabase.from('notifications').delete().eq('related_offer_id', id);
  const { error } = await supabase.from('promotional_offers').delete().eq('id', id);
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
