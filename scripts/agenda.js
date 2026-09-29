import { inserirReserva, obterHorarios } from './getSchedule.js';

const hoje = new Date();
hoje.setHours(0, 0, 0, 0);

const limiteData = new Date(hoje);
limiteData.setDate(limiteData.getDate() + 28);

let dataFocada = new Date(hoje);
let horarioSelecionado = null;
let horarios = {};
let reservas = [];
let disponibilidade = 'carregando';
let salvandoReserva = false;
const configuracaoAgenda = { abertura: 10, fechamento: 17 };

function formatarDataInput(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function criarChaveHorario(data, hora) {
    return `${formatarDataInput(data)} ${hora}`;
}

function minutosDoHorario(hora) {
    const [horas, minutos, segundos = 0] = hora.split(':').map(Number);
    return horas * 60 + minutos + segundos / 60;
}

function horarioJaPassou(data, hora) {
    const inicioHorario = new Date(data);
    const [horas, minutos] = hora.split(':').map(Number);
    inicioHorario.setHours(horas, minutos, 0, 0);
    return inicioHorario <= new Date();
}

function reservaSobrepoeHorario(data, horaInicio) {
    const dataFormatada = formatarDataInput(data);
    const inicioBloco = minutosDoHorario(horaInicio);
    const fimBloco = inicioBloco + 60;

    return reservas.some((reserva) => {
        if (reserva.dia_selecionado !== dataFormatada) return false;
        return minutosDoHorario(reserva.hora_inicio) < fimBloco
            && minutosDoHorario(reserva.hora_fim) > inicioBloco;
    });
}

function horarioIndisponivel(data, hora) {
    const status = horarios[criarChaveHorario(data, hora)];
    return status === 'reservado'
        || status === 'inativo'
        || reservaSobrepoeHorario(data, hora)
        || horarioJaPassou(data, hora);
}

function formatarCabecalho(data) {
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit'
    }).format(data).replace('.', '');
}

function atualizarResumoAgenda() {
    const [ano, mes, dia] = formatarDataInput(dataFocada).split('-');
    const resumo = document.getElementById('agenda-summary-value');

    resumo.textContent = horarioSelecionado
        ? `${dia}/${mes} às ${horarioSelecionado.split(' ')[1]}`
        : `${dia}/${mes}/${ano}`;
}

function moverFoco(dias) {
    const novaData = new Date(dataFocada);
    novaData.setDate(novaData.getDate() + dias);

    if (novaData >= hoje && novaData <= limiteData) {
        dataFocada = novaData;
        horarioSelecionado = null;
        document.getElementById('agenda-feedback').textContent = '';
        renderizarAgenda();
    }
}

function renderizarColuna(containerId, data, interativa) {
    const container = document.getElementById(containerId);
    container.replaceChildren();

    for (let hora = configuracaoAgenda.abertura; hora <= configuracaoAgenda.fechamento; hora += 1) {
        const horaFormatada = `${String(hora).padStart(2, '0')}:00`;
        const chave = criarChaveHorario(data, horaFormatada);
        const botao = document.createElement('button');
        const reservado = horarios[chave] === 'reservado'
            || reservaSobrepoeHorario(data, horaFormatada);
        const expirado = horarioJaPassou(data, horaFormatada);
        const status = reservado ? 'reservado' : horarios[chave] || (expirado ? 'inativo' : null);

        botao.type = 'button';
        botao.className = 'timeblock';
        botao.textContent = horaFormatada;
        botao.disabled = !interativa || disponibilidade !== 'pronta' || salvandoReserva
            || horarioIndisponivel(data, horaFormatada);
        if (status === 'reservado') {
            botao.setAttribute('aria-label', `${horaFormatada} - horário indisponível`);
            botao.title = 'Horário indisponível';
        }

        if (status) botao.classList.add(status);
        if (chave === horarioSelecionado && !botao.disabled) botao.classList.add('ativo');

        if (interativa && !botao.disabled) {
            botao.addEventListener('click', () => {
                if (horarioIndisponivel(data, horaFormatada)) {
                    if (horarioSelecionado === chave) horarioSelecionado = null;
                    renderizarAgenda();
                    return;
                }

                horarioSelecionado = horarioSelecionado === chave ? null : chave;
                document.getElementById('agenda-feedback').textContent = '';
                renderizarAgenda();
            });
        }

        container.appendChild(botao);
    }
}

