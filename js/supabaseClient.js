import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://vlbzglnbxwpzvoohpomi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IPNmtu692uWuk9peuAa2aw_f5-15pdw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);