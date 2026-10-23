import { supabase } from '@/lib/supabaseClient';

export interface ClientAddressClient {
  id: string;
  name: string | null;
  org_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ClientAddressBranch {
  id: string;
  name: string | null;
  governorate: string | null;
}

export interface ClientAddressRow {
  id: string;
  client_id: string;
  label: string;
  address_text: string;
  governorate: string | null;
  city: string | null;
  district: string | null;
  phone: string | null;
  is_default: boolean;
  branch_id: string | null;
  created_at: string;
  client: ClientAddressClient | null;
  branch: ClientAddressBranch | null;
}

/**
 * Read-only director view over every client address and its single optional
 * branch link. RLS `addresses_select_scoped` grants company_director full
 * visibility; this module intentionally exposes no mutations.
 */
export async function listClientAddresses(): Promise<ClientAddressRow[]> {
  const { data, error } = await supabase
    .from('client_addresses')
    .select(
      `
        id,
        client_id,
        label,
        address_text,
        governorate,
        city,
        district,
        phone,
        is_default,
        branch_id,
        created_at,
        client:users!client_addresses_client_id_fkey(id, name, org_name, email, phone),
        branch:branches!client_addresses_branch_id_fkey(id, name, governorate)
      `,
    )
    .order('governorate', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const client = row.client as Record<string, unknown> | null;
    const branch = row.branch as Record<string, unknown> | null;
    return {
      id: row.id as string,
      client_id: row.client_id as string,
      label: (row.label as string) ?? '',
      address_text: (row.address_text as string) ?? '',
      governorate: (row.governorate as string) ?? null,
      city: (row.city as string) ?? null,
      district: (row.district as string) ?? null,
      phone: (row.phone as string) ?? null,
      is_default: Boolean(row.is_default),
      branch_id: (row.branch_id as string) ?? null,
      created_at: (row.created_at as string) ?? '',
      client: client
        ? {
            id: (client.id as string) ?? '',
            name: (client.name as string) ?? null,
            org_name: (client.org_name as string) ?? null,
            email: (client.email as string) ?? null,
            phone: (client.phone as string) ?? null,
          }
        : null,
      branch: branch
        ? {
            id: (branch.id as string) ?? '',
            name: (branch.name as string) ?? null,
            governorate: (branch.governorate as string) ?? null,
          }
        : null,
    };
  });
}
