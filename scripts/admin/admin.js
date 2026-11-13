import { obterSessaoAutorizada } from '../auth/auth.js';
import { supabase } from '../shared/supabaseClient.js';
import { adminData } from './adminData.js';
import {
  DATE_LOCALE,
  STATUS,
  addDays,
  asDateKey,
  createAdminStore,
  dateFromKey,
  localDateKey,
  startOfMonth,
} from './store.js';

(() => {
  'use strict';

  const iconPaths = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12.3 12.3M14.5 9.5 20.5 3.5M8.2 15.8l3.4-3.4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    chart: '<path d="M3 3v18h18M7 14l4-4 3 3 6-7"/>',
    empty: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h4M8 17h6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  };

  function icon(name, className = '') {
    const path = iconPaths[name] || iconPaths.empty;
    return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat(DATE_LOCALE, { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function formatCompactCurrency(value) {
    const amount = Number(value) || 0;
    if (amount >= 1_000_000) {
      return new Intl.NumberFormat(DATE_LOCALE, { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(amount);
    }
    if (amount >= 1_000) return `R$ ${(amount / 1000).toLocaleString(DATE_LOCALE, { maximumFractionDigits: 1 })} mil`;
    return `R$ ${Math.round(amount).toLocaleString(DATE_LOCALE)}`;
  }

  function formatMonth(dateLike) {
    const date = dateLike instanceof Date ? dateLike : dateFromKey(asDateKey(dateLike));
    return new Intl.DateTimeFormat(DATE_LOCALE, { month: 'long', year: 'numeric' }).format(date);
  }

  function formatLongDate(dateKey, options = {}) {
    return new Intl.DateTimeFormat(DATE_LOCALE, {
      weekday: 'long', day: 'numeric', month: 'long', ...(options || {}),
    }).format(dateFromKey(dateKey));
  }

  const store = createAdminStore();

  const today = localDateKey(new Date());
  const state = {
    activeView: 'earnings',
    earningsMonth: startOfMonth(dateFromKey(today)),
    earningsDate: today,
    agendaDate: today,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function setFeedback(selector, message = '') {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-visible', Boolean(message));
  }

  function announce(message) {
    setText('#global-feedback', message);
  }

  function emptyState(title, description, actionMarkup = '') {
    return `<div class="empty-state">${icon('empty')}<strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p>${actionMarkup}</div>`;
  }

  function renderMonthlyChart(monthly) {
    const container = $('#earnings-chart');
    if (!container) return;

    const width = 860;
    const height = 270;
    const plot = { left: 66, right: 20, top: 17, bottom: 39 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const values = monthly.days.map((day) => day.revenue);
    const rawMax = Math.max(0, ...values);
    const roughStep = rawMax > 0 ? rawMax / 4 : 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    const normalized = roughStep / magnitude;
    const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = niceFactor * magnitude;
    const maxValue = rawMax > 0 ? Math.max(step * 4, Math.ceil(rawMax / step) * step) : 1;
    const xFor = (index) => plot.left + (monthly.days.length <= 1 ? 0 : (index / (monthly.days.length - 1)) * plotWidth);
    const yFor = (value) => plot.top + plotHeight - (value / maxValue) * plotHeight;
    const hasActivity = monthly.serviceCount > 0;
    const path = monthly.days.map((day, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(2)} ${yFor(day.revenue).toFixed(2)}`).join(' ');
    const area = `${path} L ${xFor(monthly.days.length - 1).toFixed(2)} ${(plot.top + plotHeight).toFixed(2)} L ${xFor(0).toFixed(2)} ${(plot.top + plotHeight).toFixed(2)} Z`;

    let grid = '';
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = (maxValue / 4) * tick;
      const y = yFor(value);
      grid += `<line class="grid-line" x1="${plot.left}" y1="${y}" x2="${width - plot.right}" y2="${y}"/><text x="${plot.left - 11}" y="${y + 4}" text-anchor="end">${escapeHTML(formatCompactCurrency(value))}</text>`;
    }

    const desiredLabels = new Set([1, Math.ceil(monthly.days.length / 4), Math.ceil(monthly.days.length / 2), Math.ceil((monthly.days.length * 3) / 4), monthly.days.length]);
    let xLabels = '';
    monthly.days.forEach((day, index) => {
      if (desiredLabels.has(day.day)) {
        const anchor = day.day === 1 ? 'start' : day.day === monthly.days.length ? 'end' : 'middle';
        xLabels += `<text x="${xFor(index)}" y="${height - 11}" text-anchor="${anchor}">${day.day}</text>`;
      }
    });

    let points = '';
    if (hasActivity) {
      const selectedDate = state.earningsDate;
      monthly.days.forEach((day, index) => {
        if (day.count === 0) return;
        const label = `${formatLongDate(day.date)}: ${formatCurrency(day.revenue)} · ${day.count} ${day.count === 1 ? 'serviço' : 'serviços'}`;
        points += `<circle class="chart-point" cx="${xFor(index)}" cy="${yFor(day.revenue)}" r="4"><title>${escapeHTML(label)}</title></circle>`;
        if (day.date === selectedDate) {
          points += `<circle cx="${xFor(index)}" cy="${yFor(day.revenue)}" r="8" fill="none" stroke="var(--accent-gold)" stroke-width="1.4" opacity="0.7"><title>Dia selecionado</title></circle>`;
        }
      });
    }

    container.innerHTML = `
      <svg class="earnings-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico dos ganhos diários de ${escapeHTML(formatMonth(state.earningsMonth))}">
        <defs><linearGradient id="earnings-area-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent-gold)" stop-opacity="0.28"/><stop offset="100%" stop-color="var(--accent-gold)" stop-opacity="0.01"/></linearGradient></defs>
        ${grid}
        ${xLabels}
        ${hasActivity ? `<path class="chart-area" d="${area}"/><path class="chart-line" d="${path}"/>${points}` : ''}
      </svg>
      ${hasActivity ? '' : `<div class="chart-empty-state">${icon('chart')}<strong>Nenhum ganho registrado neste mês</strong><span>Quando um atendimento for marcado como concluído, o gráfico será calculado automaticamente.</span></div>`}
    `;
  }

  function renderEarningsList(summary) {
    const container = $('#daily-earnings-list');
    if (!container) return;
    if (!summary.completedAppointments.length) {
      container.innerHTML = emptyState(
        'Nenhum serviço concluído neste dia',
        'Os atendimentos aparecem aqui depois de serem marcados como concluídos na agenda.',
        '<button class="button-subtle button-with-icon" type="button" data-open-appointment><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Novo agendamento</button>',
      );
      return;
    }

    container.innerHTML = summary.completedAppointments.map((appointment) => {
      const service = store.getService(appointment.serviceId);
      const serviceName = service?.name || 'Serviço não cadastrado';
      const revenue = store.getRevenueForAppointment(appointment);
      return `
        <article class="earning-item">
          <span class="earning-service-icon">${icon('scissors')}</span>
          <div class="earning-main">
            <span class="service-name">${escapeHTML(serviceName)}</span>
            <span class="earning-meta">${escapeHTML(appointment.time)} · ${escapeHTML(appointment.client)}</span>
          </div>
          <strong class="earning-value">${escapeHTML(formatCurrency(revenue))}</strong>
        </article>`;
    }).join('');
  }

  function renderEarnings() {
    const monthly = store.getMonthlyEarnings(state.earningsMonth);
    const summary = store.getDailySummary(state.earningsDate);
    setText('#earnings-month-label', formatMonth(state.earningsMonth));
    setText('#month-revenue', formatCurrency(monthly.totalRevenue));
    setText('#month-revenue-caption', `${monthly.serviceCount} ${monthly.serviceCount === 1 ? 'serviço concluído' : 'serviços concluídos'} no mês`);
    setText('#daily-completed-count', String(summary.completedCount));
    setText('#daily-revenue', formatCurrency(summary.revenue));
    setText('#daily-scheduled-count', String(summary.scheduledCount));

    const dateInput = $('#earnings-date');
    if (dateInput && dateInput.value !== state.earningsDate) dateInput.value = state.earningsDate;
    renderMonthlyChart(monthly);
    renderEarningsList(summary);
  }

  function renderUpcomingDays() {
    const container = $('#upcoming-days-list');
    if (!container) return;
    const dateKeys = Array.from({ length: 7 }, (_, index) => addDays(today, index));
    const appointmentsByDay = dateKeys.map((dateKey) => store.getAppointmentsForDate(dateKey)
      .filter((appointment) => appointment.status === STATUS.SCHEDULED)
      .sort((a, b) => a.time.localeCompare(b.time)));
    const totalUpcoming = appointmentsByDay.reduce((sum, list) => sum + list.length, 0);
    const timeSlots = [...new Set(appointmentsByDay.flatMap(list => list.map(item => item.time)))].sort();

    const headers = dateKeys.map(dateKey => {
      const date = dateFromKey(dateKey);
      const weekday = new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' }).format(date).replace('.', '');
      const dayNumber = new Intl.DateTimeFormat(DATE_LOCALE, { day: '2-digit' }).format(date);
      const selected = dateKey === state.agendaDate;
      return `<th scope="col"><button type="button" class="upcoming-date-button${selected ? ' is-selected' : ''}" data-select-agenda-date="${escapeHTML(dateKey)}" aria-pressed="${selected}"><span>${escapeHTML(weekday)}</span><strong>${escapeHTML(dayNumber)}</strong><small>${appointmentsByDay[dateKeys.indexOf(dateKey)].length || ''}</small></button></th>`;
    }).join('');

    const rows = timeSlots.map(time => {
      const cells = dateKeys.map((dateKey, dayIndex) => {
        const appointment = appointmentsByDay[dayIndex].find(item => item.time === time);
        if (!appointment) return '<td><span class="upcoming-slot-empty">—</span></td>';
        const serviceName = appointment.source === 'public'
          ? 'Reserva ou bloqueio'
          : store.getService(appointment.serviceId)?.name || 'Atendimento';
        const clientName = appointment.source === 'public' ? 'Período indisponível' : appointment.client || serviceName;
        return `<td><button type="button" class="upcoming-slot-booked" data-select-agenda-date="${escapeHTML(dateKey)}" title="${escapeHTML(`${clientName} · ${serviceName}`)}"><strong>${escapeHTML(clientName)}</strong><span>${escapeHTML(serviceName)}</span></button></td>`;
      }).join('');
      return `<tr><th scope="row" class="upcoming-time">${escapeHTML(time)}</th>${cells}</tr>`;
    }).join('');

    if (!timeSlots.length) {
      container.innerHTML = `<div class="upcoming-empty">${icon('calendar')}<span>Nenhum agendamento nos próximos 7 dias.</span></div>`;
    } else {
      container.innerHTML = `<div class="upcoming-table-wrap"><table class="upcoming-table"><thead><tr><th class="upcoming-time-heading">Hora</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    setText('#upcoming-total', `${totalUpcoming} ${totalUpcoming === 1 ? 'horário ocupado' : 'horários ocupados'}`);
  }

  function statusMarkup(status) {
    if (status === STATUS.COMPLETED) return `<span class="status-badge status-completed">${icon('check')}Concluído</span>`;
    if (status === STATUS.CANCELLED) return `<span class="status-badge status-cancelled">${icon('close')}Cancelado</span>`;
    return `<span class="status-badge status-scheduled">${icon('clock')}Agendado</span>`;
  }

  function renderScheduleDetail() {
    const container = $('#schedule-day-list');
    if (!container) return;
    const allAppointments = store.getAppointmentsForDate(state.agendaDate);
    const visibleCount = allAppointments.length;
    setText('#agenda-selected-date-label', formatLongDate(state.agendaDate));
    setText('#agenda-day-total', `${visibleCount} ${visibleCount === 1 ? 'item na agenda' : 'itens na agenda'}`);
    const dateInput = $('#agenda-date');
    if (dateInput && dateInput.value !== state.agendaDate) dateInput.value = state.agendaDate;

    if (!allAppointments.length) {
      container.innerHTML = emptyState(
        'Sua agenda está livre neste dia',
        store.getServices().length
          ? 'Adicione um horário para organizar os próximos atendimentos.'
          : 'Cadastre um serviço e depois adicione os primeiros agendamentos.',
        `<button class="button-primary button-with-icon" type="button" data-open-appointment>${icon('calendar')}Novo agendamento</button>${store.getServices().length ? '' : '<button class="button-subtle" type="button" data-open-service-dialog>Cadastrar serviço</button>'}`,
      );
      return;
    }

    container.innerHTML = `<div class="schedule-day-group"><ul class="schedule-appointments">${allAppointments.map((appointment) => {
      const service = store.getService(appointment.serviceId);
      const serviceName = appointment.source === 'public'
        ? 'Reserva ou bloqueio de horário'
        : service?.name || 'Serviço não cadastrado';
      const amount = appointment.price != null ? Number(appointment.price) : Number(service?.price) || 0;
      const isCancelled = appointment.status === STATUS.CANCELLED;
      let actions = '';
      if (appointment.source === 'public') {
        actions = `<div class="schedule-actions"><span class="earning-meta">Reserva pública ou bloqueio manual</span><button class="small-action" type="button" data-action="edit" data-appointment-id="${escapeHTML(appointment.id)}">${icon('edit')}Editar período</button></div>`;
      } else {
        actions = `<div class="schedule-actions"><button class="small-action" type="button" data-action="edit" data-appointment-id="${escapeHTML(appointment.id)}">${icon('edit')}Editar</button>${appointment.status === STATUS.SCHEDULED ? `<button class="small-action small-action--complete" type="button" data-action="complete" data-appointment-id="${escapeHTML(appointment.id)}">${icon('check')}Concluir</button>` : appointment.status === STATUS.COMPLETED ? '<span class="earning-meta">Incluído nos ganhos</span>' : ''}</div>`;
      }
      return `
        <li class="schedule-appointment${isCancelled ? ' is-cancelled' : ''}">
          <time class="schedule-time" datetime="${escapeHTML(appointment.time)}">${escapeHTML(appointment.time)}</time>
          <div class="schedule-appointment-main">
            <div class="schedule-appointment-top">
              <div><h3 class="schedule-appointment-title">${escapeHTML(appointment.source === 'public' ? 'Período indisponível' : appointment.client || 'Cliente')}</h3><span class="schedule-appointment-service">${escapeHTML(serviceName)}</span></div>
              <strong class="schedule-appointment-price">${appointment.source === 'public' ? '—' : escapeHTML(formatCurrency(amount))}</strong>
            </div>
            <div class="schedule-appointment-bottom">${appointment.source === 'public' ? `<span class="status-badge status-scheduled">${icon('clock')}Indisponível</span>` : statusMarkup(appointment.status)}${actions}</div>
          </div>
        </li>`;
    }).join('')}</ul></div>`;
  }

  function renderSchedule() {
    renderUpcomingDays();
    renderScheduleDetail();
  }

  function renderAll() {
    renderEarnings();
    renderSchedule();
    refreshServiceSelect();
  }

  function syncResponsiveViews() {
    const desktopSplit = window.matchMedia('(min-width: 1200px)').matches;
    const earningsView = $('#earnings-view');
    const scheduleView = $('#schedule-view');

    // Em telas largas, as duas áreas ficam abertas lado a lado. Em mobile,
    // preservamos o comportamento de uma única aba por vez.
    earningsView.hidden = !desktopSplit && state.activeView !== 'earnings';
    scheduleView.hidden = !desktopSplit && state.activeView !== 'schedule';
    earningsView.classList.toggle('active', desktopSplit || state.activeView === 'earnings');
    scheduleView.classList.toggle('active', desktopSplit || state.activeView === 'schedule');
  }

  function switchView(viewName) {
    if (!['earnings', 'schedule'].includes(viewName)) return;
    state.activeView = viewName;
    const earningsTab = $('#tab-earnings');
    const scheduleTab = $('#tab-schedule');
    const showingEarnings = viewName === 'earnings';

    syncResponsiveViews();
    earningsTab.classList.toggle('active', showingEarnings);
    earningsTab.setAttribute('aria-selected', String(showingEarnings));
    scheduleTab.classList.toggle('active', !showingEarnings);
    scheduleTab.setAttribute('aria-selected', String(!showingEarnings));
  }

  function moveEarningsMonth(amount) {
    const currentDay = dateFromKey(state.earningsDate).getDate();
    const targetMonth = new Date(state.earningsMonth.getFullYear(), state.earningsMonth.getMonth() + amount, 1, 12, 0, 0, 0);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
    state.earningsMonth = targetMonth;
    state.earningsDate = localDateKey(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(currentDay, lastDay), 12, 0, 0, 0));
    renderEarnings();
  }

  function setEarningsDate(dateKey) {
    const normalized = asDateKey(dateKey);
    if (!normalized) return;
    state.earningsDate = normalized;
    state.earningsMonth = startOfMonth(dateFromKey(normalized));
    renderEarnings();
  }

  function setAgendaDate(dateKey) {
    const normalized = asDateKey(dateKey);
    if (!normalized) return;
    state.agendaDate = normalized;
    renderSchedule();
  }

  function refreshServiceSelect() {
    const select = $('#appointment-service');
    const hint = $('#appointment-service-hint');
    if (!select) return;
    const previousValue = select.value;
    const services = store.getServices();
    if (!services.length) {
      select.innerHTML = '<option value="">Nenhum serviço cadastrado</option>';
      select.disabled = true;
      if (hint) hint.innerHTML = 'Antes de agendar, <button class="inline-text-button" type="button" data-open-service-dialog>cadastre um serviço</button>.';
      return;
    }
    select.disabled = false;
    select.innerHTML = `<option value="">Selecione um serviço</option>${services.map((service) => `<option value="${escapeHTML(service.id)}">${escapeHTML(service.name)} — ${escapeHTML(formatCurrency(service.price))}</option>`).join('')}`;
    if (services.some((service) => service.id === previousValue)) select.value = previousValue;
    if (hint) hint.textContent = 'O preço é preenchido com o valor do serviço e pode ser ajustado para este atendimento.';
    updateAppointmentPriceFromService();
  }

  function updateAppointmentPriceFromService() {
    const select = $('#appointment-service');
    const priceInput = $('#appointment-price');
    if (!select || !priceInput) return;
    const service = store.getService(select.value);
    if (service) priceInput.value = Number(service.price).toFixed(2);
  }

  function getRoundedDefaultTime() {
    const now = new Date();
    now.setSeconds(0, 0);
    const nextQuarter = Math.ceil(now.getMinutes() / 15) * 15;
    if (nextQuarter >= 60) now.setHours(now.getHours() + 1, 0, 0, 0);
    else now.setMinutes(nextQuarter, 0, 0);
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }

  function openServiceDialog() {
    const dialog = $('#service-dialog');
    const form = $('#service-form');
    form.reset();
    $('#service-duration').value = '30';
    setFeedback('#service-form-feedback', '');
    if (!dialog.open) dialog.showModal();
    $('#service-name').focus();
  }

  function openAppointmentDialog() {
    editingAppointmentId = null;
    editingAppointmentSource = 'admin';
    const dialog = $('#appointment-dialog');
    const form = $('#appointment-form');
    form.reset();
    $('#appointment-date').value = state.agendaDate;
    $('#appointment-time').value = getRoundedDefaultTime();
    setFeedback('#appointment-form-feedback', '');
    refreshServiceSelect();
    configureAppointmentDialog(false);
    if (!dialog.open) dialog.showModal();
    $('#appointment-client').focus();
  }

  function openBlockPeriodDialog() {
    const form = $('#block-period-form');
    form.reset();
    $('#block-period-date').value = state.agendaDate;
    $('#block-period-start').value = '10:00';
    $('#block-period-end').value = '10:30';
    setFeedback('#block-period-form-feedback', '');
    const dialog = $('#block-period-dialog');
    if (!dialog.open) dialog.showModal();
    $('#block-period-date').focus();
  }

  let editingAppointmentId = null;
  let editingAppointmentSource = 'admin';

  function configureAppointmentDialog(editing, isPublic = false) {
    const appointment = editing ? store.getAppointment(editingAppointmentId) : null;
    $('#appointment-dialog-title').textContent = editing ? (isPublic ? 'Editar período indisponível' : 'Editar agendamento') : 'Novo agendamento';
    $('#appointment-dialog-description').textContent = isPublic
      ? 'Reservas públicas e bloqueios manuais compartilham este calendário; você pode alterar somente a data e o horário.'
      : editing ? 'Altere os dados deste atendimento.' : 'Cadastre os dados do atendimento.';
    $('#appointment-client-fields').hidden = isPublic;
    $('#appointment-service-fields').hidden = isPublic;
    $('#appointment-price-fields').hidden = isPublic;
    $('#appointment-status-field').hidden = !editing || isPublic;
    $('#appointment-submit').textContent = editing ? 'Salvar alterações' : 'Salvar agendamento';
    $('#appointment-cancel').hidden = !editing || appointment?.status !== STATUS.SCHEDULED;
    $('#appointment-cancel').textContent = isPublic ? 'Liberar período' : 'Cancelar agendamento';
  }

  function openEditAppointmentDialog(id) {
    const appointment = store.getAppointment(id);
    if (!appointment) return;
    editingAppointmentId = appointment.id;
    editingAppointmentSource = appointment.source;
    const form = $('#appointment-form');
    form.reset();
    setFeedback('#appointment-form-feedback', '');
    refreshServiceSelect();
    if (appointment.source === 'public') {
      $('#appointment-date').value = appointment.date;
      $('#appointment-time').value = appointment.time;
      configureAppointmentDialog(true, true);
    } else {
      const service = store.getService(appointment.serviceId);
      if (service && !Array.from($('#appointment-service').options).some((option) => option.value === service.id)) {
        $('#appointment-service').add(new Option(`${service.name} (inativo)`, service.id));
      }
      $('#appointment-client').value = appointment.client;
      $('#appointment-service').value = appointment.serviceId;
      $('#appointment-date').value = appointment.date;
      $('#appointment-time').value = appointment.time;
      $('#appointment-price').value = appointment.price == null ? '' : Number(appointment.price).toFixed(2);
      $('#appointment-status').value = appointment.status;
      configureAppointmentDialog(true);
    }
    const dialog = $('#appointment-dialog');
    if (!dialog.open) dialog.showModal();
    (appointment.source === 'public' ? $('#appointment-date') : $('#appointment-client')).focus();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  async function submitService(event) {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    setFeedback('#service-form-feedback', '');
    const name = $('#service-name').value.trim();
    const price = Number($('#service-price').value);
    const durationMinutes = Number($('#service-duration').value);
    if (!name || $('#service-price').value === '' || !Number.isFinite(price) || price < 0
      || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
      setFeedback('#service-form-feedback', 'Preencha o nome, um preço válido e a duração do serviço.');
      submitButton.disabled = false;
      return;
    }
    try {
      const service = await adminData.createService({ name, price, durationMinutes });
      store.addService(service);
      closeDialog('service-dialog');
      renderAll();
      refreshServiceSelect();
      if ($('#appointment-dialog').open) {
        $('#appointment-service').value = service.id;
        updateAppointmentPriceFromService();
      }
      announce(`Serviço ${service.name} cadastrado.`);
    } catch (error) {
      setFeedback('#service-form-feedback', error.message || 'Não foi possível cadastrar o serviço.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function submitAppointment(event) {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    setFeedback('#appointment-form-feedback', '');
    const payload = {
      client: $('#appointment-client').value.trim(),
      serviceId: $('#appointment-service').value,
      date: $('#appointment-date').value,
      time: $('#appointment-time').value,
      price: $('#appointment-price').value === '' ? null : Number($('#appointment-price').value),
      durationMinutes: Number(store.getService($('#appointment-service').value)?.durationMinutes),
      status: editingAppointmentId ? $('#appointment-status').value : STATUS.SCHEDULED,
    };
    const currentAppointment = editingAppointmentId ? store.getAppointment(editingAppointmentId) : null;
    const cancelling = currentAppointment
      && currentAppointment.status !== STATUS.CANCELLED
      && payload.status === STATUS.CANCELLED;
    if (editingAppointmentId && editingAppointmentSource === 'public') {
      const appointment = store.getAppointment(editingAppointmentId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time)) {
        setFeedback('#appointment-form-feedback', 'Preencha uma data e um horário válidos.');
        submitButton.disabled = false;
        return;
      }
      try {
        const updated = await adminData.updatePublicReservation(appointment, payload);
        store.updatePublicReservation(editingAppointmentId, updated);
        state.agendaDate = updated.date;
        closeDialog('appointment-dialog');
        renderAll();
        announce(`Período indisponível movido para ${updated.date}, às ${updated.time}.`);
      } catch (error) {
        setFeedback('#appointment-form-feedback', error.message || 'Não foi possível editar o período.');
      } finally {
        submitButton.disabled = false;
      }
      return;
    }
    if (!payload.client || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time) || !payload.serviceId
      || payload.price == null || !Number.isFinite(payload.price) || payload.price < 0) {
      setFeedback('#appointment-form-feedback', 'Preencha cliente, serviço, data, horário e preço.');
      submitButton.disabled = false;
      return;
    }
    if (cancelling && !window.confirm(`Cancelar o atendimento de ${currentAppointment.client} às ${currentAppointment.time}?`)) {
      submitButton.disabled = false;
      return;
    }
    try {
      let appointment;
      if (editingAppointmentId) {
        appointment = await adminData.updateAppointment(editingAppointmentId, payload);
        store.updateAppointment(editingAppointmentId, appointment);
      } else {
        appointment = await adminData.createAppointment(payload);
        store.addAppointment(appointment);
      }
      state.agendaDate = appointment.date;
      closeDialog('appointment-dialog');
      renderAll();
      switchView('schedule');
      announce(cancelling
        ? `Atendimento de ${appointment.client} cancelado.`
        : `${editingAppointmentId ? 'Agendamento atualizado' : 'Agendamento salvo'} para ${appointment.client}, ${appointment.date} às ${appointment.time}.`);
    } catch (error) {
      setFeedback('#appointment-form-feedback', error.message || 'Não foi possível salvar o agendamento.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function submitBlockedPeriod(event) {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    setFeedback('#block-period-form-feedback', '');
    const period = {
      date: $('#block-period-date').value,
      start: $('#block-period-start').value,
      end: $('#block-period-end').value,
    };

    try {
      const blockedPeriod = await adminData.createBlockedPeriod(period);
      store.setAppointments([...store.getAppointments(), blockedPeriod]);
      state.agendaDate = blockedPeriod.date;
      closeDialog('block-period-dialog');
      renderAll();
      switchView('schedule');
      announce(`Período de ${blockedPeriod.date}, das ${blockedPeriod.time} às ${blockedPeriod.endTime}, bloqueado.`);
    } catch (error) {
      setFeedback('#block-period-form-feedback', error.message || 'Não foi possível bloquear o período.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function cancelEditingAppointment(button) {
    const appointment = store.getAppointment(editingAppointmentId);
    if (!appointment || appointment.status !== STATUS.SCHEDULED) return;
    const confirmation = appointment.source === 'public'
      ? `Liberar o período das ${appointment.time} às ${appointment.endTime}? Ele ficará disponível para novas reservas.`
      : `Cancelar o atendimento de ${appointment.client} às ${appointment.time}?`;
    if (!window.confirm(confirmation)) return;

    button.disabled = true;
    setFeedback('#appointment-form-feedback', '');
    try {
      if (appointment.source === 'public') {
        await adminData.cancelPublicReservation(appointment);
        store.removeAppointment(appointment.id);
      } else {
        await adminData.updateAppointment(appointment.id, { status: STATUS.CANCELLED });
        store.updateAppointment(appointment.id, { status: STATUS.CANCELLED });
      }
      closeDialog('appointment-dialog');
      renderAll();
      announce(appointment.source === 'public'
        ? `Período de ${appointment.date}, das ${appointment.time} às ${appointment.endTime}, liberado.`
        : `Atendimento de ${appointment.client} cancelado.`);
    } catch (error) {
      setFeedback('#appointment-form-feedback', error.message || 'Não foi possível liberar o período.');
    } finally {
      button.disabled = false;
    }
  }

  async function handleAppointmentAction(button) {
    const id = button.dataset.appointmentId;
    const action = button.dataset.action;
    try {
      if (action === 'edit') {
        openEditAppointmentDialog(id);
      } else if (action === 'complete') {
        const appointment = store.getAppointment(id);
        if (!appointment || appointment.source === 'public') return;
        button.disabled = true;
        await adminData.updateAppointment(id, { status: STATUS.COMPLETED });
        store.updateAppointment(id, { status: STATUS.COMPLETED });
        announce(`Atendimento de ${appointment.client} concluído. O faturamento foi atualizado.`);
      }
    } catch (error) {
      announce(error.message || 'Não foi possível atualizar o atendimento.');
      $('#admin-status').dataset.state = 'error';
      setText('#admin-status', error.message || 'Não foi possível atualizar o atendimento.');
      $('#admin-status').hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    $('#tab-earnings').addEventListener('click', () => switchView('earnings'));
    $('#tab-schedule').addEventListener('click', () => switchView('schedule'));
    window.addEventListener('resize', syncResponsiveViews, { passive: true });

    $('#earnings-prev-month').addEventListener('click', () => moveEarningsMonth(-1));
    $('#earnings-next-month').addEventListener('click', () => moveEarningsMonth(1));
    $('#earnings-prev-day').addEventListener('click', () => setEarningsDate(addDays(state.earningsDate, -1)));
    $('#earnings-next-day').addEventListener('click', () => setEarningsDate(addDays(state.earningsDate, 1)));
    $('#earnings-today').addEventListener('click', () => {
      state.earningsMonth = startOfMonth(dateFromKey(today));
      setEarningsDate(today);
    });
    $('#earnings-date').addEventListener('change', (event) => setEarningsDate(event.target.value));

    $('#agenda-prev-day').addEventListener('click', () => setAgendaDate(addDays(state.agendaDate, -1)));
    $('#agenda-next-day').addEventListener('click', () => setAgendaDate(addDays(state.agendaDate, 1)));
    $('#agenda-date').addEventListener('change', (event) => setAgendaDate(event.target.value));
    $('#agenda-today').addEventListener('click', () => setAgendaDate(today));

    $('#open-service-dialog').addEventListener('click', openServiceDialog);
    $('#open-appointment-dialog').addEventListener('click', openAppointmentDialog);
    $('#open-block-period-dialog').addEventListener('click', openBlockPeriodDialog);
    $('#service-form').addEventListener('submit', submitService);
    $('#appointment-form').addEventListener('submit', submitAppointment);
    $('#block-period-form').addEventListener('submit', submitBlockedPeriod);
    $('#appointment-service').addEventListener('change', updateAppointmentPriceFromService);
    $('#appointment-cancel').addEventListener('click', (event) => cancelEditingAppointment(event.currentTarget));

    $$('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => closeDialog(button.dataset.closeDialog));
    });

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const openService = target.closest('[data-open-service-dialog]');
      if (openService) {
        openServiceDialog();
        return;
      }
      const openAppointment = target.closest('[data-open-appointment]');
      if (openAppointment) {
        switchView('schedule');
        openAppointmentDialog();
        return;
      }
      const dayButton = target.closest('[data-select-agenda-date]');
      if (dayButton) {
        setAgendaDate(dayButton.dataset.selectAgendaDate);
        return;
      }
      const actionButton = target.closest('[data-action][data-appointment-id]');
      if (actionButton) handleAppointmentAction(actionButton);
    });

    $('#logout-button').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        window.location.replace('index.html');
      } catch (error) {
        $('#admin-status').dataset.state = 'error';
        setText('#admin-status', error.message || 'Não foi possível encerrar a sessão.');
        $('#admin-status').hidden = false;
        button.disabled = false;
      }
    });

    window.addEventListener('donmatheus:data-change', () => {
      renderAll();
    });
  }

  // O estado de apresentação é separado das operações Supabase de adminData.
  window.DonMatheusAdmin = Object.freeze({
    STATUS,
    getServices: store.getServices,
    getAllServices: store.getAllServices,
    getService: store.getService,
    getAppointments: store.getAppointments,
    getAppointment: store.getAppointment,
    getAppointmentsForDate: store.getAppointmentsForDate,
    getAppointmentsBetween: store.getAppointmentsBetween,
    getDailySummary: store.getDailySummary,
    getMonthlyEarnings: store.getMonthlyEarnings,
    getRevenueForAppointment: store.getRevenueForAppointment,
    setServices: store.setServices,
    setAppointments: store.setAppointments,
    addService: store.addService,
    updateService: store.updateService,
    removeService: store.removeService,
    addAppointment: store.addAppointment,
    updateAppointment: store.updateAppointment,
    removeAppointment: store.removeAppointment,
    refresh: renderAll,
    showView: switchView,
  });

  async function initialize() {
    $('#earnings-date').value = today;
    $('#agenda-date').value = today;
    $('#admin-status').dataset.state = 'loading';
    setText('#admin-status', 'Verificando acesso e carregando os dados...');
    $('#admin-status').hidden = false;
    try {
      const session = await obterSessaoAutorizada();
      if (!session) {
        window.location.replace('index.html?redirect=admin');
        return;
      }
      bindEvents();
      const loaded = await adminData.loadDashboardData(window.DonMatheusAdmin);
      if (!loaded) {
        window.location.replace('index.html?redirect=admin');
        return;
      }
      $('#admin-main').hidden = false;
      $('#admin-nav').hidden = false;
      $('#admin-status').hidden = true;
      supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') window.location.replace('index.html');
      });
      renderAll();
      syncResponsiveViews();
      switchView('earnings');
    } catch (error) {
      $('#admin-status').dataset.state = 'error';
      setText('#admin-status', `Não foi possível carregar o painel: ${error.message}`);
      $('#admin-status').hidden = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
