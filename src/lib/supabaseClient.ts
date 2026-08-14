import { createClient } from '@supabase/supabase-js';

// Supabase client singleton factory using Vite env variables.
// The app must set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dev/prod.

const URL = (import.meta.env.VITE_SUPABASE_URL as string) || (process.env.VITE_SUPABASE_URL as string);
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || (process.env.VITE_SUPABASE_ANON_KEY as string);

if (!URL || !KEY) {
  // don't throw — allow server-only or tests to create clients manually
  // but log for developer awareness
  // eslint-disable-next-line no-console
  console.warn('Supabase client not configured: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found');
}

export function createSupabaseClient() {
  if (!URL || !KEY) throw new Error('Supabase env not provided');
  return createClient(URL, KEY, { auth: { persistSession: true, detectSessionInUrl: false } });
}

export default createSupabaseClient;
