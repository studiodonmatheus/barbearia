const form = document.getElementById("agendar")
const card = document.getElementById("agendar-card")

async function sendToBackend(payload) {
    card.innerHTML = '<div class="loader" style="position: inherit;"></div>';
    const url = "https://script.google.com/macros/s/AKfycbwzaNK4XDenKwweo77l1yde7XkLA8zwsp1akMKqVsq-QYv5TLR4SoSUK9OrUuGqTtXWLA/exec";
    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error("Falha na comunicação:", error);
    }

    card.innerHTML = '<h1 style="margin: 0 auto;">Agendamento realizado!</h1>'
}

form.addEventListener("submit", (e) => {
    e.preventDefault()

    const data = new FormData(form)
    const payload = Object.fromEntries(data.entries())
    var dataEscolhida = payload.data + " " + payload.hora
    
    sendToBackend({ data: dataEscolhida,  servico: payload.servico, cliente: payload.nome, contato: payload.telefone })
})

const seletorData = document.getElementById("data")

const dataMinima = new Date()
dataMinima.setDate(dataMinima.getDate()+1)
const mes = String(dataMinima.getMonth() + 1).padStart(2, '0')
const dia = String(dataMinima.getDate()).padStart(2, '0')

seletorData.min = `${dataMinima.getFullYear()}-${mes}-${dia}`