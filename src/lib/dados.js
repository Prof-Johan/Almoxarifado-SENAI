import { supabase } from './supabase.js';

// Atualiza um registro e confirma que a alteração foi aceita pelo banco.
// Sem permissão, o banco não devolve erro, só não altera nada.
export async function atualizarRegistro(tabela, id, dados) {
  const { data, error } = await supabase.from(tabela).update(dados).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Seu perfil não tem permissão para esta ação.');
}

export async function criarRegistro(tabela, dados) {
  const { error } = await supabase.from(tabela).insert(dados);
  if (error) throw error;
}

// O Supabase devolve no máximo 1000 linhas por consulta. Busca em partes.
export async function buscarTodos(montarConsulta, tamanho = 1000) {
  const tudo = [];
  for (let inicio = 0; ; inicio += tamanho) {
    const { data, error } = await montarConsulta().range(inicio, inicio + tamanho - 1);
    if (error) throw error;
    tudo.push(...data);
    if (data.length < tamanho) return tudo;
  }
}
