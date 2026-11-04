import { supabase } from '../lib/supabase.js';
import { $, $$, esc, cabecalho, abrirModal, aoFecharModal, fecharModal, executando, erroAmigavel, toast, fmtDataHora, fmtData } from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { buscarTodos, atualizarRegistro } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { estado } from '../lib/sessao.js';
import { codigoLocalizacao, dadosEtiqueta, fmtQtd, termoBusca, textoBusca } from '../lib/materiais.js';
import { enviarArquivo, prepararImagem, extensao, abrirArquivoPrivado } from '../lib/arquivos.js';
import { FORMATOS, abrirJanelaEtiquetas, montarEtiquetas } from '../lib/etiquetas.js';

const STATUS = {
  CONFERENCIA: { rotulo: 'Em conferência', classe: 'blue' },
  DIVERGENTE: { rotulo: 'Com divergência', classe: 'red' },
  APROVADO: { rotulo: 'Aguardando guarda', classe: 'low' },
  GUARDADO: { rotulo: 'Guardado', classe: 'ok' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'gray' },
};

const FILTROS = {
  abertos: { rotulo: 'Abertos', status: ['CONFERENCIA', 'DIVERGENTE', 'APROVADO'] },
  CONFERENCIA: { rotulo: 'Em conferência', status: ['CONFERENCIA'] },
  DIVERGENTE: { rotulo: 'Com divergência', status: ['DIVERGENTE'] },
  APROVADO: { rotulo: 'Aguardando guarda', status: ['APROVADO'] },
  GUARDADO: { rotulo: 'Guardados', status: ['GUARDADO'] },
  CANCELADO: { rotulo: 'Cancelados', status: ['CANCELADO'] },
  todos: { rotulo: 'Todos', status: null },
};

// Checklist da conferência, conforme o POP (item 04 da justificativa).
const CHECKLIST = [
  ['descricao', 'A descrição dos materiais confere com a nota'],
  ['codigo', 'O código (PRN) de cada item confere'],
  ['quantidade', 'As quantidades foram contadas'],
  ['unidade', 'A unidade de controle confere (caixa, unidade, mL...)'],
  ['condicoes', 'As condições aparentes foram verificadas'],
  ['documentacao', 'A documentação está disponível e anexada'],
  ['etiqueta', 'Etiqueta aplicada na cor da classe'],
];

const abertos = r => ['CONFERENCIA', 'DIVERGENTE'].includes(r.status);

