// Supabase Edge Function: manage-client-account
// Allows the active company_director to approve or reject client
// registration requests (account_status: pending_approval -> active|rejected).
// Architectural twin of manage-branch-manager-account, scoped to clients.
//
// Deploy with: supabase functions deploy manage-client-account
// Required env vars (auto-provided by Supabase): SUPABASE_URL,
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Missing Authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller's JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    // Admin client for all privileged operations
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Fetch the caller's row from public.users
    const { data: director, error: dirErr } = await admin
      .from("users")
      .select("role, account_status")
      .eq("id", user.id)
      .single();
    if (dirErr || !director) {
      return respond({ error: "Director profile not found" }, 403);
    }
    if (director.role !== "company_director" || director.account_status !== "active") {
      return respond(
        { error: "Forbidden: only an active company director can call this function" },
        403,
      );
    }

    const body = await req.json();
    const { action } = body as { action: string };

    // ── APPROVE / REJECT a pending client ───────────────────────────────
    if (action === "approve" || action === "reject") {
      const { clientId } = body as { clientId?: string };
      if (!clientId) return respond({ error: "clientId is required" }, 400);

      const nextStatus = action === "approve" ? "active" : "rejected";

      // Verify target is a client currently pending approval
      const { data: client, error: clientErr } = await admin
        .from("users")
        .select("id, role, account_status")
        .eq("id", clientId)
        .single();
      if (clientErr || !client || client.role !== "client") {
        return respond({ error: "Client not found" }, 404);
      }
      if (client.account_status !== "pending_approval") {
        return respond(
          { error: "Only pending_approval clients can be processed" },
          400,
        );
      }

      const { error: updErr } = await admin
        .from("users")
        .update({ account_status: nextStatus })
        .eq("id", clientId);
      if (updErr) return respond({ error: updErr.message }, 500);

      return respond({ success: true, accountStatus: nextStatus });
    }

    return respond({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return respond({ error: String(err) }, 500);
  }
});