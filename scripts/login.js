import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+bundle'

// Substitua pelos seus dados reais do projeto Supabase
const supabaseUrl = 'https://lbyerfbehukyloqzcaqp.supabase.co'
const supabaseKey = 'sb_publishable_DoAs0hIlXXOA1B212ZTn9Q_HyqdLUeM'

const supabase = createClient(supabaseUrl, supabaseKey)

// Exemplo: Fazer login
async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: username,
    password: password,
  })
  if (error) throw error
  return data.user
}

// Exemplo: Salvar dados (apenas se o usuário estiver logado e a regra RLS permitir)
async function salvarDados(dados) {
  const { data, error } = await supabase
    .from('minha_tabela_secreta')
    .insert({ dados: dados, user_id: supabase.auth.user().id })
  if (error) console.error('Erro:', error)
}