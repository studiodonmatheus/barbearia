export const DATE_LOCALE = 'pt-BR'

export const STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
})

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function asDateKey(value) {
  if (value instanceof Date) return localDateKey(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed)
}

export function dateFromKey(key) {
  const [year, month, day] = String(key).split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function addDays(dateKey, amount) {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + amount)
  return localDateKey(date)
}

export function startOfMonth(dateLike) {
  const date = dateLike instanceof Date ? new Date(dateLike) : dateFromKey(asDateKey(dateLike))
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0)
}

function normalizeStatus(status) {
  return Object.values(STATUS).includes(status) ? status : STATUS.SCHEDULED
}

export function createAdminStore() {
  let services = []
  let appointments = []

  function publish() {
    window.dispatchEvent(new CustomEvent('donmatheus:data-change'))
  }

  function normalizeService(input = {}) {
    const price = Number(input.price)
    const duration = Number(input.durationMinutes ?? input.duration_minutes ?? 30)
    return {
      id: String(input.id || createId()),
      name: String(input.name || '').trim(),
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 30,
      active: input.active !== false,
    }
  }

  function normalizeAppointment(input = {}) {
    const numericPrice = input.price == null || input.price === '' ? null : Number(input.price)
    const date = asDateKey(input.date || input.appointment_date || input.starts_at || '')
    return {
      id: String(input.id || createId()),
      date,
      time: String(input.time || input.appointment_time || '').slice(0, 5),
      client: String(input.client || '').trim(),
      serviceId: String(input.serviceId || input.service_id || ''),
      status: normalizeStatus(input.status),
      price: numericPrice != null && Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null,
      notes: String(input.notes || '').trim(),
      endTime: String(input.endTime || '').slice(0, 5),
      source: input.source === 'public' ? 'public' : 'admin',
    }
  }

  function getService(id) {
    return services.find((service) => service.id === String(id)) || null
  }

  function getRevenueForAppointment(appointment) {
    if (!appointment || appointment.status !== STATUS.COMPLETED) return 0
    if (appointment.price != null && Number.isFinite(Number(appointment.price))) return Math.max(0, Number(appointment.price))
    return Math.max(0, Number(getService(appointment.serviceId)?.price) || 0)
  }

  function getAppointmentsForDate(dateKey) {
    return appointments
      .filter((appointment) => appointment.date === asDateKey(dateKey))
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time) || a.client.localeCompare(b.client, DATE_LOCALE))
  }

  function getAppointmentsBetween(startDate, endDate) {
    const start = asDateKey(startDate)
    const end = asDateKey(endDate)
    return appointments
      .filter((appointment) => appointment.date >= start && appointment.date <= end)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  }

  function getDailySummary(dateKey) {
    const dayAppointments = getAppointmentsForDate(dateKey)
    const completed = dayAppointments.filter((appointment) => appointment.status === STATUS.COMPLETED)
    const scheduled = dayAppointments.filter((appointment) => appointment.status === STATUS.SCHEDULED)
    const cancelled = dayAppointments.filter((appointment) => appointment.status === STATUS.CANCELLED)
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
    }
  }

  function getMonthlyEarnings(monthDate) {
    const month = startOfMonth(monthDate)
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    const monthEnd = `${monthKey}-${String(daysInMonth).padStart(2, '0')}`
    const completedByDate = new Map()

    for (const appointment of appointments) {
      if (appointment.status !== STATUS.COMPLETED
        || appointment.date < `${monthKey}-01`
        || appointment.date > monthEnd) continue

      const dailyAppointments = completedByDate.get(appointment.date) || []
      dailyAppointments.push(appointment)
      completedByDate.set(appointment.date, dailyAppointments)
    }

    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${monthKey}-${String(index + 1).padStart(2, '0')}`
      const completed = completedByDate.get(date) || []
      return {
        date,
        day: index + 1,
        count: completed.length,
        revenue: completed.reduce((sum, appointment) => sum + getRevenueForAppointment(appointment), 0),
        appointments: completed,
      }
    })
    const completedAppointments = days.flatMap((day) => day.appointments)
    const totalRevenue = days.reduce((sum, day) => sum + day.revenue, 0)
    return {
      month: localDateKey(month).slice(0, 7),
      days,
      totalRevenue,
      serviceCount: completedAppointments.length,
      averageTicket: completedAppointments.length
        ? totalRevenue / completedAppointments.length
        : 0,
      completedAppointments,
    }
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
      services = items.map(normalizeService).filter((service) => service.name)
      publish()
      return services.slice()
    },
    setAppointments(items = []) {
      appointments = items.map(normalizeAppointment).filter((appointment) => appointment.date && appointment.time)
      publish()
      return appointments.slice()
    },
    addService(input = {}) {
      const service = normalizeService(input)
      if (!service.name) throw new Error('Informe o nome do serviço.')
      if (!Number.isFinite(Number(input.price)) || Number(input.price) < 0) throw new Error('Informe um preço válido para o serviço.')
      if (services.some((item) => item.name.toLocaleLowerCase(DATE_LOCALE) === service.name.toLocaleLowerCase(DATE_LOCALE))) {
        throw new Error('Já existe um serviço com esse nome.')
      }
      services = [...services, service]
      publish()
      return service
    },
    updateService(id, updates = {}) {
      const index = services.findIndex((service) => service.id === String(id))
      if (index < 0) throw new Error('Serviço não encontrado.')
      const changed = normalizeService({ ...services[index], ...updates, id: services[index].id })
      if (!changed.name) throw new Error('O nome do serviço não pode ficar vazio.')
      services = services.map((service, serviceIndex) => serviceIndex === index ? changed : service)
      publish()
      return changed
    },
    removeService(id) {
      const linked = appointments.some((appointment) => appointment.serviceId === String(id))
      if (linked) throw new Error('Este serviço já está ligado a atendimentos. Desative-o no Supabase em vez de removê-lo.')
      services = services.filter((service) => service.id !== String(id))
      publish()
    },
    addAppointment(input = {}) {
      const appointment = normalizeAppointment(input)
      const service = getService(appointment.serviceId)
      if (!appointment.client) throw new Error('Informe o nome do cliente.')
      if (!appointment.date) throw new Error('Escolha uma data válida.')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)) throw new Error('Escolha um horário válido.')
      if (!service) throw new Error('Cadastre ou selecione um serviço antes de agendar.')
      if (appointments.some((item) => item.date === appointment.date && item.time === appointment.time && item.status !== STATUS.CANCELLED)) {
        throw new Error('Já existe um atendimento neste horário. Escolha outro horário.')
      }
      if (appointment.price == null) appointment.price = service.price
      appointments = [...appointments, appointment]
      publish()
      return appointment
    },
    updateAppointment(id, updates = {}) {
      const existing = appointments.find((appointment) => appointment.id === String(id))
      if (!existing) throw new Error('Agendamento não encontrado.')
      const changed = normalizeAppointment({ ...existing, ...updates, id: existing.id })
      if (!changed.client || !changed.date || !changed.time) throw new Error('Cliente, data e horário são obrigatórios.')
      if (!getService(changed.serviceId)) throw new Error('Serviço não encontrado.')
      if (changed.status === STATUS.SCHEDULED && appointments.some((item) => item.id !== changed.id && item.date === changed.date && item.time === changed.time && item.status === STATUS.SCHEDULED)) {
        throw new Error('Já existe um atendimento neste horário.')
      }
      appointments = appointments.map((appointment) => appointment.id === changed.id ? changed : appointment)
      publish()
      return changed
    },
    updatePublicReservation(id, updates = {}) {
      const existing = appointments.find((appointment) => appointment.id === String(id))
      if (!existing || existing.source !== 'public') throw new Error('Reserva pública não encontrada.')
      const changed = normalizeAppointment({
        ...existing,
        ...updates,
        id: `public:${updates.date}:${updates.time}`,
        source: 'public',
      })
      if (!changed.date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(changed.time)) {
        throw new Error('Escolha uma data e um horário válidos.')
      }
      appointments = appointments.map((appointment) => appointment.id === existing.id ? changed : appointment)
      publish()
      return changed
    },
    removeAppointment(id) {
      appointments = appointments.filter((appointment) => appointment.id !== String(id))
      publish()
    },
  }
}