export async function montar(el, ctx) {
  const meuNivel = nivel(ctx.perfil.perfil);
  const pode = meuNivel >= 3;
  const gestor = meuNivel >= 4;

  let recebimentos = [];
  let itensPor = new Map();
  let materiais = [];
  let unidades = [];
  const porId = { materiais: new Map(), recebimentos: new Map() };
  const filtro = { status: 'abertos', busca: '' };

  async function carregar() {
    const [r, i, m, c, d, u] = await Promise.all([
      buscarTodos(() => supabase.from('recebimentos').select('*').order('criado_em', { ascending: false })),
      buscarTodos(() => supabase.from('recebimento_itens').select('*').order('id')),
      buscarTodos(() => supabase.from('materiais').select('*').order('nome')),
      supabase.from('classes').select('id,nome,cor'),
      supabase.from('depositos').select('id,numero,nome,unidade_id'),
      supabase.from('unidades').select('id,nome,sigla,removido_em').order('nome'),
    ]);
    for (const x of [c, d, u]) if (x.error) throw x.error;
    const classes = new Map(c.data.map(x => [x.id, x]));
    const depositos = new Map(d.data.map(x => [x.id, x]));
    unidades = u.data;
    materiais = m.map(x => ({
      ...x,
      classe: classes.get(x.classe_id),
      local: codigoLocalizacao(depositos.get(x.deposito_id)?.numero, x.prateleira, x.lado, x.andar, x.posicao),
      rotulo: `${x.codigo} · ${x.nome} · PRN ${x.prn}`,
    }));
    porId.materiais = new Map(materiais.map(x => [x.id, x]));
    recebimentos = r;
    porId.recebimentos = new Map(r.map(x => [x.id, x]));
    itensPor = new Map();
    i.forEach(x => { if (!itensPor.has(x.recebimento_id)) itensPor.set(x.recebimento_id, []); itensPor.get(x.recebimento_id).push(x); });
  }

  const itensDe = r => itensPor.get(r.id) || [];
  const materiaisAtivos = () => materiais.filter(m => !m.removido_em);

  function acharMaterial(texto) {
    const t = String(texto || '').trim();
    if (!t) return null;
    const codigo = t.split(' · ')[0].trim().toUpperCase();
    const ativos = materiaisAtivos();
    return ativos.find(m => m.codigo === codigo)
      || ativos.find(m => m.prn.toLowerCase() === t.toLowerCase())
      || ativos.find(m => termoBusca(m.nome) === termoBusca(t));
  }

  // -----------------------------------------------------------------
  // Lista
  // -----------------------------------------------------------------
  function filtrados() {
    const permitidos = FILTROS[filtro.status].status;
    const palavras = termoBusca(filtro.busca).split(' ').filter(Boolean);
    return recebimentos.filter(r => {
      if (permitidos && !permitidos.includes(r.status)) return false;
      if (!palavras.length) return true;
      const texto = textoBusca(r.numero, r.nf_numero, r.fornecedor, ...itensDe(r).map(i => porId.materiais.get(i.material_id)?.nome));
      return palavras.every(p => texto.includes(p));
    });
  }

  function chips() {
    return Object.entries(FILTROS).map(([id, f]) => {
      const qtd = f.status ? recebimentos.filter(r => f.status.includes(r.status)).length : recebimentos.length;
      const alerta = id === 'DIVERGENTE' && qtd > 0;
      return `<button type="button" class="chip ${filtro.status === id ? 'ativo' : ''} ${alerta ? 'alerta' : ''}" data-filtro="${id}">${f.rotulo} <b>${qtd}</b></button>`;
    }).join('');
  }

  function linhas() {
    const lista = filtrados();
    if (!lista.length) return `<tr><td colspan="6" class="empty">${recebimentos.length ? 'Nenhum recebimento com esse filtro.' : 'Nenhum recebimento registrado ainda.'}</td></tr>`;
    return lista.map(r => {
      const itens = itensDe(r);
      return `<tr>
        <td><button type="button" class="link-material" data-abrir="${r.id}"><span><b>${esc(r.numero)}</b><span class="small muted">${fmtDataHora(r.criado_em)}</span></span></button></td>
        <td><b>NF ${esc(r.nf_numero)}${r.nf_serie ? '-' + esc(r.nf_serie) : ''}</b><div class="small muted">${esc(r.fornecedor)}</div></td>
        <td>${itens.length} item(ns)<div class="small muted">${esc(itens.slice(0, 2).map(i => porId.materiais.get(i.material_id)?.nome || '').join(', '))}${itens.length > 2 ? '...' : ''}</div></td>
        <td>${esc(r.recebido_por_nome || '')}</td>
        <td><span class="pill ${STATUS[r.status].classe}">${STATUS[r.status].rotulo}</span>${!r.nf_arquivo_path && abertos(r) ? '<div><span class="pill red pill-mini">Sem nota</span></div>' : ''}</td>
        <td><button class="btn btn-light btn-sm" type="button" data-abrir="${r.id}">${pode && abertos(r) ? 'Conferir' : 'Abrir'}</button></td>
      </tr>`;
    }).join('');
  }

  function desenhar() {
    el.innerHTML = `
      ${cabecalho('Recebimento', 'Recebimento, conferência e etiquetagem, revisão, entrada no estoque e liberação para guarda. O saldo só entra depois da conferência aprovada.',
        pode ? '<button class="btn btn-primary" type="button" data-acao="novo">Novo recebimento</button>' : '')}
      <div class="resumo-chips" id="chipsRec">${chips()}</div>
      <section class="card card-pad">
        <div class="toolbar filtros">
          <input class="search" id="fBuscaRec" type="search" placeholder="Buscar por número, nota, fornecedor ou material" value="${esc(filtro.busca)}" aria-label="Buscar recebimento" autocomplete="off">
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Recebimento</th><th>Nota fiscal</th><th>Itens</th><th>Recebido por</th><th>Situação</th><th></th></tr></thead>
          <tbody id="corpoRec">${linhas()}</tbody>
        </table></div>
      </section>`;
  }

  const atualizarLista = () => {
    $('#corpoRec', el).innerHTML = linhas();
    $('#chipsRec', el).innerHTML = chips();
  };

  // -----------------------------------------------------------------
  // Novo recebimento
  // -----------------------------------------------------------------
  const opcoesMateriais = () => materiaisAtivos().map(m => `<option value="${esc(m.rotulo)}"></option>`).join('');

  function linhaItem() {
    return `<div class="linha-item">
      <input class="item-material" list="listaMateriaisRec" placeholder="Busque por nome, PRN ou código" aria-label="Material" autocomplete="off">
      <input class="item-qtd" type="number" min="0" step="any" placeholder="Qtd. na nota" aria-label="Quantidade na nota">
      <span class="item-un muted small"></span>
      <button class="btn btn-ghost btn-sm" type="button" data-tirar-linha aria-label="Tirar item">×</button>
    </div>`;
  }

  function abrirNovo() {
    const ativas = unidades.filter(u => !u.removido_em);
    if (!ativas.length) return toast('Cadastre uma unidade antes, em Unidades e setores.', 'erro');
    const unidadeInicial = estado.perfil?.unidade_id || ativas[0].id;
    const fundo = abrirModal({
      titulo: 'Novo recebimento',
      subtitulo: 'Registre a nota fiscal e os itens que chegaram. A conferência vem em seguida.',
      largo: true,
      corpo: `<form id="formRec" novalidate>
        <div class="form-section primeira"><h3>Nota fiscal</h3>
          <div class="fields campos-3">
            <div class="field"><label for="rUnidade">Unidade *</label><select id="rUnidade">${ativas.map(u => `<option value="${u.id}" ${u.id === unidadeInicial ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></div>
            <div class="field"><label for="rFornecedor">Fornecedor *</label><input id="rFornecedor" maxlength="120" autocomplete="off"></div>
            <div class="field"><label for="rData">Data de emissão</label><input id="rData" type="date"></div>
            <div class="field"><label for="rNf">Número da nota *</label><input id="rNf" maxlength="20" inputmode="numeric" autocomplete="off"></div>
            <div class="field"><label for="rSerie">Série</label><input id="rSerie" maxlength="5" autocomplete="off"></div>
            <div class="field"><label for="rArquivo">Arquivo da nota *</label><input id="rArquivo" type="file" accept="application/pdf,image/*,.xml"></div>
          </div>
          <div id="rArquivoInfo"></div>
        </div>
        <div class="form-section"><h3>Itens da nota</h3>
          <datalist id="listaMateriaisRec">${opcoesMateriais()}</datalist>
          <div id="rItens">${linhaItem()}</div>
          <button class="btn btn-light btn-sm" type="button" data-add-linha>Adicionar item</button>
          <p class="small muted" style="margin-top:8px">Material novo? Cadastre em Materiais. Ele aparece nesta lista na hora, sem fechar esta janela.</p>
        </div>
        <div class="form-section"><h3>Observação</h3>
          <textarea id="rObs" rows="2" maxlength="300" placeholder="Ex.: entrega com 2 volumes, recebida na doca 1"></textarea>
        </div>
        <p class="form-erro" id="rErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formRec">Registrar e conferir</button>`,
    });

    const atualizarLinha = linha => {
      const m = acharMaterial($('.item-material', linha).value);
      $('.item-un', linha).textContent = m ? m.unidade_medida : '';
      $('.item-material', linha).classList.toggle('invalido', Boolean($('.item-material', linha).value.trim()) && !m);
    };
    fundo.addEventListener('input', e => {
      if (e.target.classList.contains('item-material')) atualizarLinha(e.target.closest('.linha-item'));
    });
    fundo.addEventListener('change', e => {
      if (e.target.id !== 'rArquivo') return;
      const arquivo = e.target.files[0];
      $('#rArquivoInfo', fundo).innerHTML = arquivo
        ? `<div class="notice notice-ok">Nota pronta para envio: <b>${esc(arquivo.name)}</b> (${Math.ceil(arquivo.size / 1024)} KB). Nesta versão a validação é simulada: o sistema guarda o arquivo e confirma o recebimento, sem consultar a Receita.</div>`
        : '';
    });
    fundo.addEventListener('click', e => {
      if (e.target.closest('[data-add-linha]')) {
        $('#rItens', fundo).insertAdjacentHTML('beforeend', linhaItem());
        $$('.item-material', fundo).at(-1).focus();
      }
      const tirar = e.target.closest('[data-tirar-linha]');
      if (tirar && $$('.linha-item', fundo).length > 1) tirar.closest('.linha-item').remove();
    });

    const parar = ouvir(['materiais', 'classes'], async () => {
      await carregar();
      $('#listaMateriaisRec', fundo).innerHTML = opcoesMateriais();
      $$('.linha-item', fundo).forEach(atualizarLinha);
    });
    aoFecharModal(fundo, parar);

    $('#formRec', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#rErro', fundo);
      const falhar = m => { erro.textContent = m; erro.hidden = false; erro.scrollIntoView({ block: 'nearest' }); };
      const dados = {
        unidade_id: Number($('#rUnidade', fundo).value),
        fornecedor: $('#rFornecedor', fundo).value.trim(),
        nf_numero: $('#rNf', fundo).value.trim(),
        nf_serie: $('#rSerie', fundo).value.trim() || null,
        nf_data: $('#rData', fundo).value || null,
        observacao: $('#rObs', fundo).value.trim() || null,
      };
      const arquivo = $('#rArquivo', fundo).files[0];
      if (dados.fornecedor.length < 2) return falhar('Informe o fornecedor.');
      if (!dados.nf_numero) return falhar('Informe o número da nota fiscal.');
      if (!arquivo) return falhar('Anexe o arquivo da nota fiscal (PDF, foto ou XML).');
      const itens = [];
      for (const linha of $$('.linha-item', fundo)) {
        const texto = $('.item-material', linha).value.trim();
        const qtd = Number($('.item-qtd', linha).value);
        if (!texto && !$('.item-qtd', linha).value) continue;
        const m = acharMaterial(texto);
        if (!m) return falhar(`Material não encontrado: "${texto}". Escolha um da lista.`);
        if (!(qtd > 0)) return falhar(`Informe a quantidade na nota de ${m.nome}.`);
        if (itens.some(i => i.material_id === m.id)) return falhar(`${m.nome} aparece duas vezes. Some as quantidades em uma linha só.`);
        itens.push({ material_id: m.id, quantidade_nf: qtd });
      }
      if (!itens.length) return falhar('Inclua pelo menos um item da nota.');
      erro.hidden = true;

      await executando(e.submitter, async () => {
        let rec;
        try {
          const { data, error } = await supabase.from('recebimentos').insert(dados).select('id,numero').single();
          if (error) throw error;
          rec = data;
        } catch (falha) {
          return falhar(/recebimentos_nf_unica/.test(falha.message) ? 'Esta nota fiscal já foi registrada para este fornecedor.' : erroAmigavel(falha));
        }
        const avisos = [];
        try {
          const caminho = await enviarArquivo(`${rec.id}/nota-${Date.now()}.${extensao(arquivo)}`, arquivo, 'recebimentos');
          await atualizarRegistro('recebimentos', rec.id, { nf_arquivo_path: caminho, nf_arquivo_nome: arquivo.name });
        } catch (falha) {
          avisos.push(`a nota não foi enviada (${erroAmigavel(falha)}). Anexe de novo na conferência`);
        }
        const { error: erroItens } = await supabase.from('recebimento_itens').insert(itens.map(i => ({ ...i, recebimento_id: rec.id })));
        if (erroItens) avisos.push(`os itens não foram salvos (${erroAmigavel(erroItens)})`);
        fecharModal(true);
        await carregar();
        atualizarLista();
        if (avisos.length) toast(`Recebimento ${rec.numero} criado, mas ${avisos.join(' e ')}.`, 'erro');
        else toast(`Recebimento ${rec.numero} registrado. Nota anexada e validada (simulação).`);
        abrirDetalhe(rec.id);
      });
    });
  }

  // -----------------------------------------------------------------
  // Conferência
  // -----------------------------------------------------------------
  function etapas(r) {
    const ordem = ['RECEBIDO', 'CONFERENCIA', 'APROVADO', 'GUARDADO'];
    const atual = r.status === 'CANCELADO' ? -1 : r.status === 'GUARDADO' ? 3 : r.status === 'APROVADO' ? 2 : 1;
    const rotulos = ['Recebido', 'Conferência e etiquetagem', 'Entrada no estoque', 'Guardado no endereço'];
    return `<ol class="etapas">${ordem.map((_, i) => `<li class="${i < atual ? 'feita' : i === atual ? 'atual' : ''} ${r.status === 'DIVERGENTE' && i === 1 ? 'problema' : ''}">${rotulos[i]}</li>`).join('')}</ol>`;
  }

  function linhaTempo(r) {
    const eventos = [[r.criado_em, `Recebido por ${r.recebido_por_nome || 'alguém'}`]];
    if (r.status === 'DIVERGENTE' || (r.divergencia && r.conferido_em)) eventos.push([r.conferido_em, `Divergência registrada por ${r.conferido_por_nome || ''}`]);
    else if (r.conferido_em) eventos.push([r.conferido_em, `Conferido por ${r.conferido_por_nome || ''}`]);
    if (r.aprovado_em) eventos.push([r.aprovado_em, `Aprovado e com entrada no estoque por ${r.aprovado_por_nome || ''}`]);
    if (r.guardado_em) eventos.push([r.guardado_em, `Guardado por ${r.guardado_por_nome || ''}`]);
    if (r.status === 'CANCELADO') eventos.push([r.atualizado_em, `Cancelado: ${r.cancelado_motivo || ''}`]);
    return `<ul class="linha-tempo">${eventos.map(([quando, texto]) => `<li><b>${esc(texto)}</b> <span class="muted small">${fmtDataHora(quando)}</span></li>`).join('')}</ul>`;
  }

  function conteudoDetalhe(r) {
    const editavel = pode && abertos(r);
    const itens = itensDe(r);
    const checklist = r.checklist || {};
    const diferencas = itens.filter(i => i.quantidade_conferida !== null && Number(i.quantidade_conferida) !== Number(i.quantidade_nf));
    return `
      <div class="aviso-concorrencia" id="recAvisoOutro" hidden>Outra pessoa alterou este recebimento. <button class="btn btn-light btn-sm" type="button" data-rec="recarregar">Recarregar</button></div>
      ${etapas(r)}
      <div class="rec-cabecalho">
        <dl class="ficha">
          <div><dt>Fornecedor</dt><dd>${esc(r.fornecedor)}</dd></div>
          <div><dt>Nota fiscal</dt><dd>${esc(r.nf_numero)}${r.nf_serie ? ' · série ' + esc(r.nf_serie) : ''}${r.nf_data ? ` · emitida em ${fmtData(r.nf_data + 'T12:00:00')}` : ''}</dd></div>
          <div><dt>Unidade</dt><dd>${esc(unidades.find(u => u.id === r.unidade_id)?.nome || '')}</dd></div>
          <div><dt>Recebido por</dt><dd>${esc(r.recebido_por_nome || '')} · ${fmtDataHora(r.criado_em)}</dd></div>
        </dl>
        <div class="nf-caixa ${r.nf_arquivo_path ? 'ok' : 'falta'}">
          ${r.nf_arquivo_path
            ? `<b>Nota fiscal anexada</b><span class="small">${esc(r.nf_arquivo_nome || 'arquivo')}</span><span class="small muted">Validação simulada nesta versão.</span>
               <div class="acoes-linha"><button class="btn btn-light btn-sm" type="button" data-rec="abrir-nf">Abrir nota</button>
               ${editavel ? '<label class="btn btn-ghost btn-sm arquivo-botao">Trocar arquivo<input type="file" id="recNfArquivo" accept="application/pdf,image/*,.xml" hidden></label>' : ''}</div>`
            : `<b>Falta anexar a nota</b><span class="small">Sem a nota, o recebimento não pode ser aprovado.</span>
               ${editavel ? '<label class="btn btn-primary btn-sm arquivo-botao">Anexar nota<input type="file" id="recNfArquivo" accept="application/pdf,image/*,.xml" hidden></label>' : ''}`}
        </div>
      </div>
      ${r.observacao ? `<p class="small"><b>Observação:</b> ${esc(r.observacao)}</p>` : ''}
      ${r.status === 'DIVERGENTE' ? `<div class="notice notice-erro"><b>Divergência registrada.</b> ${esc(r.divergencia || '')}
        ${r.evidencias?.length ? `<div class="acoes-linha" style="margin-top:8px">${r.evidencias.map((p, i) => `<button class="btn btn-light btn-sm" type="button" data-evidencia="${esc(p)}">Evidência ${i + 1}</button>`).join('')}</div>` : ''}
        <div style="margin-top:6px">${gestor ? 'Como gestor, você pode aprovar com as quantidades conferidas ou cancelar o recebimento.' : 'O material fica na área de devolução até um gestor aprovar com as quantidades conferidas ou cancelar.'}</div></div>` : ''}
      ${r.status === 'APROVADO' ? '<div class="notice">Entrada feita no estoque. Leve os materiais aos endereços indicados abaixo e marque como guardado.</div>' : ''}
      ${r.status === 'CANCELADO' ? `<div class="notice">Recebimento cancelado. Motivo: ${esc(r.cancelado_motivo || '')}</div>` : ''}

      <h3 class="detalhe-titulo">Itens</h3>
      <div class="table-wrap"><table class="table tabela-compacta tabela-conferencia">
        <thead><tr><th>Material</th><th>Endereço</th><th>Na nota</th><th>Conferida em boas condições</th><th>Diferença</th><th>Observação</th>${editavel ? '<th></th>' : ''}</tr></thead>
        <tbody>${itens.map(i => {
          const m = porId.materiais.get(i.material_id);
          const conferida = i.quantidade_conferida;
          const dif = conferida === null || conferida === undefined ? null : Number(conferida) - Number(i.quantidade_nf);
          return `<tr data-item="${i.id}">
            <td><span class="link-material"><span class="barra-classe" style="background:${esc(m?.classe?.cor || '#ccc')}"></span><span><b>${esc(m?.nome || 'Material removido')}</b><span class="small muted">${esc(m?.codigo || '')} · PRN ${esc(m?.prn || '')}</span></span></span></td>
            <td><span class="codigo-local">${esc(m?.local || '')}</span></td>
            <td class="nowrap">${fmtQtd(i.quantidade_nf)} ${esc(m?.unidade_medida || '')}</td>
            <td>${editavel ? `<input class="conf-qtd" type="number" min="0" step="any" value="${conferida ?? ''}" aria-label="Quantidade conferida de ${esc(m?.nome || '')}">` : conferida === null ? '<span class="muted">Não conferida</span>' : `${fmtQtd(conferida)} ${esc(m?.unidade_medida || '')}`}</td>
            <td class="nowrap conf-dif ${dif === null ? '' : dif === 0 ? 'positivo' : 'negativo'}">${dif === null ? '—' : dif === 0 ? 'Confere' : `${dif > 0 ? '+' : ''}${fmtQtd(dif)}`}</td>
            <td>${editavel ? `<input class="conf-obs" maxlength="160" value="${esc(i.observacao || '')}" placeholder="Ex.: 2 caixas amassadas" aria-label="Observação">` : esc(i.observacao || '')}</td>
            ${editavel ? `<td><button class="btn btn-ghost btn-sm" type="button" data-tirar-item="${i.id}" aria-label="Tirar item">×</button></td>` : ''}
          </tr>`;
        }).join('') || '<tr><td colspan="7" class="empty">Nenhum item.</td></tr>'}</tbody>
      </table></div>
      ${editavel ? `<div class="linha-item adicionar">
        <datalist id="listaMateriaisDet">${opcoesMateriais()}</datalist>
        <input id="addMaterial" list="listaMateriaisDet" placeholder="Incluir outro item da nota" autocomplete="off" aria-label="Material">
        <input id="addQtd" type="number" min="0" step="any" placeholder="Qtd. na nota" aria-label="Quantidade na nota">
        <button class="btn btn-light btn-sm" type="button" data-rec="add-item">Incluir</button>
      </div>` : ''}

      <div class="rec-colunas">
        <div>
          <h3 class="detalhe-titulo">Checklist da conferência</h3>
          <ul class="checklist">${CHECKLIST.map(([chave, texto]) => `<li><label class="inline-check">
            <input type="checkbox" data-check="${chave}" ${checklist[chave] ? 'checked' : ''} ${editavel ? '' : 'disabled'}> ${texto}</label></li>`).join('')}</ul>
        </div>
        <div>
          <h3 class="detalhe-titulo">Etiquetas dos itens</h3>
          <p class="small muted">Pelo POP, a etiqueta é aplicada durante a conferência, na cor da classe.</p>
          ${pode && r.status !== 'CANCELADO' && itens.length ? `<div class="acoes-linha" style="margin-top:8px">
            <select id="recFormato" aria-label="Formato da etiqueta">${Object.entries(FORMATOS).map(([v, f]) => `<option value="${v}">${f.rotulo}</option>`).join('')}</select>
            <button class="btn btn-light" type="button" data-rec="etiquetas">Imprimir etiquetas</button></div>` : ''}
          <h3 class="detalhe-titulo">Andamento</h3>
          ${linhaTempo(r)}
        </div>
      </div>

      ${editavel ? `
      <div class="painel-acao" id="painelDivergencia" hidden>
        <h3>Registrar divergência</h3>
        <p class="small muted">O que veio diferente da nota: falta, sobra, item errado, avaria. O recebimento fica com divergência até um gestor aprovar ou cancelar.</p>
        <textarea id="divTexto" rows="3" maxlength="500" placeholder="Ex.: vieram 8 galões, a nota diz 10. Duas caixas com a embalagem rasgada." data-nao-altera></textarea>
        <label class="small" style="display:block;margin-top:8px">Fotos do material e da etiqueta (opcional)<input id="divFotos" type="file" accept="image/*" capture="environment" multiple data-nao-altera></label>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn btn-danger" type="button" data-rec="confirmar-divergencia">Registrar divergência</button>
        <button class="btn btn-ghost" type="button" data-rec="fechar-paineis">Voltar</button></div>
      </div>
      <div class="painel-acao" id="painelCancelar" hidden>
        <h3>Cancelar recebimento</h3>
        <textarea id="cancTexto" rows="2" maxlength="300" placeholder="Ex.: nota emitida com erro, o fornecedor vai reenviar" data-nao-altera></textarea>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn btn-danger" type="button" data-rec="confirmar-cancelar">Cancelar recebimento</button>
        <button class="btn btn-ghost" type="button" data-rec="fechar-paineis">Voltar</button></div>
      </div>` : ''}
      ${editavel && diferencas.length && r.status !== 'DIVERGENTE' ? `<div class="notice">A quantidade conferida de ${diferencas.length} item(ns) não bate com a nota. ${gestor ? 'Você pode aprovar assim mesmo, como gestor, ou registrar a divergência.' : 'Registre a divergência para um gestor aprovar.'}</div>` : ''}
      <p class="form-erro" id="recErro" role="alert" hidden></p>`;
  }

  function rodapeDetalhe(r) {
    const botoes = ['<button class="btn btn-ghost" type="button" data-fechar>Fechar</button>'];
    if (pode && abertos(r)) {
      botoes.push('<button class="btn btn-ghost" type="button" data-rec="cancelar">Cancelar recebimento</button>');
      botoes.push('<button class="btn btn-light" type="button" data-rec="divergencia">Registrar divergência</button>');
      botoes.push('<button class="btn btn-light" type="button" data-rec="salvar">Salvar conferência</button>');
      botoes.push(`<button class="btn btn-primary" type="button" data-rec="aprovar">${r.status === 'DIVERGENTE' ? 'Aprovar com o conferido' : 'Aprovar e dar entrada'}</button>`);
    }
    if (pode && r.status === 'APROVADO') botoes.push('<button class="btn btn-primary" type="button" data-rec="guardado">Marcar como guardado</button>');
    return botoes.join('');
  }

  function abrirDetalhe(id) {
    let r = porId.recebimentos.get(id);
    if (!r) return toast('Recebimento não encontrado.', 'erro');
    history.replaceState(null, '', `#/recebimentos/${r.numero}`);
    let editado = false;
    const fundo = abrirModal({
      titulo: `${esc(r.numero)} · NF ${esc(r.nf_numero)}`,
      subtitulo: `<span class="pill ${STATUS[r.status].classe}">${STATUS[r.status].rotulo}</span>`,
      largo: true,
      corpo: conteudoDetalhe(r),
      rodape: rodapeDetalhe(r),
      aoFechar: () => { if (/^#\/recebimentos\//.test(location.hash)) history.replaceState(null, '', '#/recebimentos'); },
    });
    const corpo = $('.modal-body', fundo);
    const erro = () => $('#recErro', fundo);
    const falhar = m => { const e = erro(); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); };

    const redesenhar = () => {
      r = porId.recebimentos.get(id);
      if (!r || !document.body.contains(fundo)) return;
      const rolagem = corpo.scrollTop;
      corpo.innerHTML = conteudoDetalhe(r);
      $('.modal-foot', fundo).innerHTML = rodapeDetalhe(r);
      $('.modal-head p', fundo).innerHTML = `<span class="pill ${STATUS[r.status].classe}">${STATUS[r.status].rotulo}</span>`;
      corpo.scrollTop = rolagem;
      editado = false;
      delete fundo.dataset.alterado;
    };
    const recarregarTudo = async () => { await carregar(); atualizarLista(); redesenhar(); };

    // Diferença aparece enquanto digita.
    corpo.addEventListener('input', e => {
      if (!e.target.matches('.conf-qtd, .conf-obs, [data-check]')) return;
      editado = true;
      if (e.target.matches('.conf-qtd')) {
        const linha = e.target.closest('tr');
        const item = itensDe(r).find(i => String(i.id) === linha.dataset.item);
        const celula = $('.conf-dif', linha);
        if (e.target.value === '') { celula.textContent = '—'; celula.className = 'nowrap conf-dif'; return; }
        const dif = Number(e.target.value) - Number(item.quantidade_nf);
        celula.textContent = dif === 0 ? 'Confere' : `${dif > 0 ? '+' : ''}${fmtQtd(dif)}`;
        celula.className = `nowrap conf-dif ${dif === 0 ? 'positivo' : 'negativo'}`;
      }
    });
    corpo.addEventListener('change', async e => {
      if (e.target.matches('[data-check]')) editado = true;
      if (e.target.id === 'recNfArquivo' && e.target.files[0]) {
        const arquivo = e.target.files[0];
        try {
          const caminho = await enviarArquivo(`${r.id}/nota-${Date.now()}.${extensao(arquivo)}`, arquivo, 'recebimentos');
          await atualizarRegistro('recebimentos', r.id, { nf_arquivo_path: caminho, nf_arquivo_nome: arquivo.name });
          toast('Nota anexada e validada (simulação).');
          await recarregarTudo();
        } catch (falha) { falhar(erroAmigavel(falha)); }
      }
    });

    // Grava as quantidades, observações e o checklist.
    async function salvarConferencia() {
      const itens = itensDe(r);
      const pedidos = $$('tr[data-item]', corpo).map(linha => {
        const item = itens.find(i => String(i.id) === linha.dataset.item);
        const valor = $('.conf-qtd', linha).value;
        const dados = { quantidade_conferida: valor === '' ? null : Number(valor), observacao: $('.conf-obs', linha).value.trim() || null };
        if (dados.quantidade_conferida !== null && (Number.isNaN(dados.quantidade_conferida) || dados.quantidade_conferida < 0)) throw new Error('A quantidade conferida não pode ser negativa.');
        if (dados.quantidade_conferida === item.quantidade_conferida && (dados.observacao || null) === (item.observacao || null)) return null;
        return atualizarRegistro('recebimento_itens', item.id, dados);
      }).filter(Boolean);
      const checklist = Object.fromEntries($$('[data-check]', corpo).map(c => [c.dataset.check, c.checked]));
      if (JSON.stringify(checklist) !== JSON.stringify({ ...Object.fromEntries(CHECKLIST.map(([k]) => [k, false])), ...r.checklist })) {
        pedidos.push(atualizarRegistro('recebimentos', r.id, { checklist }));
      }
      await Promise.all(pedidos);
    }

    async function imprimirEtiquetas() {
      const formato = $('#recFormato', corpo).value;
      const lista = itensDe(r).map(i => porId.materiais.get(i.material_id)).filter(m => m && !m.removido_em);
      let janela;
      try { janela = abrirJanelaEtiquetas(); } catch (falha) { return falhar(falha.message); }
      await montarEtiquetas(janela, lista, formato, {
        impressoPor: estado.perfil?.nome,
        aoImprimir: async () => {
          await supabase.rpc('registrar_etiquetas', { p_itens: lista.map(m => ({ material_id: m.id, dados: dadosEtiqueta(m) })) });
          const caixa = $('[data-check="etiqueta"]', corpo);
          if (caixa && !caixa.checked && abertos(r)) {
            caixa.checked = true;
            editado = true;
            toast('Etiquetas impressas. O item "Etiqueta aplicada" do checklist foi marcado; salve a conferência.');
          } else toast('Etiquetas impressas.');
        },
      });
    }

    fundo.addEventListener('click', async e => {
      const evidencia = e.target.closest('[data-evidencia]');
      if (evidencia) return abrirArquivoPrivado(evidencia.dataset.evidencia).catch(f => falhar(f.message));
      const tirar = e.target.closest('[data-tirar-item]');
      if (tirar) {
        if (!window.confirm('Tirar este item do recebimento?')) return;
        const { error } = await supabase.from('recebimento_itens').delete().eq('id', Number(tirar.dataset.tirarItem));
        if (error) return falhar(erroAmigavel(error));
        return recarregarTudo();
      }
      const acao = e.target.closest('[data-rec]')?.dataset.rec;
      if (!acao) return;
      const botao = e.target.closest('[data-rec]');
      erro().hidden = true;
      if (acao === 'recarregar') return recarregarTudo();
      if (acao === 'abrir-nf') return abrirArquivoPrivado(r.nf_arquivo_path).catch(f => falhar(f.message));
      if (acao === 'etiquetas') return imprimirEtiquetas();
      if (acao === 'divergencia' || acao === 'cancelar') {
        $('#painelDivergencia', corpo).hidden = acao !== 'divergencia';
        $('#painelCancelar', corpo).hidden = acao !== 'cancelar';
        const painel = $(acao === 'divergencia' ? '#painelDivergencia' : '#painelCancelar', corpo);
        painel.scrollIntoView({ block: 'center' });
        return $('textarea', painel).focus();
      }
      if (acao === 'fechar-paineis') { $('#painelDivergencia', corpo).hidden = true; $('#painelCancelar', corpo).hidden = true; return; }
      if (acao === 'add-item') {
        const m = acharMaterial($('#addMaterial', corpo).value);
        const qtd = Number($('#addQtd', corpo).value);
        if (!m) return falhar('Escolha o material na lista.');
        if (!(qtd > 0)) return falhar('Informe a quantidade na nota.');
        if (editado) await salvarConferencia().catch(() => {});
        const { error } = await supabase.from('recebimento_itens').insert({ recebimento_id: r.id, material_id: m.id, quantidade_nf: qtd });
        if (error) return falhar(/material_unico/.test(error.message) ? 'Este material já está no recebimento.' : erroAmigavel(error));
        return recarregarTudo();
      }
      await executando(botao, async () => {
        try {
          if (acao === 'salvar') {
            await salvarConferencia();
            toast('Conferência salva.');
            await recarregarTudo();
          }
          if (acao === 'aprovar') {
            await salvarConferencia();
            await carregar();
            r = porId.recebimentos.get(id);
            const diferenca = itensDe(r).some(i => i.quantidade_conferida !== null && Number(i.quantidade_conferida) !== Number(i.quantidade_nf));
            if ((diferenca || r.status === 'DIVERGENTE') && gestor
              && !window.confirm('A conferência não bate com a nota. Aprovar com as quantidades conferidas? A entrada no estoque será a quantidade conferida.')) {
              return redesenhar();
            }
            const { data, error } = await supabase.rpc('aprovar_recebimento', { p_recebimento: r.id });
            if (error) throw error;
            toast(`Recebimento aprovado. ${data} entrada(s) no estoque.`);
            await recarregarTudo();
          }
          if (acao === 'confirmar-divergencia') {
            const texto = $('#divTexto', corpo).value.trim();
            if (texto.length < 10) return falhar('Descreva a divergência com um pouco mais de detalhe.');
            await salvarConferencia();
            const caminhos = [];
            for (const [n, foto] of [...$('#divFotos', corpo).files].entries()) {
              caminhos.push(await enviarArquivo(`${r.id}/divergencia-${Date.now()}-${n}.jpg`, await prepararImagem(foto), 'recebimentos'));
            }
            const { error } = await supabase.rpc('registrar_divergencia', { p_recebimento: r.id, p_descricao: texto, p_evidencias: caminhos });
            if (error) throw error;
            toast('Divergência registrada.');
            await recarregarTudo();
          }
          if (acao === 'confirmar-cancelar') {
            const { error } = await supabase.rpc('cancelar_recebimento', { p_recebimento: r.id, p_motivo: $('#cancTexto', corpo).value.trim() });
            if (error) throw error;
            toast('Recebimento cancelado.');
            await recarregarTudo();
          }
          if (acao === 'guardado') {
            const { error } = await supabase.rpc('marcar_guardado', { p_recebimento: r.id });
            if (error) throw error;
            toast('Materiais marcados como guardados.');
            await recarregarTudo();
          }
        } catch (falha) {
          falhar(erroAmigavel(falha));
        }
      });
    });

    // Tempo real: se outra pessoa mexer, atualiza (ou avisa, se houver algo digitado).
    const parar = ouvir(['recebimentos', 'recebimento_itens', 'materiais'], async (_t, mudancas) => {
      const meuId = estado.perfil?.id;
      const deste = mudancas.some(x => (x.novo?.id === id || x.novo?.recebimento_id === id || x.antigo?.recebimento_id === id) && x.novo?.atualizado_por !== meuId);
      await carregar();
      atualizarLista();
      if (!deste) return;
      if (editado) $('#recAvisoOutro', corpo).hidden = false;
      else redesenhar();
    });
    aoFecharModal(fundo, parar);
  }

  // -----------------------------------------------------------------
  await carregar();
  desenhar();

  el.addEventListener('input', e => {
    if (e.target.id === 'fBuscaRec') { filtro.busca = e.target.value; atualizarLista(); }
  });
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filtro]');
    if (chip) { filtro.status = chip.dataset.filtro; return atualizarLista(); }
    const abrir = e.target.closest('[data-abrir]');
    if (abrir) return abrirDetalhe(Number(abrir.dataset.abrir));
    if (e.target.closest('[data-acao="novo"]')) abrirNovo();
  });

  ctx.aoSair(ouvir(['recebimentos', 'recebimento_itens', 'materiais', 'unidades'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    atualizarLista();
  }));

  if (ctx.parametro) {
    const alvo = recebimentos.find(x => x.numero === decodeURIComponent(ctx.parametro).toUpperCase());
    if (alvo) abrirDetalhe(alvo.id);
  }
}
