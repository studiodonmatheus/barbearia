import { supabase } from './supabaseClient.js'

const TABELA = 'Horarios'

export async function obterHorarios(dataInicio, dataFim) {
    const { data, error } = await supabase
        .from(TABELA)
        .select('dia_selecionado,hora_inicio,hora_fim')
        .gte('dia_selecionado', dataInicio)
        .lte('dia_selecionado', dataFim)

    if (error) throw error
    return data ?? []
}

export async function inserirReserva(data, horaInicio, horaFim) {
    const { error } = await supabase.from(TABELA).insert({
        dia_selecionado: data,
        hora_inicio: horaInicio,
        hora_fim: horaFim
    })

    if (error) throw error
}

