import { createClient } from '@supabase/supabase-js';

// Same Supabase project as the Flutter MedLink app (project ref: lmkomzqioneuyvatzsov).
// Values are read from VITE_* env vars; for local dev they live in .env.local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY in artifacts/pharma-pwa/.env.local',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