function renderizarAgenda() {
    const dataAnterior = new Date(dataFocada);
    dataAnterior.setDate(dataAnterior.getDate() - 1);
    const proximaData = new Date(dataFocada);
    proximaData.setDate(proximaData.getDate() + 1);

    const seletorData = document.getElementById('agenda-date');
    seletorData.min = formatarDataInput(hoje);
    seletorData.max = formatarDataInput(limiteData);
    seletorData.value = formatarDataInput(dataFocada);
    atualizarResumoAgenda();

    document.getElementById('agenda-prev').disabled = dataFocada <= hoje;
    document.getElementById('agenda-next').disabled = dataFocada >= limiteData;

    const cabecalhoAnterior = document.getElementById('agenda-previous-header');
    cabecalhoAnterior.textContent = formatarCabecalho(dataAnterior);
    cabecalhoAnterior.disabled = dataAnterior < hoje;
    cabecalhoAnterior.onclick = () => moverFoco(-1);

    document.getElementById('agenda-current-header').textContent = formatarCabecalho(dataFocada);

    const cabecalhoProximo = document.getElementById('agenda-next-header');
    cabecalhoProximo.textContent = formatarCabecalho(proximaData);
    cabecalhoProximo.disabled = proximaData > limiteData;
    cabecalhoProximo.onclick = () => moverFoco(1);

    document.getElementById('retry-agenda').hidden = disponibilidade !== 'erro';
    document.getElementById('book-appointment').disabled = disponibilidade !== 'pronta'
        || salvandoReserva
        || !horarioSelecionado;

    renderizarColuna('agenda-previous-slots', dataAnterior, false);
    renderizarColuna('agenda-current-slots', dataFocada, true);
    renderizarColuna('agenda-next-slots', proximaData, false);
}

async function carregarHorarios() {
    disponibilidade = 'carregando';
    document.getElementById('agenda-feedback').textContent = 'Carregando disponibilidade...';
    renderizarAgenda();

    try {
        reservas = await obterHorarios(formatarDataInput(hoje), formatarDataInput(limiteData));
        disponibilidade = 'pronta';
        document.getElementById('agenda-feedback').textContent = '';
    } catch (error) {
        console.error('Erro ao carregar horários:', error);
        disponibilidade = 'erro';
        document.getElementById('agenda-feedback').textContent = 'Não foi possível carregar os horários. Tente novamente.';
    }

    renderizarAgenda();
}

document.getElementById('agenda-prev').addEventListener('click', () => moverFoco(-1));
document.getElementById('agenda-next').addEventListener('click', () => moverFoco(1));
document.getElementById('retry-agenda').addEventListener('click', carregarHorarios);

const painelAgenda = document.getElementById('agenda-panel');
painelAgenda.addEventListener('toggle', () => {
    if (!painelAgenda.open) return;

    requestAnimationFrame(() => {
        painelAgenda.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});

document.getElementById('agenda-date').addEventListener('change', (event) => {
    if (!event.target.value) return;
    const [ano, mes, dia] = event.target.value.split('-').map(Number);
    const dataEscolhida = new Date(ano, mes - 1, dia);
    dataEscolhida.setHours(0, 0, 0, 0);

    if (dataEscolhida >= hoje && dataEscolhida <= limiteData) {
        dataFocada = dataEscolhida;
        horarioSelecionado = null;
        document.getElementById('agenda-feedback').textContent = '';
        renderizarAgenda();
    }
});

document.getElementById('book-appointment').addEventListener('click', async () => {
    const feedback = document.getElementById('agenda-feedback');

    if (!horarioSelecionado) {
        feedback.textContent = 'Selecione um horário disponível para continuar.';
        return;
    }

    const servico = document.getElementById('Seletor de Serviço').value;
    const [data, hora] = horarioSelecionado.split(' ');
    const [ano, mes, dia] = data.split('-');
    const horaFim = `${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}:00:00`;

    salvandoReserva = true;
    feedback.textContent = 'Confirmando disponibilidade e salvando a reserva...';
    renderizarAgenda();

    try {
        const reservasDoDia = await obterHorarios(data, data);
        reservas = reservas.filter((reserva) => reserva.dia_selecionado !== data).concat(reservasDoDia);

        if (horarios[horarioSelecionado] || reservaSobrepoeHorario(new Date(`${data}T00:00:00`), hora)) {
            horarioSelecionado = null;
            feedback.textContent = 'Esse horário acabou de ficar indisponível. Escolha outro.';
            return;
        }

        await inserirReserva(data, `${hora}:00`, horaFim);
        reservas.push({
            dia_selecionado: data,
            hora_inicio: `${hora}:00`,
            hora_fim: horaFim
        });
        horarioSelecionado = null;
        feedback.textContent = `Reserva confirmada: ${servico}, ${dia}/${mes}/${ano} às ${hora}.`;
    } catch (error) {
        console.error('Erro ao salvar reserva:', error);
        feedback.textContent = 'Não foi possível salvar a reserva. Verifique as permissões do banco e tente novamente.';
    } finally {
        salvandoReserva = false;
        renderizarAgenda();
    }
});

window.alterarGradeHorarios = (abertura, fechamento) => {
    configuracaoAgenda.abertura = abertura;
    configuracaoAgenda.fechamento = fechamento;
    horarioSelecionado = null;
    renderizarAgenda();
};

window.desativarHorario = (data, hora) => {
    horarios[criarChaveHorario(data, hora)] = 'inativo';
    renderizarAgenda();
};

window.reservarHorario = (data, hora) => {
    const chave = criarChaveHorario(data, hora);
    horarios[chave] = 'reservado';
    if (horarioSelecionado === chave) horarioSelecionado = null;
    renderizarAgenda();
};

window.resetarHorario = (data, hora) => {
    delete horarios[criarChaveHorario(data, hora)];
    renderizarAgenda();
};

renderizarAgenda();
carregarHorarios();