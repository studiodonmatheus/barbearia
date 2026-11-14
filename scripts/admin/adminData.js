import { obterSessaoAutorizada } from '../auth/auth.js'
import { supabase } from '../shared/supabaseClient.js'

const TABELA_HORARIOS = 'Horarios'
const CHAVE_NOMES_CLIENTES = 'donmatheus.admin.client-names.v1'
const TABELA_DADOS_CLIENTE = 'booking_customer_data'
const CAMPOS_SERVICO = 'id,name,price,duration_minutes,active'
const CAMPOS_AGENDAMENTO = 'id,service_id,appointment_date,appointment_time,status,price'

function carregarNomesLocais() {
  try {
    const raw = localStorage.getItem(CHAVE_NOMES_CLIENTES)
    if (!raw) return {}

    const nomes = JSON.parse(raw)
    if (!nomes || typeof nomes !== 'object' || Array.isArray(nomes)) {
      localStorage.removeItem(CHAVE_NOMES_CLIENTES)
      return {}
    }
    return nomes
  } catch (error) {
    try {
      localStorage.removeItem(CHAVE_NOMES_CLIENTES)
    } catch {
      // Ignora falhas ao limpar dados corruptos locais.
    }
    return {}
  }
}

function mapService(row) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    durationMinutes: Number(row.duration_minutes),
    active: row.active,
  }
}

function mapAppointment(row, localNames) {
  return {
    id: row.id,
    date: row.appointment_date,
    time: String(row.appointment_time).slice(0, 5),
    client: localNames[row.id] || 'Cliente',
    serviceId: row.service_id,
    status: row.status,
    price: Number(row.price),
    phone: '',
  }
}

function mapPublicReservation(row, customer = null) {
  if (customer) {
    return {
      id: `booking:${customer.id}`,
      bookingDataId: customer.id,
      reservationId: row.id,
      date: row.dia_selecionado,
      time: String(row.hora_inicio).slice(0, 5),
      endTime: String(row.hora_fim).slice(0, 5),
      client: customer.customer_name || 'Cliente',
      phone: customer.contact_number || '',
      serviceId: customer.service_id || '',
      status: customer.status,
      price: customer.price == null ? null : Number(customer.price),
      source: 'booking',
    }
  }

  return {
    id: `public:${row.dia_selecionado}:${String(row.hora_inicio).slice(0, 5)}`,
    reservationId: row.id,
    date: row.dia_selecionado,
    time: String(row.hora_inicio).slice(0, 5),
    endTime: String(row.hora_fim).slice(0, 5),
    client: 'Período indisponível',
    phone: '',
    serviceId: '',
    status: 'scheduled',
    price: null,
    source: 'public',
  }
}

function mapCancelledBooking(customer) {
  return {
    id: `booking:${customer.id}`,
    bookingDataId: customer.id,
    reservationId: '',
    date: customer.appointment_date,
    time: String(customer.appointment_time).slice(0, 5),
    endTime: timeAfterMinutes(customer.appointment_time, 30).slice(0, 5),
    client: customer.customer_name || 'Cliente',
    phone: customer.contact_number || '',
    serviceId: customer.service_id || '',
    status: customer.status,
    price: customer.price == null ? null : Number(customer.price),
    source: 'booking',
  }
}

function formatTime(value) {
  return `${String(value).slice(0, 5)}:00`
}

