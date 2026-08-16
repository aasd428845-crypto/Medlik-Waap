import { createClient } from '@supabase/supabase-js';

// Same Supabase project as the Flutter MedLink app (project ref: lmkomzqioneuyvatzsov).
// Values are read from VITE_* env vars; for local dev they live in .env.local.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://lmkomzqioneuyvatzsov.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'sb_publishable_yxm5GTZm87Y3wQwi019lXQ_IMLplZQc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
