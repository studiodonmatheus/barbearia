const loginButton = document.getElementById("login-button")
const loginDialog = document.getElementById("login-dialog")

loginButton.addEventListener("click", () => {
    loginDialog.showModal()
})

loginDialog.addEventListener('click', (event) => {
    const rect = loginDialog.getBoundingClientRect()
    const clickedInside = 
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

    if (!clickedInside) {
        loginDialog.close()
    }
})