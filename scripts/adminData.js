import { obterSessaoAutorizada } from './auth.js'
import { supabase } from './supabaseClient.js'

const TABELA_HORARIOS = 'Horarios'
const CHAVE_NOMES_CLIENTES = 'donmatheus.admin.client-names.v1'
const CAMPOS_SERVICO = 'id,name,price,duration_minutes,active'
const CAMPOS_AGENDAMENTO = 'id,service_id,appointment_date,appointment_time,status,price'

function carregarNomesLocais() {
  const raw = localStorage.getItem(CHAVE_NOMES_CLIENTES)
  if (!raw) return {}

  const nomes = JSON.parse(raw)
  if (!nomes || typeof nomes !== 'object' || Array.isArray(nomes)) {
    throw new Error('Os nomes de clientes armazenados neste navegador estão em um formato inválido.')
  }
  return nomes
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
  }
}

function mapPublicReservation(row) {
  return {
    id: `public:${row.dia_selecionado}:${String(row.hora_inicio).slice(0, 5)}`,
    date: row.dia_selecionado,
    time: String(row.hora_inicio).slice(0, 5),
    client: 'Reserva pública',
    serviceId: '',
    status: 'scheduled',
    price: null,
    source: 'public',
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

  const [servicesResult, appointmentsResult, reservationsResult] = await Promise.all([
    supabase.from('services').select(CAMPOS_SERVICO).order('name'),
    supabase.from('appointments').select(CAMPOS_AGENDAMENTO).order('appointment_date').order('appointment_time'),
    supabase.from(TABELA_HORARIOS).select('dia_selecionado,hora_inicio,hora_fim').order('dia_selecionado').order('hora_inicio'),
  ])
  if (servicesResult.error) throw servicesResult.error
  if (appointmentsResult.error) throw appointmentsResult.error
  if (reservationsResult.error) throw reservationsResult.error

  const localNames = carregarNomesLocais()
  const appointments = (appointmentsResult.data || []).map((row) => mapAppointment(row, localNames))
  const occupiedSlots = new Set(appointments.map((item) => `${item.date} ${item.time}`))
  const publicReservations = (reservationsResult.data || [])
    .map(mapPublicReservation)
    .filter((item) => !occupiedSlots.has(`${item.date} ${item.time}`))

  panel.setServices((servicesResult.data || []).map(mapService))
  panel.setAppointments([...appointments, ...publicReservations])
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

async function updateAppointment(id, changes) {
  const { data, error } = await supabase.from('appointments').update({
    status: changes.status,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select(CAMPOS_AGENDAMENTO).single()
  if (error) throw error

  if (changes.status === 'cancelled') {
    const { error: reservationError } = await supabase.from(TABELA_HORARIOS)
      .delete().eq('dia_selecionado', data.appointment_date)
      .eq('hora_inicio', formatTime(data.appointment_time))
    if (reservationError) {
      const { error: rollbackError } = await supabase.from('appointments')
        .update({ status: 'scheduled' }).eq('id', id)
      if (rollbackError) {
        throw new Error(`O cancelamento foi salvo, mas o bloqueio do horário não foi removido (${reservationError.message}) e não foi possível reverter o status (${rollbackError.message}).`)
      }
      throw reservationError
    }
  }

  return mapAppointment(data, carregarNomesLocais())
}

export const adminData = Object.freeze({
  loadDashboardData,
  createService,
  createAppointment,
  updateAppointment,
})
