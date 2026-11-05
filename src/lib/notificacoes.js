import { supabase } from './supabase.js';
import { ouvir } from './tempoReal.js';

// Contador de novidades em cada item do menu: o que outras pessoas
// criaram ou mudaram desde a última vez que você abriu aquela página.
const FONTES = {
  pedidos: { tabela: 'pedidos', data: 'atualizado_em', autor: 'atualizado_por' },
  recebimentos: { tabela: 'recebimentos', data: 'atualizado_em', autor: 'atualizado_por' },
  materiais: { tabela: 'materiais', data: 'criado_em', autor: 'criado_por' },
  inventarios: { tabela: 'inventarios', data: 'atualizado_em', autor: 'atualizado_por' },
  depositos: { tabela: 'depositos', data: 'criado_em', autor: 'criado_por' },
  classes: { tabela: 'classes', data: 'atualizado_em', autor: 'atualizado_por' },
  usuarios: { tabela: 'perfis', data: 'criado_em', autor: 'criado_por' },
  cadastros: { tabela: 'setores', data: 'criado_em', autor: 'criado_por' },
  relatorios: { tabela: 'relatorios_semanais', data: 'gerado_em', autor: null },
};

let usuarioId = null;
let rotaAberta = '';
let rotasVisiveis = [];
let aoAtualizar = () => {};
const contagens = {};
let timer = null;

const chave = () => `almox-visto-${usuarioId}`;
const lerVistos = () => JSON.parse(localStorage.getItem(chave()) || 'null');
const gravarVistos = v => localStorage.setItem(chave(), JSON.stringify(v));

export function marcarVisto(rota) {
  if (!usuarioId || !FONTES[rota]) return;
  const vistos = lerVistos() || {};
  vistos[rota] = new Date().toISOString();
  gravarVistos(vistos);
  contagens[rota] = 0;
  aoAtualizar({ ...contagens });
}

async function contar(rota, desde) {
  const f = FONTES[rota];
  let q = supabase.from(f.tabela).select('*', { count: 'exact', head: true }).gt(f.data, desde);
  if (f.autor) q = q.neq(f.autor, usuarioId);
  const { count, error } = await q;
  return error ? 0 : count || 0;
}

async function recalcular() {
  if (!usuarioId) return;
  const vistos = lerVistos() || {};
  const alvo = rotasVisiveis.filter(r => FONTES[r]);
  await Promise.all(alvo.map(async rota => {
    if (rota === rotaAberta) { contagens[rota] = 0; return; }
    contagens[rota] = vistos[rota] ? await contar(rota, vistos[rota]) : 0;
  }));
  aoAtualizar({ ...contagens });
}

export function agendarRecalculo() {
  clearTimeout(timer);
  timer = setTimeout(recalcular, 400);
}

export function iniciarNotificacoes(id, rotas, callback) {
  usuarioId = id;
  rotasVisiveis = rotas;
  aoAtualizar = callback;
  // Primeiro acesso neste aparelho: começa do zero, sem acumular o passado.
  if (!lerVistos()) gravarVistos(Object.fromEntries(Object.keys(FONTES).map(r => [r, new Date().toISOString()])));
  const tabelas = [...new Set(Object.values(FONTES).map(f => f.tabela))];
  ouvir(tabelas, () => {
    if (rotaAberta) marcarVisto(rotaAberta);
    agendarRecalculo();
  });
  recalcular();
}

export function trocarRota(rota, rotas) {
  if (rotaAberta) marcarVisto(rotaAberta);
  rotaAberta = rota;
  if (rotas) rotasVisiveis = rotas;
  marcarVisto(rota);
  agendarRecalculo();
}
