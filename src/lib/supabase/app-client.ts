import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * App-wide Supabase client type.
 * Uses a permissive schema so @supabase/ssr + hand-written Database types
 * do not collapse inserts/selects to `never`.
 */
export type AppSupabaseClient = SupabaseClient;
