import { supabase } from './supabaseClient.js'

export async function verificarAutorizacao(userId) {
  const { data, error } = await supabase
    .from('usuarios_autorizados')
    .select('user_id')
    .eq('user_id', userId)
    .eq('ativo', true)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function obterSessaoAutorizada() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) return null

  const autorizado = await verificarAutorizacao(data.session.user.id)
  if (autorizado) return data.session

  const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
  if (signOutError) throw signOutError
  return null
}
