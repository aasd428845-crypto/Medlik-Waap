import { createClient } from '@supabase/supabase-js';

// Same Supabase project as the Flutter MedLink app (project ref: lmkomzqioneuyvatzsov).
// Values are read from VITE_* env vars; for local dev they live in .env.local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Fail-closed local/test configuration (bonus E2E isolation): non-production
// builds MUST point at an explicit Supabase URL/key. The production fallback
// below applies to production builds only, so a missing local config can
// never silently reach production. Production deployment behavior is unchanged.
const isProdBuild = import.meta.env.PROD === true;
if ((!supabaseUrl || !supabaseAnonKey) && !isProdBuild) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Local and test runs must define both explicitly; the production fallback is disabled outside production builds.',
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://lmkomzqioneuyvatzsov.supabase.co',
  supabaseAnonKey || 'sb_publishable_yxm5GTZm87Y3wQwi019lXQ_IMLplZQc',
);
