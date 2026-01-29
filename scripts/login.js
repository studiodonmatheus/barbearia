// OBTER PARAMETROS DA URL
const params = new URLSearchParams(document.location.search)
const msg = params.get("msg")
if (msg != null) {
    console.log(msg)
    // Limpar URL
    window.history.replaceState(null, "", window.location.origin + window.location.pathname)
}

// ESTADO DA PÁGINA 
// (work around preguiçoso para mudar entre logar e cadastrar)
const Estados = {
    login: 0,
    signin: 1,
}
var estado = Estados.login

const card = document.getElementsByClassName("card")[0]
const cardTitle = document.getElementsByClassName("card-title")[0]

// = = = = = FORMULÁRIO DE LOGIN = = = = = 
const loginForm = document.getElementById("login")

// = = = = = FORMULÁRIO DE CADASTRO = = = = = 
const signinForm = document.getElementById("sign-in")

// ALTERNAR ENTRAR / CADASTRAR
cardTitle.addEventListener("click", (e)=>{
    switch (estado) {
        case Estados.login:
            loginForm.style = "display: none;"
            signinForm.style = "display: block;"

            cardTitle.innerHTML = "Cadastrar"

            estado = Estados.signin
            break
    
        case Estados.signin:
            loginForm.style = "display: block;"
            signinForm.style = "display: none;"

            cardTitle.innerHTML = "Entrar"

            estado = Estados.login
            break
    }
})