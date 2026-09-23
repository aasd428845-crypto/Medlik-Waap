-- This shared migration is intentionally identical to
-- ../../supabase/migrations/0016_bonus_inventory_allocation_safety.sql.
-- Keep both migration histories synchronized for the shared Supabase project.

create or replace function public.branch_allocate_order(
  p_order_id uuid,
  p_issue_invoice boolean default true,
  p_expected_delivery_date date default null,
  p_allocations jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_client_id uuid;
  v_status text;
  v_total numeric(12,2) := 0;
  v_invoice_id uuid;
  v_alloc record;
  v_inv_qty int;
  v_required_qty int;
  v_paid_qty int;
  v_paid_unit_price numeric(10,2);
begin
  if public.current_user_role() <> 'branch_manager' then
    raise exception 'Only a branch manager can allocate orders';
  end if;
  select branch_id, client_id, status into v_branch_id, v_client_id, v_status
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id; end if;
  if v_branch_id is distinct from public.current_user_branch_id() then
    raise exception 'Order does not belong to your branch';
  end if;
  if v_status <> 'pending' then
    raise exception 'Only pending orders can be allocated (current: %)', v_status;
  end if;
  for v_alloc in
    select product_id, sum(allocated_qty)::int as allocated_qty
      from jsonb_to_recordset(coalesce(p_allocations, '[]'::jsonb))
        as x(product_id uuid, allocated_qty int)
     where product_id is not null and allocated_qty is not null and allocated_qty > 0
     group by product_id
  loop
    select coalesce(sum(quantity), 0)::int,
           coalesce(sum(quantity) filter (where not is_bonus), 0)::int,
           coalesce(max(unit_price) filter (where not is_bonus), 0)
      into v_required_qty, v_paid_qty, v_paid_unit_price
      from public.order_items
     where order_id = p_order_id and product_id = v_alloc.product_id;
    if v_required_qty = 0 then
      raise exception 'Product % is not part of order %', v_alloc.product_id, p_order_id;
    end if;
    if v_alloc.allocated_qty > v_required_qty then
      raise exception 'Allocated quantity for product % exceeds ordered physical quantity %',
        v_alloc.product_id, v_required_qty;
    end if;
    select quantity into v_inv_qty from public.inventory
     where branch_id = v_branch_id and product_id = v_alloc.product_id for update;
    if v_inv_qty is null or v_inv_qty < v_alloc.allocated_qty then
      raise exception 'Insufficient stock for product % (need %, have %)',
        v_alloc.product_id, v_alloc.allocated_qty, coalesce(v_inv_qty, 0);
    end if;
    update public.inventory set quantity = quantity - v_alloc.allocated_qty, updated_at = now()
     where branch_id = v_branch_id and product_id = v_alloc.product_id;
    if p_issue_invoice then
      v_total := v_total + least(v_alloc.allocated_qty, v_paid_qty) * coalesce(v_paid_unit_price, 0);
    end if;
  end loop;
  update public.orders set status = 'assigned', scheduled_delivery_at = p_expected_delivery_date
   where id = p_order_id;
  if p_issue_invoice then
    insert into public.invoices (client_id, branch_id, amount, status, due_date)
    values (v_client_id, v_branch_id, v_total, 'pending', p_expected_delivery_date)
    returning id into v_invoice_id;
  end if;
  return v_invoice_id;
end;
$$;

grant execute on function public.branch_allocate_order(uuid, boolean, date, jsonb)
  to authenticated;
