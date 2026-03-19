import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __skillvault_supabase_admin__: SupabaseClient | undefined;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceRole =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?.trim();

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRole);
}

export function getSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error("Supabase env vars are not configured.");
  }
  if (globalThis.__skillvault_supabase_admin__) {
    return globalThis.__skillvault_supabase_admin__;
  }
  globalThis.__skillvault_supabase_admin__ = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return globalThis.__skillvault_supabase_admin__;
}
