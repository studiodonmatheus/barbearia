import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://lbyerfbehukyloqzcaqp.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_DoAs0hIlXXOA1B212ZTn9Q_HyqdLUeM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)