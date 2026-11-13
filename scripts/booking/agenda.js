import { inserirReserva, obterHorarios, obterServicos } from './getSchedule.js';

const hoje = new Date();
hoje.setHours(0, 0, 0, 0);

const limiteData = new Date(hoje);
limiteData.setDate(limiteData.getDate() + 28);
const intervaloHorarioMinutos = 5;
const duracaoReservaMinutos = 30;
const configuracaoAgenda = { abertura: 10, fechamento: 20 };

let reservas = [];
let disponibilidade = 'carregando';
let salvandoReserva = false;
let servicosDisponiveis = false;
let erroAoCarregarHorarios = false;
let erroAoCarregarServicos = false;
let mensagemReserva = '';
let estadoMensagemReserva = '';

const seletorData = document.getElementById('agenda-date');
const seletorHorario = document.getElementById('agenda-time');
const dropdownHorarios = document.getElementById('agenda-time-dropdown');
const listaHorarios = document.getElementById('agenda-time-options');
const mensagemListaHorarios = document.getElementById('agenda-time-empty');
const seletorServico = document.getElementById('service-select');
const feedback = document.getElementById('agenda-feedback');
const botaoAgendar = document.getElementById('book-appointment');

let listaHorarioAberta = false;

function formatarDataInput(data) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function dataIndisponivel(data) {
    const diaDaSemana = new Date(`${data}T00:00:00`).getDay();
    return diaDaSemana === 0 || diaDaSemana === 1;
}

function minutosDoHorario(hora) {
    const [horas, minutos, segundos = 0] = hora.split(':').map(Number);
    return horas * 60 + minutos + segundos / 60;
}

