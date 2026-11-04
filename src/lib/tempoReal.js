import { supabase } from './supabase.js';

// Atualização em tempo real: cada mudança no banco chega às telas abertas.
// As páginas pedem para "ouvir" as tabelas que usam e recarregam os dados.

const TABELAS = [
  'perfis', 'unidades', 'setores', 'classes', 'configuracoes', 'auditoria',
  'sessoes_ativas', 'depositos', 'materiais', 'movimentacoes', 'etiquetas',
];

const ouvintes = new Set();
const observadoresStatus = new Set();
let canal = null;
let conectado = false;
let caiu = false;

function avisar(ouvinte) {
  clearTimeout(ouvinte.timer);
  ouvinte.timer = setTimeout(async () => {
    const tabelas = new Set(ouvinte.pendentes);
    const mudancas = ouvinte.mudancas.splice(0);
    ouvinte.pendentes.clear();
    try {
      await ouvinte.fn(tabelas, mudancas);
    } catch (erro) {
      console.error('Falha ao atualizar a tela em tempo real', erro);
    }
  }, 300);
}

export function distribuir(tabela, mudanca = {}) {
  for (const ouvinte of ouvintes) {
    if (!ouvinte.tabelas.has(tabela)) continue;
    ouvinte.pendentes.add(tabela);
    ouvinte.mudancas.push({ tabela, ...mudanca });
    avisar(ouvinte);
  }
}

function mudarStatus(novo) {
  conectado = novo;
  observadoresStatus.forEach(fn => fn(conectado));
}

export function iniciarTempoReal() {
  if (canal) return;
  canal = supabase.channel('almoxarifado-tempo-real');
  for (const tabela of TABELAS) {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, payload => {
      distribuir(tabela, { evento: payload.eventType, novo: payload.new, antigo: payload.old });
    });
  }
  canal.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      mudarStatus(true);
      // Voltou depois de cair: recarrega tudo, porque mudanças podem ter passado.
      if (caiu) {
        caiu = false;
        for (const ouvinte of ouvintes) {
          ouvinte.tabelas.forEach(t => ouvinte.pendentes.add(t));
          avisar(ouvinte);
        }
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (conectado) caiu = true;
      mudarStatus(false);
    }
  });
}

// Devolve uma função que para de ouvir.
export function ouvir(tabelas, fn) {
  const ouvinte = { tabelas: new Set(tabelas), fn, timer: null, pendentes: new Set(), mudancas: [] };
  ouvintes.add(ouvinte);
  return () => {
    clearTimeout(ouvinte.timer);
    ouvintes.delete(ouvinte);
  };
}

export function aoMudarConexao(fn) {
  observadoresStatus.add(fn);
  fn(conectado);
  return () => observadoresStatus.delete(fn);
}

// Só nos testes automáticos: permite simular uma mudança vinda do banco.
if (import.meta.env.MODE === 'teste') window.__simularMudanca = distribuir;
