// Perfis do sistema. Quanto maior o nível, mais permissões.
// As mesmas regras estão no banco (função validar_gestao_usuario).
export const PERFIS = {
  MASTER: {
    rotulo: 'Master',
    nivel: 5,
    descricao: 'Acesso total. Nomeia gestores e cuida da configuração do sistema.',
  },
  GESTOR: {
    rotulo: 'Gestor',
    nivel: 4,
    descricao: 'Cria usuários abaixo do seu nível, cuida das classes, unidades e setores e consulta o histórico.',
  },
  ALMOXARIFE: {
    rotulo: 'Almoxarife',
    nivel: 3,
    descricao: 'Cuida do recebimento, da separação, das saídas, do cadastro de materiais e do inventário.',
  },
  SOLICITANTE: {
    rotulo: 'Solicitante',
    nivel: 2,
    descricao: 'Faz e acompanha os próprios pedidos de material.',
  },
  CONSULTA: {
    rotulo: 'Consulta',
    nivel: 1,
    descricao: 'Só consulta, sem alterar nada. Indicado para aprendizes.',
  },
};

export const nivel = perfil => PERFIS[perfil]?.nivel || 0;
export const rotuloPerfil = perfil => PERFIS[perfil]?.rotulo || perfil || '';

// Quem pode gerenciar a conta de quem.
export function podeGerenciar(ator, alvo) {
  if (!ator || !alvo || ator.id === alvo.id) return false;
  if (nivel(ator.perfil) < 4) return false;
  if (ator.perfil === 'MASTER') return true;
  return nivel(alvo.perfil) < nivel(ator.perfil);
}

// Perfis que o ator pode atribuir a outra pessoa.
export function perfisAtribuiveis(ator) {
  return Object.keys(PERFIS).filter(p => ator?.perfil === 'MASTER' || nivel(p) < nivel(ator?.perfil));
}
