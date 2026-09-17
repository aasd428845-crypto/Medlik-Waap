-- =============================================================
-- Migration 0015 — Product image storage
-- Medlik-Waap Web/Admin — shared Supabase database
--
-- Reuses public.products.image_url. No product column or table is added.
-- The Web/Admin director uploads files to this public bucket and stores
-- the resulting public URL in products.image_url for Flutter to consume.
-- Keep this SQL synchronized with the Flutter repository migration 0015.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "product_images_director_insert" on storage.objects;
create policy "product_images_director_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and public.current_user_role() = 'company_director'
  );

drop policy if exists "product_images_director_update" on storage.objects;
create policy "product_images_director_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.current_user_role() = 'company_director'
  )
  with check (
    bucket_id = 'product-images'
    and public.current_user_role() = 'company_director'
  );

drop policy if exists "product_images_director_delete" on storage.objects;
create policy "product_images_director_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.current_user_role() = 'company_director'
  );