function timeAfterMinutes(value, minutes) {
  const [hours, mins] = String(value).slice(0, 5).split(':').map(Number)
  const totalMinutes = hours * 60 + mins + minutes
  if (totalMinutes > 23 * 60 + 59) throw new Error('O agendamento não pode ultrapassar a meia-noite.')
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}:00`
}

async function loadDashboardData(panel) {
  const session = await obterSessaoAutorizada()
  if (!session) return false

  const [servicesResult, appointmentsResult, reservationsResult, customerDataResult] = await Promise.all([
    supabase.from('services').select(CAMPOS_SERVICO).order('name'),
    supabase.from('appointments').select(CAMPOS_AGENDAMENTO).order('appointment_date').order('appointment_time'),
    supabase.from(TABELA_HORARIOS).select('id,dia_selecionado,hora_inicio,hora_fim').order('dia_selecionado').order('hora_inicio'),
    supabase.from(TABELA_DADOS_CLIENTE)
      .select('id,reservation_id,customer_name,contact_number,service_id,price,status,appointment_date,appointment_time'),
  ])
  if (servicesResult.error) throw servicesResult.error
  if (appointmentsResult.error) throw appointmentsResult.error
  if (reservationsResult.error) throw reservationsResult.error
  if (customerDataResult.error) throw customerDataResult.error

  const localNames = carregarNomesLocais()
  const appointments = (appointmentsResult.data || []).map((row) => mapAppointment(row, localNames))
  const customerByReservationId = new Map(
    (customerDataResult.data || [])
      .filter((row) => row.reservation_id != null)
      .map((row) => [String(row.reservation_id), row]),
  )
  const occupiedSlots = new Set(appointments.map((item) => `${item.date} ${item.time}`))
  const publicReservations = (reservationsResult.data || [])
    .map((row) => mapPublicReservation(row, customerByReservationId.get(String(row.id))))
    .filter((item) => !occupiedSlots.has(`${item.date} ${item.time}`))
  const cancelledBookings = (customerDataResult.data || [])
    .filter((row) => row.reservation_id == null && row.status === 'cancelled')
    .map(mapCancelledBooking)

  panel.setServices((servicesResult.data || []).map(mapService))
  panel.setAppointments([...appointments, ...publicReservations, ...cancelledBookings])
  return true
}

async function createService(input) {
  const { data, error } = await supabase.from('services').insert({
    name: input.name.trim(),
    price: Number(input.price),
    duration_minutes: Number(input.durationMinutes),
    active: true,
  }).select(CAMPOS_SERVICO).single()
  if (error) throw error
  return mapService(data)
}

async function createAppointment(input) {
  const durationMinutes = Number(input.durationMinutes)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5) {
    throw new Error('A duração do serviço selecionado é inválida.')
  }
  const start = formatTime(input.time)
  const end = timeAfterMinutes(input.time, durationMinutes)
  const { data: conflicts, error: conflictError } = await supabase
    .from(TABELA_HORARIOS)
    .select('dia_selecionado')
    .eq('dia_selecionado', input.date)
    .lt('hora_inicio', end)
    .gt('hora_fim', start)
    .limit(1)
  if (conflictError) throw conflictError
  if (conflicts?.length) throw new Error('Esse horário já está reservado. Escolha outro horário.')

  const { data: appointment, error: appointmentError } = await supabase.from('appointments').insert({
    service_id: input.serviceId,
    appointment_date: input.date,
    appointment_time: start,
    status: input.status || 'scheduled',
    price: Number(input.price),
  }).select(CAMPOS_AGENDAMENTO).single()
  if (appointmentError) throw appointmentError

  const { error: reservationError } = await supabase.from(TABELA_HORARIOS).insert({
    dia_selecionado: input.date,
    hora_inicio: start,
    hora_fim: end,
  })
  if (reservationError) {
    const { error: rollbackError } = await supabase.from('appointments').delete().eq('id', appointment.id)
    if (rollbackError) {
      throw new Error(`Não foi possível reservar o horário (${reservationError.message}) nem desfazer o agendamento (${rollbackError.message}).`)
    }
    throw reservationError
  }

  try {
    const localNames = carregarNomesLocais()
    localNames[appointment.id] = input.client.trim()
    localStorage.setItem(CHAVE_NOMES_CLIENTES, JSON.stringify(localNames))
  } catch (error) {
    const { error: reservationRollbackError } = await supabase.from(TABELA_HORARIOS)
      .delete().eq('dia_selecionado', input.date).eq('hora_inicio', start).eq('hora_fim', end)
    const { error: appointmentRollbackError } = await supabase.from('appointments').delete().eq('id', appointment.id)
    if (reservationRollbackError || appointmentRollbackError) {
      throw new Error(`Não foi possível salvar o nome somente neste navegador (${error.message}); também houve falha ao desfazer os dados no Supabase.`)
    }
    throw new Error(`Não foi possível salvar o nome do cliente neste navegador: ${error.message}`)
  }

  return mapAppointment(appointment, { [appointment.id]: input.client.trim() })
}

async function createBlockedPeriod(input) {
  const parsedDate = new Date(`${input.date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== input.date) {
    throw new Error('Escolha uma data válida.')
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.end)) {
    throw new Error('Informe um horário de início e fim válido.')
  }
  if (input.start >= input.end) throw new Error('O horário de fim deve ser posterior ao início.')

  const start = formatTime(input.start)
  const end = formatTime(input.end)
  const conflicts = await findConflictingReservations(input.date, start, end)
  if (conflicts.length) throw new Error('Esse período já contém uma reserva ou outro bloqueio.')

  const reservationId = await insertReservation(input.date, start, end)
  return mapPublicReservation({
    id: reservationId,
    dia_selecionado: input.date,
    hora_inicio: start,
    hora_fim: end,
  })
}

