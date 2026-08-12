// Supabase Edge Function: manage-branch-manager-account
// Allows the active company_director to create, activate/suspend, and reset
// passwords for branch manager accounts — without exposing the service role.
// Architectural twin of manage-driver-account, scoped to the director.
//
// Deploy with: supabase functions deploy manage-branch-manager-account
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

    // ── CREATE ────────────────────────────────────────────────────────────
    if (action === "create") {
      const { name, email, phone, password, branchId } = body as {
        name: string;
        email: string;
        phone?: string;
        password: string;
        branchId?: string;
      };
      if (!name || !email || !password) {
        return respond({ error: "name, email, and password are required" }, 400);
      }
      if (password.length < 6) {
        return respond({ error: "Password must be at least 6 characters" }, 400);
      }
      if (!branchId) {
        return respond({ error: "branchId is required" }, 400);
      }

      // Verify the chosen branch exists and resolve its name for display
      let branchName: string | null = null;
      const { data: branch, error: branchErr } = await admin
        .from("branches")
        .select("name")
        .eq("id", branchId)
        .single();
      if (branchErr || !branch) return respond({ error: "Branch not found" }, 400);
      branchName = branch.name;

      // Create auth user — handle_new_user trigger will insert into public.users
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        user_metadata: {
          name,
          phone: phone ?? "",
          role: "branch_manager",
          branch_id: branchId,
          branch_name: branchName,
          requires_password_change: true,
        },
        email_confirm: true,
      });
      if (createErr) return respond({ error: createErr.message }, 400);

      const managerId = created.user!.id;

      // The auth trigger and the Edge Function run independently. Retry until
      // the profile row exists, then verify the update returned the expected
      // role, branch, and active status. An UPDATE with zero matching rows can
      // otherwise report no error and leave Flutter with a pending/unassigned
      // profile.
      let profileReady = false;
      let lastUpdateError: string | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data: profile, error: updErr } = await admin
          .from("users")
          .update({
            branch_id: branchId,
            branch_name: branchName,
            account_status: "active",
            requires_password_change: true,
          })
          .eq("id", managerId)
          .select("id, role, branch_id, branch_name, account_status, requires_password_change")
          .maybeSingle();

        if (updErr) {
          lastUpdateError = updErr.message;
        } else if (
          profile?.id === managerId &&
          profile.role === "branch_manager" &&
          profile.branch_id === branchId &&
          profile.branch_name === branchName &&
          profile.account_status === "active" &&
          profile.requires_password_change === true
        ) {
          profileReady = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 300));
      }

      if (!profileReady) {
        // Best-effort rollback
        await admin.auth.admin.deleteUser(managerId);
        return respond({ error: lastUpdateError ?? "Unable to initialize manager profile" }, 500);
      }

      return respond({ success: true, userId: managerId });
    }

    // ── UPDATE STATUS (activate / suspend) ───────────────────────────────
    if (action === "update_status") {
      const { managerId, status } = body as { managerId: string; status: string };
      if (!managerId || !["active", "suspended"].includes(status)) {
        return respond(
          { error: "managerId and status (active|suspended) required" },
          400,
        );
      }

      // Verify target is a branch manager
      const { data: mgr, error: mgrErr } = await admin
        .from("users")
        .select("role")
        .eq("id", managerId)
        .single();
      if (mgrErr || mgr?.role !== "branch_manager") {
        return respond({ error: "Branch manager not found" }, 403);
      }

      const { error: updErr } = await admin
        .from("users")
        .update({ account_status: status })
        .eq("id", managerId);
      if (updErr) return respond({ error: updErr.message }, 500);

      return respond({ success: true });
    }

    // ── RESET PASSWORD ───────────────────────────────────────────────────
    if (action === "reset_password") {
      const { managerId, newPassword } = body as {
        managerId: string;
        newPassword: string;
      };
      if (!managerId || !newPassword || newPassword.length < 6) {
        return respond(
          { error: "managerId and newPassword (≥6 chars) required" },
          400,
        );
      }

      // Verify target is a branch manager
      const { data: mgr, error: mgrErr } = await admin
        .from("users")
        .select("role")
        .eq("id", managerId)
        .single();
      if (mgrErr || mgr?.role !== "branch_manager") {
        return respond({ error: "Branch manager not found" }, 403);
      }

      const { error: resetErr } = await admin.auth.admin.updateUserById(
        managerId,
        { password: newPassword },
      );
      if (resetErr) return respond({ error: resetErr.message }, 500);

      const { error: flagErr } = await admin
        .from("users")
        .update({ requires_password_change: true })
        .eq("id", managerId);
      if (flagErr) return respond({ error: flagErr.message }, 500);

      return respond({ success: true });
    }

    return respond({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return respond({ error: String(err) }, 500);
  }
});
