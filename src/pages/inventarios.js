import { supabase } from '../lib/supabase.js';
import { $, $$, esc, cabecalho, abrirModal, aoFecharModal, fecharModal, executando, erroAmigavel, toast, fmtDataHora } from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { buscarTodos, atualizarRegistro } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { codigoLocalizacao, nomeDeposito, fmtQtd } from '../lib/materiais.js';
import { baixarExcel, dataHora } from '../lib/excel.js';

const STATUS = {
  ABERTO: { rotulo: 'Em contagem', classe: 'blue' },
  CONCLUIDO: { rotulo: 'Concluído', classe: 'ok' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'gray' },
};

export async function montar(el, ctx) {
  const meuNivel = nivel(ctx.perfil.perfil);
  const pode = meuNivel >= 3;
  const gestor = meuNivel >= 4;
  let inventarios = [];
  let itensPor = new Map();
  let materiais = new Map();
  let depositos = [];

  async function carregar() {
    const [inv, itens, mats, deps] = await Promise.all([
      buscarTodos(() => supabase.from('inventarios').select('*').order('criado_em', { ascending: false })),
      buscarTodos(() => supabase.from('inventario_itens').select('*').order('id')),
      buscarTodos(() => supabase.from('materiais').select('id,codigo,nome,prn,unidade_medida,deposito_id,prateleira,lado,andar,posicao,saldo').order('id')),
      supabase.from('depositos').select('*').order('numero'),
    ]);
    if (deps.error) throw deps.error;
    depositos = deps.data;
    const porDep = new Map(depositos.map(d => [d.id, d]));
    materiais = new Map(mats.map(m => [m.id, { ...m, local: codigoLocalizacao(porDep.get(m.deposito_id)?.numero, m.prateleira, m.lado, m.andar, m.posicao) }]));
    inventarios = inv;
    itensPor = new Map();
    itens.forEach(i => { if (!itensPor.has(i.inventario_id)) itensPor.set(i.inventario_id, []); itensPor.get(i.inventario_id).push(i); });
  }

  const itensDe = inv => [...(itensPor.get(inv.id) || [])].sort((a, b) => (materiais.get(a.material_id)?.local || '').localeCompare(materiais.get(b.material_id)?.local || ''));
  const divergentes = inv => itensDe(inv).filter(i => i.quantidade_contada !== null && Number(i.quantidade_contada) !== Number(i.saldo_sistema));
  const deposito = inv => depositos.find(d => d.id === inv.deposito_id);

  function linhas() {
    if (!inventarios.length) return '<tr><td colspan="6" class="empty">Nenhum inventário ainda.</td></tr>';
    return inventarios.map(inv => {
      const itens = itensDe(inv);
      const contados = itens.filter(i => i.quantidade_contada !== null).length;
      return `<tr>
        <td><button type="button" class="link-material" data-abrir="${inv.id}"><span><b>${esc(inv.numero)}</b><span class="small muted">${fmtDataHora(inv.criado_em)}</span></span></button></td>
        <td>${esc(nomeDeposito(deposito(inv)))}</td>
        <td>${contados} de ${itens.length}</td>
        <td>${divergentes(inv).length ? `<span class="negativo">${divergentes(inv).length}</span>` : '0'}</td>
        <td><span class="pill ${STATUS[inv.status].classe}">${STATUS[inv.status].rotulo}</span>${inv.status === 'CONCLUIDO' ? `<div class="small muted">${inv.ajustes_aplicados} ajuste(s)</div>` : ''}</td>
        <td><button class="btn btn-light btn-sm" type="button" data-abrir="${inv.id}">${inv.status === 'ABERTO' && pode ? 'Contar' : 'Abrir'}</button></td>
      </tr>`;
    }).join('');
  }

  function desenhar() {
    el.innerHTML = `
      ${cabecalho('Inventário', 'Conferência periódica do POP: contar o físico, comparar com o sistema, registrar as divergências e corrigir com autorização do gestor.',
        pode ? '<button class="btn btn-primary" type="button" data-acao="novo">Novo inventário</button>' : '')}
      <section class="card card-pad">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Inventário</th><th>Depósito</th><th>Contados</th><th>Divergências</th><th>Situação</th><th></th></tr></thead>
          <tbody id="corpoInv">${linhas()}</tbody>
        </table></div>
      </section>`;
  }

  function abrirNovo() {
    const ativos = depositos.filter(d => !d.removido_em);
    if (!ativos.length) return toast('Cadastre um depósito antes.', 'erro');
    const fundo = abrirModal({
      titulo: 'Novo inventário',
      subtitulo: 'O sistema lista todos os materiais do depósito, na ordem do endereço, e guarda o saldo atual para comparar.',
      pequeno: true,
      corpo: `<form id="formInv" novalidate>
        <div class="field"><label for="iDep">Depósito *</label><select id="iDep">${ativos.map(d => `<option value="${d.id}">${esc(nomeDeposito(d))}</option>`).join('')}</select></div>
        <div class="field" style="margin-top:12px"><label for="iObs">Observação</label><input id="iObs" maxlength="200" placeholder="Ex.: inventário mensal de novembro"></div>
        <p class="form-erro" id="iErro" role="alert" hidden></p></form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button><button class="btn btn-primary" type="submit" form="formInv">Abrir inventário</button>`,
    });
    $('#formInv', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      await executando(e.submitter, async () => {
        const { data, error } = await supabase.rpc('criar_inventario', { p_deposito: Number($('#iDep', fundo).value), p_observacao: $('#iObs', fundo).value });
        if (error) { const x = $('#iErro', fundo); x.textContent = erroAmigavel(error); x.hidden = false; return; }
        fecharModal(true);
        await carregar();
        $('#corpoInv', el).innerHTML = linhas();
        abrirDetalhe(data.id);
      });
    });
  }

  async function exportar(inv) {
    const dep = deposito(inv);
    await baixarExcel(`Inventario ${inv.numero} - ${nomeDeposito(dep)}`, [{
      nome: 'Contagem',
      colunas: [{ titulo: 'Endereço', largura: 22 }, { titulo: 'Código', largura: 13 }, { titulo: 'Código SAP', largura: 14 }, { titulo: 'Material', largura: 40 },
        { titulo: 'Unidade', largura: 9 }, { titulo: 'Saldo no sistema', largura: 16 }, { titulo: 'Contado', largura: 10 }, { titulo: 'Diferença', largura: 11 },
        { titulo: 'Observação', largura: 30 }, { titulo: 'Contado por', largura: 22 }],
      linhas: itensDe(inv).map(i => {
        const m = materiais.get(i.material_id) || {};
        const dif = i.quantidade_contada === null ? null : Number(i.quantidade_contada) - Number(i.saldo_sistema);
        return [m.local, m.codigo, m.prn, m.nome, m.unidade_medida, Number(i.saldo_sistema), i.quantidade_contada === null ? null : Number(i.quantidade_contada), dif, i.observacao, i.contado_por_nome];
      }),
    }, {
      nome: 'Resumo',
      colunas: [{ titulo: 'Campo', largura: 24 }, { titulo: 'Valor', largura: 40 }],
      linhas: [['Inventário', inv.numero], ['Depósito', nomeDeposito(dep)], ['Situação', STATUS[inv.status].rotulo], ['Aberto por', inv.aberto_por_nome],
        ['Aberto em', dataHora(inv.criado_em)], ['Concluído por', inv.concluido_por_nome], ['Concluído em', dataHora(inv.concluido_em)],
        ['Itens divergentes', divergentes(inv).length], ['Ajustes aplicados', inv.ajustes_aplicados], ['Observação', inv.observacao]],
    }]);
  }

  function abrirDetalhe(id) {
    let inv = inventarios.find(x => x.id === id);
    if (!inv) return;
    let mostrarSistema = inv.status !== 'ABERTO';
    const fundo = abrirModal({ titulo: esc(inv.numero), subtitulo: esc(nomeDeposito(deposito(inv))), largo: true, corpo: '', rodape: '' });
    const corpo = $('.modal-body', fundo);
    const desenharDetalhe = () => {
      inv = inventarios.find(x => x.id === id);
      const editavel = pode && inv.status === 'ABERTO';
      const itens = itensDe(inv);
      corpo.innerHTML = `
        <div class="acoes-linha" style="justify-content:space-between;margin-bottom:12px">
          <span><span class="pill ${STATUS[inv.status].classe}">${STATUS[inv.status].rotulo}</span>
            <span class="small muted">Aberto por ${esc(inv.aberto_por_nome || '')} em ${fmtDataHora(inv.criado_em)}${inv.concluido_em ? ` · concluído por ${esc(inv.concluido_por_nome || '')} em ${fmtDataHora(inv.concluido_em)}` : ''}</span></span>
          ${editavel ? `<label class="inline-check"><input type="checkbox" id="mostrarSistema" ${mostrarSistema ? 'checked' : ''} data-nao-altera> Mostrar o saldo do sistema</label>` : ''}
        </div>
        ${editavel && !mostrarSistema ? '<p class="small muted">Contagem às cegas: o saldo do sistema fica escondido para a contagem não ser influenciada.</p>' : ''}
        <div class="table-wrap"><table class="table tabela-compacta tabela-conferencia">
          <thead><tr><th>Endereço</th><th>Material</th>${mostrarSistema ? '<th>Sistema</th>' : ''}<th>Contado</th>${mostrarSistema ? '<th>Diferença</th>' : ''}<th>Observação</th></tr></thead>
          <tbody>${itens.map(i => {
            const m = materiais.get(i.material_id) || {};
            const dif = i.quantidade_contada === null ? null : Number(i.quantidade_contada) - Number(i.saldo_sistema);
            return `<tr data-item="${i.id}">
              <td><span class="codigo-local">${esc(m.local || '')}</span></td>
              <td><b>${esc(m.nome || '')}</b><div class="small muted">${esc(m.codigo || '')} · ${esc(m.unidade_medida || '')}</div></td>
              ${mostrarSistema ? `<td>${fmtQtd(i.saldo_sistema)}</td>` : ''}
              <td>${editavel ? `<input class="inv-qtd" type="number" min="0" step="any" value="${i.quantidade_contada ?? ''}" aria-label="Quantidade contada">` : i.quantidade_contada === null ? '—' : fmtQtd(i.quantidade_contada)}</td>
              ${mostrarSistema ? `<td class="${dif === null ? '' : dif === 0 ? 'positivo' : 'negativo'}">${dif === null ? '—' : dif === 0 ? 'Confere' : (dif > 0 ? '+' : '') + fmtQtd(dif)}</td>` : ''}
              <td>${editavel ? `<input class="inv-obs" maxlength="160" value="${esc(i.observacao || '')}" placeholder="Ex.: caixa amassada">` : esc(i.observacao || '')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        ${inv.status === 'ABERTO' && divergentes(inv).length ? `<div class="notice">${divergentes(inv).length} item(ns) com divergência. ${gestor ? 'Ao concluir, o sistema ajusta o saldo pela diferença e registra no histórico.' : 'Um gestor precisa concluir para autorizar os ajustes.'}</div>` : ''}
        <p class="form-erro" id="invErro" role="alert" hidden></p>`;
      $('.modal-foot', fundo)?.remove();
      fundo.querySelector('.modal').insertAdjacentHTML('beforeend', `<div class="modal-foot">
        <button class="btn btn-ghost" type="button" data-fechar>Fechar</button>
        <button class="btn btn-light" type="button" data-inv="exportar">Exportar para Excel</button>
        ${editavel ? `<button class="btn btn-ghost" type="button" data-inv="cancelar">Cancelar inventário</button>
          <button class="btn btn-light" type="button" data-inv="salvar">Salvar contagem</button>
          <button class="btn btn-primary" type="button" data-inv="concluir">Concluir inventário</button>` : ''}</div>`);
      delete fundo.dataset.alterado;
    };
    desenharDetalhe();

    async function salvar() {
      const pedidos = $$('tr[data-item]', corpo).map(l => {
        const item = itensDe(inv).find(i => String(i.id) === l.dataset.item);
        const v = $('.inv-qtd', l).value;
        const dados = { quantidade_contada: v === '' ? null : Number(v), observacao: $('.inv-obs', l).value.trim() || null };
        if (dados.quantidade_contada === (item.quantidade_contada === null ? null : Number(item.quantidade_contada)) && dados.observacao === (item.observacao || null)) return null;
        return atualizarRegistro('inventario_itens', item.id, dados);
      }).filter(Boolean);
      await Promise.all(pedidos);
    }

    fundo.addEventListener('change', e => { if (e.target.id === 'mostrarSistema') { mostrarSistema = e.target.checked; salvar().then(carregar).then(desenharDetalhe); } });
    fundo.addEventListener('click', async e => {
      const botao = e.target.closest('[data-inv]');
      if (!botao) return;
      const erro = $('#invErro', corpo);
      await executando(botao, async () => {
        try {
          const acao = botao.dataset.inv;
          if (acao === 'exportar') return await exportar(inv);
          if (acao === 'salvar') { await salvar(); toast('Contagem salva.'); }
          if (acao === 'cancelar') {
            if (!window.confirm('Cancelar este inventário? A contagem não muda o estoque.')) return;
            const { error } = await supabase.rpc('cancelar_inventario', { p_inventario: inv.id });
            if (error) throw error;
          }
          if (acao === 'concluir') {
            await salvar();
            await carregar();
            const n = divergentes(inventarios.find(x => x.id === id)).length;
            if (!window.confirm(n ? `Concluir e ajustar o saldo de ${n} material(is) pela diferença da contagem?` : 'Concluir o inventário? Nenhuma divergência foi encontrada.')) return desenharDetalhe();
            const { data, error } = await supabase.rpc('concluir_inventario', { p_inventario: inv.id });
            if (error) throw error;
            toast(`Inventário concluído. ${data} ajuste(s) aplicado(s).`);
          }
          await carregar();
          $('#corpoInv', el).innerHTML = linhas();
          desenharDetalhe();
        } catch (falha) { erro.textContent = erroAmigavel(falha); erro.hidden = false; }
      });
    });
    const parar = ouvir(['inventarios', 'inventario_itens'], async () => {
      await carregar();
      $('#corpoInv', el).innerHTML = linhas();
      if (!fundo.dataset.alterado) desenharDetalhe();
    });
    aoFecharModal(fundo, parar);
  }

  await carregar();
  desenhar();
  el.addEventListener('click', e => {
    const abrir = e.target.closest('[data-abrir]');
    if (abrir) return abrirDetalhe(Number(abrir.dataset.abrir));
    if (e.target.closest('[data-acao="novo"]')) abrirNovo();
  });
  ctx.aoSair(ouvir(['inventarios', 'inventario_itens', 'materiais', 'depositos'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    $('#corpoInv', el).innerHTML = linhas();
  }));
}
