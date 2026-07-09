// Database selection. Supabase when configured, otherwise the seeded
// localStorage adapter so the app works out of the box.

import { createLocalAdapter } from './localAdapter'
import { createSupabaseAdapter } from './supabaseAdapter'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const db = url && anonKey ? createSupabaseAdapter(url, anonKey) : createLocalAdapter()
