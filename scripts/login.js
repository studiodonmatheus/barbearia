import { verificarAutorizacao } from './auth.js'
import { supabase } from './supabaseClient.js'

const loginButton = document.getElementById('login-button')
const loginDialog = document.getElementById('login-dialog')
const loginForm = document.getElementById('login-form')
const loginEmail = document.getElementById('login-email')
const loginPassword = document.getElementById('login-password')
const loginFeedback = document.getElementById('login-feedback')
const loginSubmit = document.getElementById('login-submit')
let loginEmAndamento = false
const retornoAoAdmin = new URLSearchParams(window.location.search).get('redirect') === 'admin'

function atualizarBotaoLogin(autenticado) {
  if (autenticado) {
    loginButton.dataset.authenticated = 'true'
    loginButton.setAttribute('aria-label', 'Abrir painel administrativo')
    loginButton.title = 'Abrir painel administrativo'
    return
  }

  delete loginButton.dataset.authenticated
  loginButton.setAttribute('aria-label', 'Entrar')
  loginButton.title = 'Entrar'
}

loginButton.addEventListener('click', async () => {
  if (loginButton.dataset.authenticated === 'true') {
    window.location.assign('admin.html')
  }
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

    if (error) throw error
    if (!data.user) throw new Error('Não foi possível confirmar a conta.')

    const autorizado = await verificarAutorizacao(data.user.id)
    if (!autorizado) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      throw new Error('Esta conta não está autorizada a acessar a administração.')
    }

    window.location.replace('admin.html')
  } catch (error) {
    let feedback = error.message || 'Não foi possível entrar. Verifique as credenciais e a autorização da conta.'
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) feedback += ` Não foi possível encerrar a sessão: ${signOutError.message}`
    } catch (signOutError) {
      feedback += ` Não foi possível encerrar a sessão: ${signOutError.message}`
    }
    loginFeedback.textContent = feedback
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
    if (error) throw error
    if (!data.session) return

    const autorizado = await verificarAutorizacao(data.session.user.id)
    if (!autorizado) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      if (retornoAoAdmin) loginFeedback.textContent = 'Esta conta não está autorizada a acessar a administração.'
      return
    }

    atualizarBotaoLogin(true)
    if (retornoAoAdmin) window.location.replace('admin.html')
  } catch (error) {
    loginFeedback.textContent = error.message || 'Não foi possível restaurar a sessão.'
  }
}

if (retornoAoAdmin) loginDialog.showModal()
restaurarSessao()