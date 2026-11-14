import { supabase } from '../shared/supabaseClient.js'

const TABELA = 'Horarios'
const TABELA_SERVICOS = 'services'

export async function obterServicos() {
    const { data, error } = await supabase
        .from(TABELA_SERVICOS)
        .select('id,name,price')
        .eq('active', true)
        .order('name')

    if (error) throw error
    return data ?? []
}

export async function obterHorarios(dataInicio, dataFim) {
    const { data, error } = await supabase
        .from(TABELA)
        .select('dia_selecionado,hora_inicio,hora_fim')
        .gte('dia_selecionado', dataInicio)
        .lte('dia_selecionado', dataFim)

    if (error) throw error
    return data ?? []
}

export async function inserirReserva(data, horaInicio, horaFim, nomeCliente, telefoneContato, servicoId) {
    const { error } = await supabase.rpc('create_public_booking', {
        p_date: data,
        p_start: horaInicio,
        p_end: horaFim,
        p_customer_name: nomeCliente,
        p_contact_number: telefoneContato,
        p_service_id: servicoId
    })

    if (error) throw error
}