function horarioAposMinutos(hora, minutosAdicionais) {
    const total = minutosDoHorario(hora) + minutosAdicionais;
    const horas = Math.floor(total / 60);
    const minutos = total % 60;
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:00`;
}

function formatarHorario(minutos) {
    const horas = Math.floor(minutos / 60);
    const minutosRestantes = minutos % 60;
    return `${String(horas).padStart(2, '0')}:${String(minutosRestantes).padStart(2, '0')}`;
}

function horarioValido(hora) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(hora);
}

function horarioJaPassou(data, hora) {
    return new Date(`${data}T${hora}:00`) <= new Date();
}

function reservaSobrepoeHorario(data, horaInicio) {
    const inicioEscolhido = minutosDoHorario(horaInicio);
    const fimEscolhido = inicioEscolhido + duracaoReservaMinutos;

    return reservas.some((reserva) => {
        if (reserva.dia_selecionado !== data) return false;
        return minutosDoHorario(reserva.hora_inicio) < fimEscolhido
            && minutosDoHorario(reserva.hora_fim) > inicioEscolhido;
    });
}

function horarioIndisponivel(data, hora) {
    const inicio = minutosDoHorario(hora);
    const abertura = configuracaoAgenda.abertura * 60;
    const fechamento = configuracaoAgenda.fechamento * 60;
    const dataSelecionada = new Date(`${data}T00:00:00`);

    return inicio < abertura
        || inicio + duracaoReservaMinutos > fechamento
        || horarioJaPassou(data, hora)
        || dataIndisponivel(data)
        || dataSelecionada < hoje
        || dataSelecionada > limiteData
        || reservaSobrepoeHorario(data, hora);
}

function atualizarFeedbackCarregamento() {
    if (mensagemReserva) {
        feedback.textContent = mensagemReserva;
        feedback.dataset.state = estadoMensagemReserva;
        return;
    }

    feedback.removeAttribute('data-state');
    if (erroAoCarregarHorarios) {
        feedback.textContent = 'Não foi possível carregar os horários. Tente novamente.';
    } else if (erroAoCarregarServicos) {
        feedback.textContent = 'Não foi possível carregar os serviços. Tente novamente mais tarde.';
    } else if (disponibilidade === 'carregando') {
        feedback.textContent = 'Carregando disponibilidade...';
    } else if (!servicosDisponiveis) {
        feedback.textContent = 'Nenhum serviço disponível para agendamento no momento.';
    } else {
        feedback.textContent = '';
    }
}

function atualizarFeedbackReserva(mensagem, estado) {
    mensagemReserva = mensagem;
    estadoMensagemReserva = estado;
    atualizarFeedbackCarregamento();
}

function limparFeedbackReserva() {
    mensagemReserva = '';
    estadoMensagemReserva = '';
    feedback.removeAttribute('data-state');
}

function atualizarLimitesHorario() {
    const abertura = `${String(configuracaoAgenda.abertura).padStart(2, '0')}:00`;
    const fechamento = horarioAposMinutos(
        `${String(configuracaoAgenda.fechamento).padStart(2, '0')}:00`,
        -duracaoReservaMinutos
    ).slice(0, 5);
    seletorHorario.min = abertura;
    seletorHorario.max = fechamento;
}

function atualizarListaHorarios() {
    listaHorarios.replaceChildren();
    const abertura = configuracaoAgenda.abertura * 60;
    const fechamento = configuracaoAgenda.fechamento * 60 - duracaoReservaMinutos;
    const data = seletorData.value;

    if (data && disponibilidade === 'pronta') {
        for (let minuto = abertura; minuto <= fechamento; minuto += intervaloHorarioMinutos) {
            const hora = formatarHorario(minuto);
            if (horarioIndisponivel(data, hora)) continue;
            const opcao = document.createElement('button');

            opcao.type = 'button';
            opcao.className = 'agenda-time-option';
            opcao.setAttribute('role', 'option');
            opcao.setAttribute('aria-selected', String(seletorHorario.value === hora));
            opcao.textContent = hora;
            opcao.addEventListener('click', () => {
                limparFeedbackReserva();
                seletorHorario.value = hora;
                fecharListaHorarios();
                validarHorarioSelecionado();
            });
            listaHorarios.appendChild(opcao);
        }
    }

    if (listaHorarios.childElementCount === 0) {
        mensagemListaHorarios.textContent = disponibilidade === 'erro'
            ? 'Não foi possível carregar os horários.'
            : 'Não há horários disponíveis para esta data.';
        mensagemListaHorarios.hidden = false;
    } else {
        mensagemListaHorarios.hidden = true;
    }

    dropdownHorarios.hidden = !listaHorarioAberta || !data;
    seletorHorario.setAttribute('aria-expanded', String(!dropdownHorarios.hidden));
}

function abrirListaHorarios() {
    listaHorarioAberta = true;
    atualizarListaHorarios();
}

function fecharListaHorarios() {
    listaHorarioAberta = false;
    atualizarListaHorarios();
}

function validarHorarioSelecionado() {
    const data = seletorData.value;
    const hora = seletorHorario.value;
    seletorHorario.setCustomValidity('');
    seletorHorario.removeAttribute('aria-invalid');
    seletorData.setCustomValidity('');
    seletorData.removeAttribute('aria-invalid');

    if (!data || disponibilidade !== 'pronta') {
        botaoAgendar.disabled = true;
        return false;
    }

    if (dataIndisponivel(data)) {
        const mensagem = 'Não aceitamos reservas aos domingos e às segundas-feiras. Escolha outra data.';
        seletorData.setCustomValidity(mensagem);
        seletorData.setAttribute('aria-invalid', 'true');
        feedback.textContent = mensagem;
        botaoAgendar.disabled = true;
        return false;
    }

    if (!hora) {
        atualizarFeedbackCarregamento();
        botaoAgendar.disabled = true;
        return false;
    }

    if (!horarioValido(hora)) {
        const mensagem = 'Digite um horário válido no formato 24 horas (HH:MM).';
        seletorHorario.setCustomValidity(mensagem);
        seletorHorario.setAttribute('aria-invalid', 'true');
        feedback.textContent = mensagem;
        botaoAgendar.disabled = true;
        return false;
    }

    if (horarioIndisponivel(data, hora)) {
        const mensagem = 'Esse horário está indisponível ou fora do horário de atendimento. Escolha outro.';
        seletorHorario.setCustomValidity(mensagem);
        seletorHorario.setAttribute('aria-invalid', 'true');
        feedback.textContent = mensagem;
        botaoAgendar.disabled = true;
        return false;
    }

    atualizarFeedbackCarregamento();
    botaoAgendar.disabled = salvandoReserva || !servicosDisponiveis || !seletorServico.value;
    return true;
}

function renderizarAgenda() {
    seletorData.min = formatarDataInput(hoje);
    seletorData.max = formatarDataInput(limiteData);
    if (!seletorData.value) {
        const primeiraDataDisponivel = new Date(hoje);
        while (primeiraDataDisponivel <= limiteData && dataIndisponivel(formatarDataInput(primeiraDataDisponivel))) {
            primeiraDataDisponivel.setDate(primeiraDataDisponivel.getDate() + 1);
        }
        seletorData.value = formatarDataInput(primeiraDataDisponivel);
    }
    atualizarLimitesHorario();
    seletorData.disabled = disponibilidade !== 'pronta' || salvandoReserva;
    seletorHorario.disabled = disponibilidade !== 'pronta' || salvandoReserva;
    document.getElementById('retry-agenda').hidden = disponibilidade !== 'erro' && !erroAoCarregarServicos;
    atualizarListaHorarios();
    validarHorarioSelecionado();
}

async function carregarHorarios() {
    disponibilidade = 'carregando';
    erroAoCarregarHorarios = false;
    atualizarFeedbackCarregamento();
    renderizarAgenda();

    try {
        reservas = await obterHorarios(formatarDataInput(hoje), formatarDataInput(limiteData));
        disponibilidade = 'pronta';
        atualizarFeedbackCarregamento();
    } catch (error) {
        console.error('Erro ao carregar horários:', error);
        disponibilidade = 'erro';
        erroAoCarregarHorarios = true;
        atualizarFeedbackCarregamento();
    }

    renderizarAgenda();
}

async function carregarHorariosDaData(data) {
    try {
        const reservasDoDia = await obterHorarios(data, data);
        reservas = reservas.filter((reserva) => reserva.dia_selecionado !== data).concat(reservasDoDia);
        erroAoCarregarHorarios = false;
        disponibilidade = 'pronta';
        atualizarFeedbackCarregamento();
    } catch (error) {
        console.error('Erro ao atualizar horários:', error);
        disponibilidade = 'erro';
        erroAoCarregarHorarios = true;
        atualizarFeedbackCarregamento();
    }
}

async function carregarServicos() {
    seletorServico.disabled = true;
    try {
        const servicos = await obterServicos();
        seletorServico.replaceChildren(new Option('Selecione um serviço', ''));
        for (const servico of servicos) {
            seletorServico.add(new Option(`${servico.name} — R$ ${Number(servico.price).toFixed(2).replace('.', ',')}`, servico.id));
        }
        servicosDisponiveis = servicos.length > 0;
        erroAoCarregarServicos = false;
        if (servicosDisponiveis) {
            seletorServico.value = servicos[0].id;
            seletorServico.disabled = false;
        }
    } catch (error) {
        console.error('Erro ao carregar serviços:', error);
        erroAoCarregarServicos = true;
    }
    atualizarFeedbackCarregamento();
    renderizarAgenda();
}

document.getElementById('retry-agenda').addEventListener('click', async () => {
    if (disponibilidade === 'erro') await carregarHorarios();
    if (erroAoCarregarServicos) await carregarServicos();
});

seletorData.addEventListener('change', async () => {
    limparFeedbackReserva();
    seletorHorario.value = '';
    seletorHorario.setCustomValidity('');
    if (dataIndisponivel(seletorData.value)) {
        renderizarAgenda();
        return;
    }

    if (!seletorData.value) {
        renderizarAgenda();
        return;
    }

    disponibilidade = 'carregando';
    atualizarFeedbackCarregamento();
    renderizarAgenda();
    await carregarHorariosDaData(seletorData.value);
    renderizarAgenda();
});

seletorHorario.addEventListener('input', () => {
    limparFeedbackReserva();
    atualizarListaHorarios();
    validarHorarioSelecionado();
});
seletorHorario.addEventListener('change', () => {
    limparFeedbackReserva();
    validarHorarioSelecionado();
});
seletorHorario.addEventListener('focus', abrirListaHorarios);
seletorHorario.addEventListener('click', abrirListaHorarios);
seletorHorario.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        fecharListaHorarios();
        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        abrirListaHorarios();
        listaHorarios.querySelector('.agenda-time-option:not(:disabled)')?.focus();
    }
});
listaHorarios.addEventListener('keydown', (event) => {
    const opcoes = [...listaHorarios.querySelectorAll('.agenda-time-option:not(:disabled)')];
    const indiceAtual = opcoes.indexOf(document.activeElement);
    let indiceNovo = indiceAtual;

    if (event.key === 'ArrowDown') indiceNovo = Math.min(indiceAtual + 1, opcoes.length - 1);
    else if (event.key === 'ArrowUp') indiceNovo = Math.max(indiceAtual - 1, 0);
    else if (event.key === 'Escape') {
        fecharListaHorarios();
        seletorHorario.focus();
        return;
    } else if (event.key === 'Tab') {
        fecharListaHorarios();
        return;
    } else return;

    event.preventDefault();
    opcoes[indiceNovo]?.focus();
});
document.addEventListener('click', (event) => {
    if (!event.target.closest('.agenda-time-picker')) fecharListaHorarios();
});
seletorServico.addEventListener('change', () => {
    limparFeedbackReserva();
    atualizarFeedbackCarregamento();
    renderizarAgenda();
});

botaoAgendar.addEventListener('click', async () => {
    if (!validarHorarioSelecionado()) return;

    const servico = seletorServico.options[seletorServico.selectedIndex]?.textContent?.split(' — ')[0];
    if (!servicosDisponiveis || !seletorServico.value) {
        feedback.textContent = 'Selecione um serviço disponível para continuar.';
        return;
    }

    const data = seletorData.value;
    const hora = seletorHorario.value;
    if (!horarioValido(hora)) return;
    const [ano, mes, dia] = data.split('-');
    const horaFim = horarioAposMinutos(hora, duracaoReservaMinutos);
    salvandoReserva = true;
    atualizarFeedbackReserva('Confirmando disponibilidade e salvando a reserva...', 'loading');
    renderizarAgenda();

    try {
        await carregarHorariosDaData(data);
        if (disponibilidade !== 'pronta') {
            atualizarFeedbackReserva('Não foi possível confirmar a disponibilidade. Tente novamente.', 'error');
            return;
        }
        if (horarioIndisponivel(data, hora)) {
            atualizarFeedbackReserva('Esse horário acabou de ser reservado. Escolha outro.', 'error');
            seletorHorario.value = '';
            return;
        }

        await inserirReserva(data, `${hora}:00`, horaFim);
        reservas.push({
            dia_selecionado: data,
            hora_inicio: `${hora}:00`,
            hora_fim: horaFim
        });
        seletorHorario.value = '';
        atualizarFeedbackReserva(`Reserva confirmada: ${servico}, ${dia}/${mes}/${ano} às ${hora}.`, 'success');
    } catch (error) {
        console.error('Erro ao salvar reserva:', error);
        atualizarFeedbackReserva('Não foi possível salvar a reserva. Verifique as permissões do banco e tente novamente.', 'error');
    } finally {
        salvandoReserva = false;
        renderizarAgenda();
    }
});

window.alterarGradeHorarios = (abertura, fechamento) => {
    if (!Number.isInteger(abertura) || !Number.isInteger(fechamento)
        || abertura < 0 || fechamento > 23 || abertura >= fechamento) return;

    configuracaoAgenda.abertura = abertura;
    configuracaoAgenda.fechamento = fechamento;
    renderizarAgenda();
};

renderizarAgenda();
carregarHorarios();
carregarServicos();
