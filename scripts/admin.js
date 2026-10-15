import { obterSessaoAutorizada } from './auth.js';
import { supabase } from './supabaseClient.js';
import { adminData } from './adminData.js';

(() => {
  'use strict';

  const DATE_LOCALE = 'pt-BR';
  const STATUS = Object.freeze({
    SCHEDULED: 'scheduled',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  });

  const iconPaths = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12.3 12.3M14.5 9.5 20.5 3.5M8.2 15.8l3.4-3.4"/>',
    money: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m18 6-12 12M6 6l12 12"/>',
    calendarCheck: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m4 5 2 2 4-4"/>',
    chart: '<path d="M3 3v18h18M7 14l4-4 3 3 6-7"/>',
    empty: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h4M8 17h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };

  function icon(name, className = '') {
    const path = iconPaths[name] || iconPaths.empty;
    return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function asDateKey(value) {
    if (value instanceof Date) return localDateKey(value);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function addDays(dateKey, amount) {
    const date = dateFromKey(dateKey);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  }

  function startOfMonth(dateLike) {
    const date = dateLike instanceof Date ? new Date(dateLike) : dateFromKey(asDateKey(dateLike));
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  }

  function endOfMonth(dateLike) {
    const month = startOfMonth(dateLike);
    return new Date(month.getFullYear(), month.getMonth() + 1, 0, 12, 0, 0, 0);
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
    if (amount >= 10_000) return `R$ ${(amount / 1000).toLocaleString(DATE_LOCALE, { maximumFractionDigits: 1 })} mil`;
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

  function formatShortDate(dateKey) {
    return new Intl.DateTimeFormat(DATE_LOCALE, { day: '2-digit', month: '2-digit' }).format(dateFromKey(dateKey));
  }

  function formatWeekday(dateKey) {
    return new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'short' }).format(dateFromKey(dateKey)).replace('.', '');
  }

  function normalizeStatus(status) {
    return Object.values(STATUS).includes(status) ? status : STATUS.SCHEDULED;
  }

  // Store centralizado: substituível por chamadas ao Supabase sem acoplar o layout.
  const store = (() => {
    let services = [];
    let appointments = [];

    function publish() {
      window.dispatchEvent(new CustomEvent('donmatheus:data-change'));
    }

    function normalizeService(input = {}) {
      const price = Number(input.price);
      const duration = Number(input.durationMinutes ?? input.duration_minutes ?? 30);
      return {
        id: String(input.id || createId()),
        name: String(input.name || '').trim(),
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
        active: input.active !== false,
      };
    }

    function normalizeAppointment(input = {}) {
      const numericPrice = input.price == null || input.price === '' ? null : Number(input.price);
      const date = asDateKey(input.date || input.appointment_date || input.starts_at || '');
      return {
        id: String(input.id || createId()),
        date,
        time: String(input.time || input.appointment_time || '').slice(0, 5),
        client: String(input.client || '').trim(),
        serviceId: String(input.serviceId || input.service_id || ''),
        status: normalizeStatus(input.status),
        price: numericPrice != null && Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null,
        notes: String(input.notes || '').trim(),
        source: input.source === 'public' ? 'public' : 'admin',
      };
    }

    function getService(id) {
      return services.find((service) => service.id === String(id)) || null;
    }

    function getRevenueForAppointment(appointment) {
      if (!appointment || appointment.status !== STATUS.COMPLETED) return 0;
      if (appointment.price != null && Number.isFinite(Number(appointment.price))) return Math.max(0, Number(appointment.price));
      return Math.max(0, Number(getService(appointment.serviceId)?.price) || 0);
    }

    function getAppointmentsForDate(dateKey) {
      return appointments
        .filter((appointment) => appointment.date === asDateKey(dateKey))
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time) || a.client.localeCompare(b.client, DATE_LOCALE));
    }

    function getAppointmentsBetween(startDate, endDate) {
      const start = asDateKey(startDate);
      const end = asDateKey(endDate);
      return appointments
        .filter((appointment) => appointment.date >= start && appointment.date <= end)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    }

    function getDailySummary(dateKey) {
      const dayAppointments = getAppointmentsForDate(dateKey);
      const completed = dayAppointments.filter((appointment) => appointment.status === STATUS.COMPLETED);
      const scheduled = dayAppointments.filter((appointment) => appointment.status === STATUS.SCHEDULED);
      const cancelled = dayAppointments.filter((appointment) => appointment.status === STATUS.CANCELLED);
      return {
        date: asDateKey(dateKey),
        appointments: dayAppointments,
        completedAppointments: completed,
        scheduledAppointments: scheduled,
        cancelledAppointments: cancelled,
        completedCount: completed.length,
        scheduledCount: scheduled.length,
        cancelledCount: cancelled.length,
        totalCount: dayAppointments.length,
        revenue: completed.reduce((sum, appointment) => sum + getRevenueForAppointment(appointment), 0),
      };
    }

    function getMonthlyEarnings(monthDate) {
      const month = startOfMonth(monthDate);
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
      const days = Array.from({ length: daysInMonth }, (_, index) => {
        const date = `${monthKey}-${String(index + 1).padStart(2, '0')}`;
        const completed = appointments.filter((appointment) => appointment.date === date && appointment.status === STATUS.COMPLETED);
        return {
          date,
          day: index + 1,
          count: completed.length,
          revenue: completed.reduce((sum, appointment) => sum + getRevenueForAppointment(appointment), 0),
          appointments: completed,
        };
      });
      const completedAppointments = days.flatMap((day) => day.appointments);
      return {
        month: localDateKey(month).slice(0, 7),
        days,
        totalRevenue: days.reduce((sum, day) => sum + day.revenue, 0),
        serviceCount: completedAppointments.length,
        averageTicket: completedAppointments.length
          ? days.reduce((sum, day) => sum + day.revenue, 0) / completedAppointments.length
          : 0,
        completedAppointments,
      };
    }

    return {
      getServices: () => services.filter((service) => service.active).slice().sort((a, b) => a.name.localeCompare(b.name, DATE_LOCALE)),
      getAllServices: () => services.slice(),
      getService,
      getAppointments: () => appointments.slice().sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
      getAppointment: (id) => appointments.find((appointment) => appointment.id === String(id)) || null,
      getAppointmentsForDate,
      getAppointmentsBetween,
      getDailySummary,
      getMonthlyEarnings,
      getRevenueForAppointment,
      setServices(items = []) {
        services = items.map(normalizeService).filter((service) => service.name);
        publish();
        return services.slice();
      },
      setAppointments(items = []) {
        appointments = items.map(normalizeAppointment).filter((appointment) => appointment.date && appointment.time);
        publish();
        return appointments.slice();
      },
      addService(input = {}) {
        const service = normalizeService(input);
        if (!service.name) throw new Error('Informe o nome do serviço.');
        if (!Number.isFinite(Number(input.price)) || Number(input.price) < 0) throw new Error('Informe um preço válido para o serviço.');
        if (services.some((item) => item.name.toLocaleLowerCase(DATE_LOCALE) === service.name.toLocaleLowerCase(DATE_LOCALE))) {
          throw new Error('Já existe um serviço com esse nome.');
        }
        services = [...services, service];
        publish();
        return service;
      },
      updateService(id, updates = {}) {
        const index = services.findIndex((service) => service.id === String(id));
        if (index < 0) throw new Error('Serviço não encontrado.');
        const changed = normalizeService({ ...services[index], ...updates, id: services[index].id });
        if (!changed.name) throw new Error('O nome do serviço não pode ficar vazio.');
        services = services.map((service, serviceIndex) => serviceIndex === index ? changed : service);
        publish();
        return changed;
      },
      removeService(id) {
        const linked = appointments.some((appointment) => appointment.serviceId === String(id));
        if (linked) throw new Error('Este serviço já está ligado a atendimentos. Desative-o no Supabase em vez de removê-lo.');
        services = services.filter((service) => service.id !== String(id));
        publish();
      },
      addAppointment(input = {}) {
        const appointment = normalizeAppointment(input);
        const service = getService(appointment.serviceId);
        if (!appointment.client) throw new Error('Informe o nome do cliente.');
        if (!appointment.date) throw new Error('Escolha uma data válida.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)) throw new Error('Escolha um horário válido.');
        if (!service) throw new Error('Cadastre ou selecione um serviço antes de agendar.');
        if (appointments.some((item) => item.date === appointment.date && item.time === appointment.time && item.status !== STATUS.CANCELLED)) {
          throw new Error('Já existe um atendimento neste horário. Escolha outro horário.');
        }
        // O valor é salvo como preço combinado do atendimento. Isso evita que
        // alterar a tabela de preços mude o histórico de receita já concluída.
        if (appointment.price == null) appointment.price = service.price;
        appointments = [...appointments, appointment];
        publish();
        return appointment;
      },
      updateAppointment(id, updates = {}) {
        const existing = appointments.find((appointment) => appointment.id === String(id));
        if (!existing) throw new Error('Agendamento não encontrado.');
        const changed = normalizeAppointment({ ...existing, ...updates, id: existing.id });
        if (!changed.client || !changed.date || !changed.time) throw new Error('Cliente, data e horário são obrigatórios.');
        if (!getService(changed.serviceId)) throw new Error('Serviço não encontrado.');
        if (changed.status === STATUS.SCHEDULED && appointments.some((item) => item.id !== changed.id && item.date === changed.date && item.time === changed.time && item.status === STATUS.SCHEDULED)) {
          throw new Error('Já existe um atendimento neste horário.');
        }
        appointments = appointments.map((appointment) => appointment.id === changed.id ? changed : appointment);
        publish();
        return changed;
      },
      removeAppointment(id) {
        appointments = appointments.filter((appointment) => appointment.id !== String(id));
        publish();
      },
    };
  })();

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
    setText('#chart-period-label', formatMonth(state.earningsMonth));
    setText('#month-revenue', formatCurrency(monthly.totalRevenue));
    setText('#month-revenue-caption', `${monthly.serviceCount} ${monthly.serviceCount === 1 ? 'serviço concluído' : 'serviços concluídos'} no mês`);
    setText('#month-service-count', String(monthly.serviceCount));
    setText('#month-service-caption', `${monthly.days.length} dias no período`);
    setText('#month-average', formatCurrency(monthly.averageTicket));
    setText('#daily-earnings-date-label', formatLongDate(state.earningsDate));
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
          ? 'Horário reservado online'
          : store.getService(appointment.serviceId)?.name || 'Atendimento';
        const clientName = appointment.source === 'public' ? 'Reserva pública' : appointment.client || serviceName;
        return `<td><button type="button" class="upcoming-slot-booked" data-select-agenda-date="${escapeHTML(dateKey)}" title="${escapeHTML(`${clientName} · ${serviceName}`)}"><strong>${escapeHTML(clientName)}</strong><span>${escapeHTML(serviceName)}</span></button></td>`;
      }).join('');
      return `<tr><th scope="row" class="upcoming-time">${escapeHTML(time)}</th>${cells}</tr>`;
    }).join('');

    if (!timeSlots.length) {
      container.innerHTML = `<div class="upcoming-empty">${icon('calendar')}<span>Nenhum agendamento nos próximos 7 dias.</span></div>`;
    } else {
      container.innerHTML = `<div class="upcoming-table-wrap"><table class="upcoming-table"><thead><tr><th class="upcoming-time-heading">Hora</th>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    setText('#upcoming-total', `${totalUpcoming} ${totalUpcoming === 1 ? 'agendamento' : 'agendamentos'}`);
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
    setText('#agenda-day-caption', formatLongDate(state.agendaDate));
    setText('#agenda-day-total', `${visibleCount} ${visibleCount === 1 ? 'atendimento' : 'atendimentos'}`);
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
        ? 'Horário reservado online'
        : service?.name || 'Serviço não cadastrado';
      const amount = appointment.price != null ? Number(appointment.price) : Number(service?.price) || 0;
      const isCancelled = appointment.status === STATUS.CANCELLED;
      let actions = '';
      if (appointment.source === 'public') {
        actions = '<span class="earning-meta">Reserva pública · sem dados pessoais</span>';
      } else if (appointment.status === STATUS.SCHEDULED) {
        actions = `<div class="schedule-actions"><button class="small-action small-action--complete" type="button" data-action="complete" data-appointment-id="${escapeHTML(appointment.id)}">${icon('check')}Concluir</button><button class="small-action small-action--cancel" type="button" data-action="cancel" data-appointment-id="${escapeHTML(appointment.id)}">${icon('close')}Cancelar</button></div>`;
      } else if (appointment.status === STATUS.COMPLETED) {
        actions = '<span class="earning-meta">Incluído nos ganhos</span>';
      }
      return `
        <li class="schedule-appointment${isCancelled ? ' is-cancelled' : ''}">
          <time class="schedule-time" datetime="${escapeHTML(appointment.time)}">${escapeHTML(appointment.time)}</time>
          <div class="schedule-appointment-main">
            <div class="schedule-appointment-top">
              <div><h3 class="schedule-appointment-title">${escapeHTML(appointment.source === 'public' ? 'Reserva pública' : appointment.client || 'Cliente')}</h3><span class="schedule-appointment-service">${escapeHTML(serviceName)}</span></div>
              <strong class="schedule-appointment-price">${appointment.source === 'public' ? '—' : escapeHTML(formatCurrency(amount))}</strong>
            </div>
            <div class="schedule-appointment-bottom">${statusMarkup(appointment.status)}${actions}</div>
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
    const dialog = $('#appointment-dialog');
    const form = $('#appointment-form');
    form.reset();
    $('#appointment-date').value = state.agendaDate;
    $('#appointment-time').value = getRoundedDefaultTime();
    setFeedback('#appointment-form-feedback', '');
    refreshServiceSelect();
    if (!dialog.open) dialog.showModal();
    $('#appointment-client').focus();
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
      status: STATUS.SCHEDULED,
    };
    if (!payload.client || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time) || !payload.serviceId
      || payload.price == null || !Number.isFinite(payload.price) || payload.price < 0) {
      setFeedback('#appointment-form-feedback', 'Preencha cliente, serviço, data, horário e preço.');
      submitButton.disabled = false;
      return;
    }
    try {
      const appointment = await adminData.createAppointment(payload);
      store.addAppointment(appointment);
      state.agendaDate = appointment.date;
      closeDialog('appointment-dialog');
      renderAll();
      switchView('schedule');
      announce(`Agendamento de ${appointment.client} salvo para ${appointment.date} às ${appointment.time}.`);
    } catch (error) {
      setFeedback('#appointment-form-feedback', error.message || 'Não foi possível salvar o agendamento.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function handleAppointmentAction(button) {
    const id = button.dataset.appointmentId;
    const action = button.dataset.action;
    try {
      if (action === 'complete') {
        const appointment = store.getAppointment(id);
        if (!appointment || appointment.source === 'public') return;
        button.disabled = true;
        await adminData.updateAppointment(id, { status: STATUS.COMPLETED });
        store.updateAppointment(id, { status: STATUS.COMPLETED });
        announce(`Atendimento de ${appointment.client} concluído. O faturamento foi atualizado.`);
      } else if (action === 'cancel') {
        const appointment = store.getAppointment(id);
        if (!appointment || appointment.source === 'public') return;
        const confirmed = window.confirm(`Cancelar o atendimento de ${appointment.client} às ${appointment.time}?`);
        if (!confirmed) return;
        button.disabled = true;
        await adminData.updateAppointment(id, { status: STATUS.CANCELLED });
        store.updateAppointment(id, { status: STATUS.CANCELLED });
        announce(`Atendimento de ${appointment.client} cancelado.`);
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
    $('#service-form').addEventListener('submit', submitService);
    $('#appointment-form').addEventListener('submit', submitAppointment);
    $('#appointment-service').addEventListener('change', updateAppointmentPriceFromService);

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
