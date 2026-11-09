import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, executando, erroAmigavel, toast, fmtDataHora, fmtData } from '../lib/ui.js';
import { buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { codigoLocalizacao, situacaoEstoque, fmtQtd, TIPOS_MOVIMENTO, CRITICIDADES, nomeDeposito } from '../lib/materiais.js';
import { baixarExcel, dataHora } from '../lib/excel.js';
import { STATUS_PEDIDO } from './pedidos.js';

const NIVEIS = { ALTA: { rotulo: 'Alta', classe: 'red' }, MEDIA: { rotulo: 'Média', classe: 'low' }, BAIXA: { rotulo: 'Baixa', classe: 'gray' } };
const STATUS_REC = { CONFERENCIA: 'Em conferência', DIVERGENTE: 'Com divergência', APROVADO: 'Aguardando guarda', GUARDADO: 'Guardado', CANCELADO: 'Cancelado' };
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function montar(el, ctx) {
  let semanais = [];
  let rotatividade = [];
  let base = null;
  const periodo = { de: diasAtras(30), ate: hoje() };

  // Dados de apoio (materiais, classes, depósitos) para dar nome a tudo.
  async function carregarBase() {
    const [m, c, d, u] = await Promise.all([
      buscarTodos(() => supabase.from('materiais').select('*').order('nome')),
      supabase.from('classes').select('id,nome'),
      supabase.from('depositos').select('id,numero,nome,unidade_id'),
      supabase.from('unidades').select('id,nome,sigla'),
    ]);
    for (const x of [c, d, u]) if (x.error) throw x.error;
    const classes = new Map(c.data.map(x => [x.id, x]));
    const depositos = new Map(d.data.map(x => [x.id, x]));
    const materiais = new Map(m.map(x => [x.id, {
      ...x, classe: classes.get(x.classe_id)?.nome || '', deposito: depositos.get(x.deposito_id),
      local: codigoLocalizacao(depositos.get(x.deposito_id)?.numero, x.prateleira, x.lado, x.andar, x.posicao),
    }]));
    base = { materiais, unidades: new Map(u.data.map(x => [x.id, x])) };
  }

  async function carregar() {
    const [s, r] = await Promise.all([
      supabase.from('relatorios_semanais').select('*').order('periodo_inicio', { ascending: false }).limit(26),
      supabase.rpc('rotatividade', { p_dias: 90 }),
    ]);
    if (s.error) throw s.error;
    semanais = s.data;
    rotatividade = (r.data || []).sort((a, b) => b.retiradas - a.retiradas || b.quantidade - a.quantidade);
    await carregarBase();
  }

  const intervalo = () => ({ de: new Date(periodo.de + 'T00:00:00').toISOString(), ate: new Date(periodo.ate + 'T23:59:59.999').toISOString() });
  const mat = id => base.materiais.get(id) || {};
  const rotulo = `${fmtData(periodo.de + 'T12:00:00')} a ${fmtData(periodo.ate + 'T12:00:00')}`.replace(/\//g, '-');

  const RELATORIOS = {
    estoque: {
      titulo: 'Estoque atual',
      descricao: 'Todos os materiais com saldo, mínimo, situação, endereço e rotatividade.',
      async gerar() {
        const niveis = new Map(rotatividade.map(r => [r.material_id, r]));
        const linhas = [...base.materiais.values()].filter(m => !m.removido_em).map(m => {
          const s = situacaoEstoque(m);
          const rot = niveis.get(m.id);
          return [m.codigo, m.prn, m.nome, m.classe, m.unidade_medida, Number(m.saldo), Number(m.estoque_minimo), Number(m.saldo_emergencial),
            s.rotulo, CRITICIDADES[m.criticidade]?.rotulo, m.local, nomeDeposito(m.deposito), NIVEIS[rot?.nivel || 'BAIXA'].rotulo, rot?.retiradas || 0];
        });
        return [{ nome: 'Estoque', colunas: ['Código', 'Código SAP', 'Material', 'Classe', 'Unidade', 'Saldo', 'Mínimo', 'Emergencial', 'Situação', 'Criticidade', 'Endereço', 'Depósito', 'Rotatividade (90 dias)', 'Retiradas (90 dias)']
          .map((t, i) => ({ titulo: t, largura: [13, 12, 40, 16, 9, 9, 9, 12, 18, 12, 22, 20, 20, 18][i] })), linhas }];
      },
      arquivo: () => `Estoque atual - ${fmtData(new Date()).replace(/\//g, '-')}`,
    },
    movimentos: {
      titulo: 'Movimentações',
      descricao: 'Entradas, saídas, devoluções e ajustes do período, com quem fez e o motivo.',
      async gerar() {
        const { de, ate } = intervalo();
        const dados = await buscarTodos(() => supabase.from('movimentacoes').select('*').gte('em', de).lte('em', ate).order('em'));
        return [{ nome: 'Movimentações', colunas: [['Data', 18], ['Tipo', 14], ['Código', 13], ['Material', 40], ['Quantidade', 12], ['Unidade', 9], ['Saldo depois', 12], ['Quem', 24], ['Motivo', 40], ['Documento', 30]].map(([titulo, largura]) => ({ titulo, largura })),
          linhas: dados.map(x => [dataHora(x.em), TIPOS_MOVIMENTO[x.tipo] || x.tipo, mat(x.material_id).codigo, mat(x.material_id).nome, Number(x.variacao), mat(x.material_id).unidade_medida, Number(x.saldo_depois), x.usuario_nome, x.motivo, x.documento]) }];
      },
      arquivo: () => `Movimentacoes - ${rotulo}`,
    },
    pedidos: {
      titulo: 'Pedidos',
      descricao: 'Pedidos do período com itens, situação, quem separou e quem retirou.',
      async gerar() {
        const { de, ate } = intervalo();
        const pedidos = await buscarTodos(() => supabase.from('pedidos').select('*').gte('criado_em', de).lte('criado_em', ate).order('criado_em'));
        const ids = new Set(pedidos.map(p => p.id));
        const itens = (await buscarTodos(() => supabase.from('pedido_itens').select('*').order('id'))).filter(i => ids.has(i.pedido_id));
        const porId = new Map(pedidos.map(p => [p.id, p]));
        return [{ nome: 'Pedidos', colunas: [['Pedido', 12], ['Data', 18], ['Solicitante', 26], ['Situação', 22], ['Separado por', 22], ['Retirado por', 24], ['Retirado em', 18], ['Emergencial', 12], ['Motivo do encerramento', 30]].map(([titulo, largura]) => ({ titulo, largura })),
          linhas: pedidos.map(p => [p.numero, dataHora(p.criado_em), p.solicitante_nome, STATUS_PEDIDO[p.status]?.rotulo, p.separado_por_nome, p.recebedor_nome, dataHora(p.retirado_em), p.usa_emergencial ? 'Sim' : 'Não', p.motivo_encerramento]) },
        { nome: 'Itens', colunas: [['Pedido', 12], ['Código', 13], ['Material', 40], ['Pedido', 10], ['Separado', 10], ['Entregue', 10], ['Devolvido', 10], ['Unidade', 9], ['Motivo da retirada', 30]].map(([titulo, largura]) => ({ titulo, largura })),
          linhas: itens.map(i => [porId.get(i.pedido_id)?.numero, mat(i.material_id).codigo, mat(i.material_id).nome, Number(i.quantidade), i.quantidade_separada === null ? null : Number(i.quantidade_separada), i.quantidade_entregue === null ? null : Number(i.quantidade_entregue), Number(i.quantidade_devolvida), mat(i.material_id).unidade_medida, { COMUM: 'Uso comum', PERDIDO: 'Reposição de item perdido', SEM_CONDICOES: 'Reposição de item sem condições' }[i.categoria]]) }];
      },
      arquivo: () => `Pedidos - ${rotulo}`,
    },
    recebimentos: {
      titulo: 'Recebimentos e divergências',
      descricao: 'Notas recebidas no período, conferência item a item e as divergências registradas.',
      async gerar() {
        const { de, ate } = intervalo();
        const recs = await buscarTodos(() => supabase.from('recebimentos').select('*').gte('criado_em', de).lte('criado_em', ate).order('criado_em'));
        const ids = new Set(recs.map(r => r.id));
        const itens = (await buscarTodos(() => supabase.from('recebimento_itens').select('*').order('id'))).filter(i => ids.has(i.recebimento_id));
        const porId = new Map(recs.map(r => [r.id, r]));
        return [{ nome: 'Recebimentos', colunas: [['Recebimento', 13], ['Data', 18], ['Fornecedor', 30], ['Nota', 12], ['Situação', 20], ['Recebido por', 22], ['Aprovado por', 22], ['Divergência', 50]].map(([titulo, largura]) => ({ titulo, largura })),
          linhas: recs.map(r => [r.numero, dataHora(r.criado_em), r.fornecedor, r.nf_numero + (r.nf_serie ? '-' + r.nf_serie : ''), STATUS_REC[r.status], r.recebido_por_nome, r.aprovado_por_nome, r.divergencia]) },
        { nome: 'Conferência', colunas: [['Recebimento', 13], ['Código', 13], ['Material', 40], ['Na nota', 10], ['Conferida', 10], ['Diferença', 10], ['Unidade', 9], ['Observação', 30]].map(([titulo, largura]) => ({ titulo, largura })),
          linhas: itens.map(i => [porId.get(i.recebimento_id)?.numero, mat(i.material_id).codigo, mat(i.material_id).nome, Number(i.quantidade_nf), i.quantidade_conferida === null ? null : Number(i.quantidade_conferida), i.quantidade_conferida === null ? null : Number(i.quantidade_conferida) - Number(i.quantidade_nf), mat(i.material_id).unidade_medida, i.observacao]) }];
      },
      arquivo: () => `Recebimentos - ${rotulo}`,
    },
    rotatividade: {
      titulo: 'Rotatividade',
      descricao: 'Materiais mais e menos retirados nos últimos 90 dias, em três níveis.',
      async gerar() {
        const niveis = new Map(rotatividade.map(r => [r.material_id, r]));
        const linhas = [...base.materiais.values()].filter(m => !m.removido_em)
          .map(m => ({ m, r: niveis.get(m.id) })).sort((a, b) => (b.r?.retiradas || 0) - (a.r?.retiradas || 0))
          .map(({ m, r }) => [m.codigo, m.nome, m.classe, NIVEIS[r?.nivel || 'BAIXA'].rotulo, r?.retiradas || 0, Number(r?.quantidade || 0), m.unidade_medida, m.local]);
        return [{ nome: 'Rotatividade', colunas: [['Código', 13], ['Material', 40], ['Classe', 16], ['Nível', 10], ['Retiradas', 10], ['Quantidade', 12], ['Unidade', 9], ['Endereço', 22]].map(([titulo, largura]) => ({ titulo, largura })), linhas }];
      },
      arquivo: () => `Rotatividade 90 dias - ${fmtData(new Date()).replace(/\//g, '-')}`,
    },
  };

  function planilhaSemanal(r) {
    const d = r.dados || {};
    const mov = d.movimentos || {};
    return [{
      nome: 'Resumo',
      colunas: [{ titulo: 'Indicador', largura: 36 }, { titulo: 'Valor', largura: 14 }],
      linhas: [
        ['Período', `${fmtData(r.periodo_inicio + 'T12:00:00')} a ${fmtData(r.periodo_fim + 'T12:00:00')}`],
        ...Object.entries(TIPOS_MOVIMENTO).map(([t, nome]) => [`${nome}: lançamentos`, mov[t]?.lancamentos || 0]),
        ...Object.entries(STATUS_PEDIDO).map(([s, x]) => [`Pedidos ${x.rotulo.toLowerCase()}`, d.pedidos?.[s] || 0]),
        ...Object.entries(STATUS_REC).map(([s, nome]) => [`Recebimentos ${nome.toLowerCase()}`, d.recebimentos?.[s] || 0]),
        ['Materiais no mínimo ou abaixo', (d.abaixo_minimo || []).length],
      ],
    }, {
      nome: 'Mais retirados',
      colunas: [['Código', 13], ['Material', 40], ['Quantidade', 12], ['Unidade', 9], ['Retiradas', 10]].map(([titulo, largura]) => ({ titulo, largura })),
      linhas: (d.mais_retirados || []).map(x => [x.codigo, x.nome, Number(x.quantidade), x.unidade, x.retiradas]),
    }, {
      nome: 'Abaixo do mínimo',
      colunas: [['Código', 13], ['Material', 40], ['Saldo', 10], ['Mínimo', 10], ['Unidade', 9]].map(([titulo, largura]) => ({ titulo, largura })),
      linhas: (d.abaixo_minimo || []).map(x => [x.codigo, x.nome, Number(x.saldo), Number(x.minimo), x.unidade]),
    }];
  }

  function resumoSemanal(r) {
    const d = r.dados || {};
    const mov = d.movimentos || {};
    return `<div class="small muted">${mov.SAIDA?.lancamentos || 0} saída(s), ${mov.ENTRADA?.lancamentos || 0} entrada(s), ${Object.values(d.pedidos || {}).reduce((a, b) => a + b, 0)} pedido(s), ${(d.abaixo_minimo || []).length} material(is) abaixo do mínimo</div>`;
  }

  function desenhar() {
    const top = rotatividade.slice(0, 10);
    el.innerHTML = `
      ${cabecalho('Relatórios', 'Exportação para Excel (.xlsx), relatório semanal automático e rotatividade dos materiais.')}
      <section class="card card-pad painel-bloco">
        <div class="bloco-topo">
          <div><h2 class="section-title">Relatório semanal</h2><p class="section-sub">Gerado toda segunda-feira às 7h, quando o agendamento do Supabase está ligado (veja o README). Também dá para gerar agora.</p></div>
          <button class="btn btn-primary btn-sm" type="button" data-rel="gerar-semanal">Gerar agora</button>
        </div>
        <ul class="lista-simples">${semanais.map(r => `<li><div><b>${fmtData(r.periodo_inicio + 'T12:00:00')} a ${fmtData(r.periodo_fim + 'T12:00:00')}</b>
          <div class="small muted">Gerado em ${fmtDataHora(r.gerado_em)} · ${esc(r.gerado_por_nome || '')}</div>${resumoSemanal(r)}</div>
          <button class="btn btn-light btn-sm" type="button" data-semanal="${r.id}">Baixar Excel</button></li>`).join('') || '<li class="vazio">Nenhum relatório semanal ainda. Use "Gerar agora".</li>'}</ul>
      </section>
      <section class="card card-pad painel-bloco">
        <h2 class="section-title">Relatórios por período</h2>
        <form class="toolbar filtros" id="formPeriodo" novalidate>
          <label class="filtro-campo">De<input type="date" id="rDe" value="${periodo.de}"></label>
          <label class="filtro-campo">Até<input type="date" id="rAte" value="${periodo.ate}"></label>
        </form>
        <div class="grade-relatorios">${Object.entries(RELATORIOS).map(([id, r]) => `<div class="cartao-relatorio">
          <b>${r.titulo}</b><p class="small muted">${r.descricao}</p>
          <button class="btn btn-light btn-sm" type="button" data-relatorio="${id}">Baixar Excel</button></div>`).join('')}</div>
      </section>
      <section class="card card-pad painel-bloco">
        <h2 class="section-title">Rotatividade dos últimos 90 dias</h2>
        <p class="section-sub">Os 20% mais retirados são de rotatividade alta, os 30% seguintes média, e os demais baixa. Pelo POP, os de alta rotatividade devem ficar em local de fácil acesso.</p>
        <div class="table-wrap"><table class="table tabela-compacta"><thead><tr><th>Material</th><th>Endereço</th><th>Retiradas</th><th>Quantidade</th><th>Nível</th></tr></thead>
        <tbody>${top.map(r => { const m = mat(r.material_id); return `<tr><td><b>${esc(m.nome || '')}</b><div class="small muted">${esc(m.codigo || '')}</div></td><td><span class="codigo-local">${esc(m.local || '')}</span></td><td>${r.retiradas}</td><td>${fmtQtd(r.quantidade)} ${esc(m.unidade_medida || '')}</td><td><span class="pill ${NIVEIS[r.nivel].classe}">${NIVEIS[r.nivel].rotulo}</span></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhuma retirada nos últimos 90 dias.</td></tr>'}</tbody></table></div>
      </section>`;
  }

  await carregar();
  desenhar();

  el.addEventListener('change', e => {
    if (e.target.id === 'rDe') periodo.de = e.target.value;
    if (e.target.id === 'rAte') periodo.ate = e.target.value;
  });
  el.addEventListener('click', async e => {
    const botao = e.target.closest('[data-relatorio], [data-semanal], [data-rel]');
    if (!botao) return;
    await executando(botao, async () => {
      try {
        if (botao.dataset.rel === 'gerar-semanal') {
          const { error } = await supabase.rpc('gerar_relatorio_semanal');
          if (error) throw error;
          toast('Relatório da semana gerado.');
          await carregar();
          return desenhar();
        }
        if (botao.dataset.semanal) {
          const r = semanais.find(x => String(x.id) === botao.dataset.semanal);
          return await baixarExcel(`Relatorio semanal - ${r.periodo_inicio} a ${r.periodo_fim}`, planilhaSemanal(r));
        }
        if (periodo.de > periodo.ate) return toast('A data inicial precisa ser antes da final.', 'erro');
        await carregarBase();
        const rel = RELATORIOS[botao.dataset.relatorio];
        await baixarExcel(rel.arquivo(), await rel.gerar());
      } catch (falha) {
        toast(erroAmigavel(falha), 'erro');
      }
    });
  });

  ctx.aoSair(ouvir(['relatorios_semanais'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    desenhar();
  }));
}