function validateAppointmentChanges(changes) {
  if (!changes.serviceId) throw new Error('Selecione um serviço.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) throw new Error('Escolha uma data válida.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.time)) throw new Error('Escolha um horário válido.')
  if (!Number.isFinite(Number(changes.price)) || Number(changes.price) < 0) {
    throw new Error('Informe um preço válido para o atendimento.')
  }
  if (!Number.isInteger(Number(changes.durationMinutes)) || Number(changes.durationMinutes) < 5) {
    throw new Error('A duração do serviço selecionado é inválida.')
  }
  if (!['scheduled', 'completed', 'cancelled'].includes(changes.status)) {
    throw new Error('Selecione uma situação válida.')
  }
}

async function findConflictingReservations(date, start, end, ownReservation) {
  const { data, error } = await supabase.from(TABELA_HORARIOS)
    .select('dia_selecionado,hora_inicio,hora_fim')
    .eq('dia_selecionado', date)
    .lt('hora_inicio', end)
    .gt('hora_fim', start)
  if (error) throw error

  return (data || []).filter((row) => !(
    ownReservation
    && row.dia_selecionado === ownReservation.date
    && String(row.hora_inicio).slice(0, 5) === ownReservation.time
  ))
}

async function insertReservation(date, start, end) {
  const { data, error } = await supabase.from(TABELA_HORARIOS).insert({
    dia_selecionado: date,
    hora_inicio: start,
    hora_fim: end,
  }).select('id').single()
  if (error) throw error
  return data.id
}

async function deleteReservation(date, start, end) {
  let query = supabase.from(TABELA_HORARIOS).delete()
    .eq('dia_selecionado', date)
    .eq('hora_inicio', start)
  if (end) query = query.eq('hora_fim', end)
  const { error } = await query
  if (error) throw error
}

