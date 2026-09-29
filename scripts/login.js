import { supabase } from './supabaseClient.js'

const loginButton = document.getElementById('login-button')
const loginDialog = document.getElementById('login-dialog')
const loginForm = document.getElementById('login-form')
const loginEmail = document.getElementById('login-email')
const loginPassword = document.getElementById('login-password')
const loginFeedback = document.getElementById('login-feedback')
const loginSubmit = document.getElementById('login-submit')
let loginEmAndamento = false

function atualizarBotaoLogin(autenticado) {
  if (autenticado) {
    loginButton.dataset.authenticated = 'true'
    loginButton.setAttribute('aria-label', 'Sair da conta')
    loginButton.title = 'Sair da conta'
    return
  }

  delete loginButton.dataset.authenticated
  loginButton.setAttribute('aria-label', 'Entrar')
  loginButton.title = 'Entrar'
}

async function verificarAutorizacao(userId) {
  const { data, error } = await supabase
    .from('usuarios_autorizados')
    .select('user_id')
    .eq('user_id', userId)
    .eq('ativo', true)
    .maybeSingle()

  return !error && Boolean(data)
}

async function sair() {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error

    atualizarBotaoLogin(false)
    loginForm.reset()
    loginFeedback.textContent = ''
  } catch {
    loginFeedback.textContent = 'Não foi possível encerrar a sessão. Tente novamente.'
    loginDialog.showModal()
  }
}

loginButton.addEventListener('click', async () => {
  if (loginButton.dataset.authenticated !== 'true') return

  loginButton.disabled = true
  await sair()
  loginButton.disabled = false
})

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (loginEmAndamento) return

  loginEmAndamento = true
  loginSubmit.disabled = true
  loginFeedback.textContent = 'Validando acesso...'

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    })

    if (error || !data.user) {
      loginFeedback.textContent = 'Não foi possível entrar. Verifique as credenciais e a autorização da conta.'
      return
    }

    const autorizado = await verificarAutorizacao(data.user.id)
    if (!autorizado) {
      await supabase.auth.signOut({ scope: 'local' })
      loginFeedback.textContent = 'Não foi possível entrar. Verifique as credenciais e a autorização da conta.'
      return
    }

    atualizarBotaoLogin(true)
    loginDialog.close()
    loginForm.reset()
    loginFeedback.textContent = ''
  } catch {
    await supabase.auth.signOut({ scope: 'local' })
    loginFeedback.textContent = 'Não foi possível entrar. Verifique as credenciais e a autorização da conta.'
  } finally {
    loginPassword.value = ''
    loginSubmit.disabled = false
    loginEmAndamento = false
  }
})

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') atualizarBotaoLogin(false)
})

async function restaurarSessao() {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) return

    const autorizado = await verificarAutorizacao(data.session.user.id)
    if (!autorizado) {
      await supabase.auth.signOut({ scope: 'local' })
      return
    }

    atualizarBotaoLogin(true)
  } catch {
    await supabase.auth.signOut({ scope: 'local' })
  }
}

restaurarSessao()