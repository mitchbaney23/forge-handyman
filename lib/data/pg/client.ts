import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton, following the lib/security/rate-limit.ts pattern: nothing
// happens at import time, so modules can be loaded without Supabase env vars
// (e.g. while DATA_BACKEND=sheet) and the client is built exactly once per
// process on first use.
let clientInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (clientInstance) return clientInstance
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (Supabase dashboard → Project Settings → API). ' +
        'The service-role key bypasses RLS: mark it Sensitive in Vercel, Production scope only, never NEXT_PUBLIC_.',
    )
  }
  clientInstance = createClient(url, key, {
    auth: { persistSession: false },
  })
  return clientInstance
}