async function updateAppointment(id, changes) {
  const { data: current, error: currentError } = await supabase.from('appointments')
    .select(CAMPOS_AGENDAMENTO)
    .eq('id', id)
    .single()
  if (currentError) throw currentError

  const localNames = carregarNomesLocais()
  const serviceId = changes.serviceId || current.service_id
  let durationMinutes = changes.durationMinutes
  if (durationMinutes == null) {
    const { data: service, error: serviceError } = await supabase.from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .single()
    if (serviceError) throw serviceError
    durationMinutes = service.duration_minutes
  }
  changes = {
    client: changes.client ?? localNames[id] ?? 'Cliente',
    serviceId,
    date: changes.date || current.appointment_date,
    time: changes.time || String(current.appointment_time).slice(0, 5),
    price: changes.price ?? Number(current.price),
    status: changes.status || current.status,
    durationMinutes,
  }
  validateAppointmentChanges(changes)

  const oldDate = current.appointment_date
  const oldStart = formatTime(current.appointment_time)
  const oldLocal = { service_id: current.service_id, appointment_date: oldDate, appointment_time: current.appointment_time, status: current.status, price: current.price }
  let oldReservation = null
  if (current.status !== 'cancelled') {
    const { data: reservations, error: reservationsError } = await supabase.from(TABELA_HORARIOS)
      .select('hora_inicio,hora_fim')
      .eq('dia_selecionado', oldDate)
      .eq('hora_inicio', oldStart)
      .limit(1)
    if (reservationsError) throw reservationsError
    if (reservations?.length) {
      oldReservation = {
        date: oldDate,
        time: String(reservations[0].hora_inicio).slice(0, 5),
        endTime: String(reservations[0].hora_fim).slice(0, 5),
      }
    }
  }
  const newStart = formatTime(changes.time)
  const newEnd = timeAfterMinutes(changes.time, Number(changes.durationMinutes))
  const shouldReserve = changes.status !== 'cancelled'
  const reservationChanged = shouldReserve && (
    !oldReservation
    || oldReservation.date !== changes.date
    || oldReservation.time !== changes.time
    || oldReservation.endTime !== newEnd.slice(0, 5)
  )

  if (reservationChanged) {
    const conflicts = await findConflictingReservations(changes.date, newStart, newEnd, oldReservation)
    if (conflicts.length) throw new Error('Esse horário já está reservado. Escolha outro horário.')
  }

  let newReservationCreated = false
  if (reservationChanged) {
    await insertReservation(changes.date, newStart, newEnd)
    newReservationCreated = true
  }

  const { data, error } = await supabase.from('appointments').update({
    service_id: changes.serviceId,
    appointment_date: changes.date,
    appointment_time: newStart,
    status: changes.status,
    price: Number(changes.price),
    updated_at: new Date().toISOString(),
  }).eq('id', id).select(CAMPOS_AGENDAMENTO).single()
  if (error) {
    if (newReservationCreated) await deleteReservation(changes.date, newStart, newEnd)
    throw error
  }

  const reservationToRemove = oldReservation && (
    !shouldReserve
    || reservationChanged
  )
  if (reservationToRemove) {
    try {
      await deleteReservation(oldDate, oldStart)
    } catch (reservationError) {
      const { error: rollbackError } = await supabase.from('appointments')
        .update(oldLocal).eq('id', id)
      let cleanupError = null
      if (newReservationCreated) {
        try {
          await deleteReservation(changes.date, newStart, newEnd)
        } catch (error) {
          cleanupError = error
        }
      }
      if (rollbackError || cleanupError) {
        throw new Error(`Não foi possível atualizar o bloqueio do horário (${reservationError.message}) nem reverter todos os dados${rollbackError ? ` (${rollbackError.message})` : ''}${cleanupError ? ` (${cleanupError.message})` : ''}.`)
      }
      throw reservationError
    }
  }

  localNames[id] = changes.client.trim()
  try {
    localStorage.setItem(CHAVE_NOMES_CLIENTES, JSON.stringify(localNames))
  } catch (error) {
    throw new Error(`O agendamento foi atualizado, mas não foi possível salvar o nome do cliente neste navegador: ${error.message}`)
  }
  return mapAppointment(data, localNames)
}

