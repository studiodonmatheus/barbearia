import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = 'https://lbyerfbehukyloqzcaqp.supabase.co'
const ANON_KEY = 'sb_publishable_DoAs0hIlXXOA1B212ZTn9Q_HyqdLUeM'
const supabase = createClient(URL, ANON_KEY)
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

