import { supabase } from './supabase.js';

// Chama a função de servidor que cria e altera usuários.
// Ela usa a chave de serviço, que nunca fica no navegador.
export async function gerenciarUsuario(corpo) {
  const { data, error } = await supabase.functions.invoke('gerenciar-usuario', { body: corpo });
  if (error) {
    let mensagem = 'Não foi possível concluir. Tente novamente.';
    try {
      const resposta = await error.context?.json?.();
      if (resposta?.erro) mensagem = resposta.erro;
    } catch { /* resposta sem corpo */ }
    if (error.name === 'FunctionsFetchError') {
      mensagem = 'A função gerenciar-usuario não respondeu. Confira se ela foi publicada no Supabase.';
    }
    throw new Error(mensagem);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}
