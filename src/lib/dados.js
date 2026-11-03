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