async function updatePublicReservation(appointment, changes) {
  if (!appointment || appointment.source !== 'public') throw new Error('Reserva pública não encontrada.')
  if (!appointment.reservationId) throw new Error('O identificador da reserva pública está ausente. Recarregue o painel.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) throw new Error('Escolha uma data válida.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.time)) throw new Error('Escolha um horário válido.')

  const oldStartMinutes = Number(appointment.time.slice(0, 2)) * 60 + Number(appointment.time.slice(3, 5))
  const oldEndMinutes = Number(appointment.endTime.slice(0, 2)) * 60 + Number(appointment.endTime.slice(3, 5))
  const durationMinutes = oldEndMinutes - oldStartMinutes
  if (durationMinutes <= 0) throw new Error('A duração da reserva pública é inválida.')

  const newStart = formatTime(changes.time)
  const newEnd = timeAfterMinutes(changes.time, durationMinutes)
  const unchanged = appointment.date === changes.date && appointment.time === changes.time
  if (!unchanged) {
    const conflicts = await findConflictingReservations(changes.date, newStart, newEnd, {
      date: appointment.date,
      time: appointment.time,
    })
    if (conflicts.length) throw new Error('Esse horário já está reservado. Escolha outro horário.')
    const { error } = await supabase.from(TABELA_HORARIOS).update({
      dia_selecionado: changes.date,
      hora_inicio: newStart,
      hora_fim: newEnd,
    }).eq('id', appointment.reservationId)
    if (error) throw error
  }

  const customer = {
    id: appointment.bookingDataId || appointment.reservationId || appointment.id,
    customer_name: appointment.client || 'Cliente',
    contact_number: appointment.phone || '',
    service_id: appointment.serviceId || null,
    status: appointment.status || 'scheduled',
    price: appointment.price ?? null,
  }

  return mapPublicReservation({
    id: appointment.reservationId,
    dia_selecionado: changes.date,
    hora_inicio: newStart,
    hora_fim: newEnd,
  }, customer)
}

async function updatePublicBooking(appointment, changes) {
  if (!appointment || appointment.source !== 'booking') throw new Error('Agendamento público não encontrado.')
  if (!appointment.bookingDataId) throw new Error('O identificador do agendamento está ausente. Recarregue o painel.')
  if (!changes.client?.trim()) throw new Error('Informe o nome do cliente.')
  if (!changes.serviceId) throw new Error('Selecione um serviço.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) throw new Error('Escolha uma data válida.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(changes.time)) throw new Error('Escolha um horário válido.')
  if (!Number.isFinite(Number(changes.price)) || Number(changes.price) < 0) {
    throw new Error('Informe um preço válido para o atendimento.')
  }
  if (!['scheduled', 'completed', 'cancelled'].includes(changes.status)) {
    throw new Error('Selecione uma situação válida.')
  }

  const { data: reservationId, error } = await supabase.rpc('update_public_booking', {
    p_booking_id: appointment.bookingDataId,
    p_date: changes.date,
    p_start: formatTime(changes.time),
    p_service_id: changes.serviceId,
    p_price: Number(changes.price),
    p_status: changes.status,
    p_customer_name: changes.client.trim(),
  })
  if (error) throw error

  return {
    ...appointment,
    reservationId: reservationId == null ? '' : String(reservationId),
    date: changes.date,
    time: changes.time,
    endTime: timeAfterMinutes(changes.time, 30).slice(0, 5),
    client: changes.client.trim(),
    serviceId: changes.serviceId,
    price: Number(changes.price),
    status: changes.status,
  }
}

async function cancelPublicReservation(appointment) {
  if (!appointment || appointment.source !== 'public') throw new Error('Reserva pública não encontrada.')
  if (!appointment.reservationId) throw new Error('O identificador da reserva pública está ausente. Recarregue o painel.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.endTime)) {
    throw new Error('Os dados da reserva pública são inválidos.')
  }

  const { data, error } = await supabase.from(TABELA_HORARIOS).delete()
    .eq('id', appointment.reservationId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('A reserva pública não foi encontrada ou já foi cancelada.')
}

export const adminData = Object.freeze({
  loadDashboardData,
  createService,
  createAppointment,
  createBlockedPeriod,
  updateAppointment,
  updatePublicReservation,
  updatePublicBooking,
  cancelPublicReservation,
})
