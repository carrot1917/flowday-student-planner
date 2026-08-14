import { createClient } from '@supabase/supabase-js';

// Supabase client singleton factory using Vite env variables.
// The app must set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dev/prod.
//
// IMPORTANT: only read Vite env via `import.meta.env`. Never reference
// `process.env` here — it does not exist in the browser bundle and would
// cause "process is not defined" crashes in production.

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!URL || !KEY) {
  // Don't throw — allow the app to boot in local-only mode when Supabase
  // is not configured. Tests can create clients manually.
  // eslint-disable-next-line no-console
  console.warn('Supabase client not configured: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found. App will run in local-only mode.');
}

export function createSupabaseClient() {
  if (!URL || !KEY) throw new Error('Supabase env not provided');
  return createClient(URL, KEY, { auth: { persistSession: true, detectSessionInUrl: false } });
}

export function isSupabaseConfigured(): boolean {
  return !!URL && !!KEY;
}

export default createSupabaseClient;
