const tabela = document.getElementById("tabela-horarios")
const btn = document.getElementById("atualizar-agenda");

let canUpdate = true;

async function buscarDados() {
    tabela.innerHTML = '<div class="loader"></div>';
    
    const url = "https://script.google.com/macros/s/AKfycbwzaNK4XDenKwweo77l1yde7XkLA8zwsp1akMKqVsq-QYv5TLR4SoSUK9OrUuGqTtXWLA/exec";
    
    try {
        let dados;

        if (canUpdate) {
            const resposta = await fetch(url);
            dados = await resposta.json();
            
            localStorage.setItem('agenda_cache', JSON.stringify(dados));
            canUpdate = false;
        } else {
            const cache = localStorage.getItem('agenda_cache');
            dados = JSON.parse(cache);
        }

        const agendamentos = dados.reservas || [];
        tabela.innerHTML = "";
        agendamentos.forEach(item => {
            const [servico, cliente, telefone, data] = item; // Destructuring para facilitar
            tabela.innerHTML += `
                <tr> 
                    <td>${servico}</td> 
                    <td>${cliente}</td> 
                    <td>${telefone}</td> 
                    <td>${data}</td> 
                </tr>`;
        });


        return dados;

    } catch (error) {
        console.error("Erro ao buscar dados:", error);
    }
}

btn.addEventListener("click", async (e) => {
    await buscarDados();
})