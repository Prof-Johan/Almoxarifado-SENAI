import { supabase } from '../lib/supabase.js';
import { $, $$, esc, cabecalho, abrirModal, aoFecharModal, fecharModal, mostrarConcluido, executando, erroAmigavel, toast, fmtDataHora, fmtData } from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { estado } from '../lib/sessao.js';
import { codigoLocalizacao, fmtQtd, termoBusca, textoBusca } from '../lib/materiais.js';
import { enviarArquivo, prepararImagem, extensao, abrirArquivoPrivado } from '../lib/arquivos.js';
import { FORMATOS_COMPROVANTE, abrirJanelaComprovante, montarComprovante } from '../lib/comprovante.js';

export const STATUS_PEDIDO = {
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', classe: 'low' },
  PENDENTE: { rotulo: 'A separar', classe: 'blue' },
  SEPARADO: { rotulo: 'Pronto para retirada', classe: 'ok' },
  RETIRADO: { rotulo: 'Retirado', classe: 'gray' },
  EXPIRADO: { rotulo: 'Prazo vencido', classe: 'red' },
  CANCELADO: { rotulo: 'Cancelado', classe: 'gray' },
  RECUSADO: { rotulo: 'Recusado', classe: 'red' },
};

const CATEGORIAS = {
  COMUM: 'Uso comum',
  PERDIDO: 'Reposição de item perdido',
  SEM_CONDICOES: 'Reposição de item sem condições de uso',
};

const FILTROS = {
  abertos: { rotulo: 'Abertos', status: ['AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO'] },
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', status: ['AGUARDANDO_APROVACAO'] },
  PENDENTE: { rotulo: 'A separar', status: ['PENDENTE'] },
  SEPARADO: { rotulo: 'Prontos para retirada', status: ['SEPARADO'] },
  RETIRADO: { rotulo: 'Retirados', status: ['RETIRADO'] },
  encerrados: { rotulo: 'Vencidos, cancelados e recusados', status: ['EXPIRADO', 'CANCELADO', 'RECUSADO'] },
  todos: { rotulo: 'Todos', status: null },
};

const ABERTOS = ['AGUARDANDO_APROVACAO', 'PENDENTE', 'SEPARADO'];

function prazoTexto(p) {
  if (!ABERTOS.includes(p.status)) return fmtData(p.prazo_retirada);
  const dias = Math.ceil((new Date(p.prazo_retirada) - Date.now()) / 86400000);
  if (dias < 0) return '<span class="negativo">vencido</span>';
  if (dias <= 1) return `<span class="negativo">vence ${dias === 0 ? 'hoje' : 'amanhã'}</span>`;
  return `vence em ${dias} dias`;
}

export async function montar(el, ctx) {
  const meuNivel = nivel(ctx.perfil.perfil);
  const pode = { pedir: meuNivel >= 2, operar: meuNivel >= 3, aprovar: meuNivel >= 4 };
  const meuId = ctx.perfil.id;

  let pedidos = [];
  let itensPor = new Map();
  let materiais = [];
  let setores = [];
  let unidades = [];
  let reservas = new Map();
  let regras = { exigir: false, prazo: 7 };
  const porId = { materiais: new Map(), pedidos: new Map() };
  const filtro = { status: 'abertos', busca: '' };

  async function carregar() {
    await supabase.rpc('expirar_pedidos').then(() => {}, () => {});
    const [p, i, m, c, d, s, u, r, cfg] = await Promise.all([
      buscarTodos(() => supabase.from('pedidos').select('*').order('criado_em', { ascending: false })),
      buscarTodos(() => supabase.from('pedido_itens').select('*').order('id')),
      buscarTodos(() => supabase.from('materiais').select('*').order('nome')),
      supabase.from('classes').select('id,nome,cor'),
      supabase.from('depositos').select('id,numero,nome'),
      supabase.from('setores').select('*').order('nome'),
      supabase.from('unidades').select('id,nome,removido_em').order('nome'),
      supabase.rpc('reservas'),
      supabase.from('configuracoes').select('chave,valor').in('chave', ['exigir_aprovacao_pedidos', 'prazo_retirada_dias']),
    ]);
    for (const x of [c, d, s, u, cfg]) if (x.error) throw x.error;
    const classes = new Map(c.data.map(x => [x.id, x]));
    const depositos = new Map(d.data.map(x => [x.id, x]));
    setores = s.data;
    unidades = u.data;
    reservas = new Map((r.data || []).map(x => [x.material_id, Number(x.reservado)]));
    cfg.data.forEach(x => {
      if (x.chave === 'exigir_aprovacao_pedidos') regras.exigir = x.valor === true || x.valor === 'true';
      if (x.chave === 'prazo_retirada_dias') regras.prazo = Number(x.valor);
    });
    materiais = m.map(x => {
      const dep = depositos.get(x.deposito_id);
      const reservado = reservas.get(x.id) || 0;
      return {
        ...x,
        classe: classes.get(x.classe_id),
        local: codigoLocalizacao(dep?.numero, x.prateleira, x.lado, x.andar, x.posicao),
        ordemLocal: [dep?.numero || 0, x.prateleira, x.lado, x.andar, x.posicao].map(v => String(v).padStart(3, '0')).join(''),
        reservado,
        disponivel: Math.max(Number(x.saldo) - reservado, 0),
        rotulo: `${x.codigo} · ${x.nome} · PRN ${x.prn}`,
      };
    });
    porId.materiais = new Map(materiais.map(x => [x.id, x]));
    pedidos = p;
    porId.pedidos = new Map(p.map(x => [x.id, x]));
    itensPor = new Map();
    i.forEach(x => { if (!itensPor.has(x.pedido_id)) itensPor.set(x.pedido_id, []); itensPor.get(x.pedido_id).push(x); });
  }

  const itensDe = p => itensPor.get(p.id) || [];
  // Estoque por setor: classes permitidas e centro de custo.
  const setorDe = id => setores.find(x => String(x.id) === String(id));
  function bloqueioSetor(m, setorId) {
    const setor = setorDe(setorId);
    if (!setor) return 'Escolha o setor.';
    if (m.centro_custo_id && String(m.centro_custo_id) !== String(setor.id)) return `é do centro de custo ${setorDe(m.centro_custo_id)?.nome || 'de outro setor'}`;
    if (setor.classes_permitidas?.length && !setor.classes_permitidas.includes(m.classe_id)) return `o setor ${setor.nome} não pede a classe ${m.classe?.nome || ''}`;
    return '';
  }
  async function imprimirComprovante(pedidoId, formato) {
    const janela = abrirJanelaComprovante();
    const p = porId.pedidos.get(pedidoId);
    const itens = itensDe(p).filter(i => Number(i.quantidade_entregue ?? i.quantidade_separada ?? 0) > 0).map(i => {
      const m = porId.materiais.get(i.material_id) || {};
      return { codigo: m.codigo, nome: m.nome, quantidade: i.quantidade_entregue ?? i.quantidade_separada, unidade: m.unidade_medida, local: m.local };
    });
    const setor = setorDe(p.setor_id);
    await montarComprovante(janela, {
      pedido: p, itens, setor: setor?.nome, centroCusto: setor?.codigo_centro_custo,
      unidade: unidades.find(u => u.id === p.unidade_id)?.nome, peso: pesoDe(p),
      epis: [...new Set(itensDe(p).map(i => porId.materiais.get(i.material_id)).filter(m => m?.epi).map(m => `${m.nome}: ${m.epi}`))],
    }, formato);
  }
  const pesoDe = p => itensDe(p).reduce((t, i) => t + Number(porId.materiais.get(i.material_id)?.peso_kg || 0) * Number(i.quantidade_separada ?? i.quantidade), 0);
  const ativos = () => materiais.filter(m => !m.removido_em);
  const acharMaterial = texto => {
    const t = String(texto || '').trim();
    if (!t) return null;
    const codigo = t.split(' · ')[0].trim().toUpperCase();
    return ativos().find(m => m.codigo === codigo) || ativos().find(m => m.prn.toLowerCase() === t.toLowerCase())
      || ativos().find(m => termoBusca(m.nome) === termoBusca(t));
  };

  // -----------------------------------------------------------------
  // Lista
  // -----------------------------------------------------------------
  function filtrados() {
    const permitidos = FILTROS[filtro.status].status;
    const palavras = termoBusca(filtro.busca).split(' ').filter(Boolean);
    return pedidos.filter(p => {
      if (permitidos && !permitidos.includes(p.status)) return false;
      if (!palavras.length) return true;
      const texto = textoBusca(p.numero, p.solicitante_nome, setores.find(s => s.id === p.setor_id)?.nome,
        ...itensDe(p).map(i => porId.materiais.get(i.material_id)?.nome));
      return palavras.every(w => texto.includes(w));
    });
  }

  function chips() {
    return Object.entries(FILTROS).map(([id, f]) => {
      const qtd = f.status ? pedidos.filter(p => f.status.includes(p.status)).length : pedidos.length;
      const alerta = (id === 'AGUARDANDO_APROVACAO' && pode.aprovar) || (id === 'PENDENTE' && pode.operar);
      return `<button type="button" class="chip ${filtro.status === id ? 'ativo' : ''} ${alerta && qtd ? 'alerta' : ''}" data-filtro="${id}">${f.rotulo} <b>${qtd}</b></button>`;
    }).join('');
  }

  function botaoAcao(p) {
    if (p.status === 'AGUARDANDO_APROVACAO' && pode.aprovar) return 'Aprovar';
    if (p.status === 'PENDENTE' && pode.operar) return 'Separar';
    if (p.status === 'SEPARADO' && pode.operar) return 'Entregar';
    return 'Abrir';
  }

  function linhas() {
    const lista = filtrados();
    if (!lista.length) return `<tr><td colspan="7" class="empty">${pedidos.length ? 'Nenhum pedido com esse filtro.' : 'Nenhum pedido ainda.'}</td></tr>`;
    return lista.map(p => {
      const itens = itensDe(p);
      const peso = pesoDe(p);
      return `<tr>
        <td><button type="button" class="link-material" data-abrir="${p.id}"><span><b>${esc(p.numero)}</b><span class="small muted">${fmtDataHora(p.criado_em)}</span></span></button></td>
        <td>${esc(p.solicitante_nome || '')}<div class="small muted">${esc(setores.find(s => s.id === p.setor_id)?.nome || '')}</div></td>
        <td>${itens.length} item(ns)<div class="small muted">${esc(itens.slice(0, 2).map(i => porId.materiais.get(i.material_id)?.nome || '').join(', '))}${itens.length > 2 ? '...' : ''}</div></td>
        <td class="nowrap">${peso ? fmtQtd(peso) + ' kg' : '—'}</td>
        <td class="nowrap">${prazoTexto(p)}</td>
        <td><span class="pill ${STATUS_PEDIDO[p.status].classe}">${STATUS_PEDIDO[p.status].rotulo}</span>${p.usa_emergencial ? '<div><span class="pill red pill-mini">Emergencial</span></div>' : ''}</td>
        <td><button class="btn ${botaoAcao(p) === 'Abrir' ? 'btn-light' : 'btn-primary'} btn-sm" type="button" data-abrir="${p.id}">${botaoAcao(p)}</button></td>
      </tr>`;
    }).join('');
  }

  function blocoRegras() {
    if (!pode.aprovar) return '';
    return `<section class="card card-pad painel-bloco">
      <h2 class="section-title">Regras dos pedidos</h2>
      <p class="section-sub">Pedidos que usam o saldo emergencial sempre passam pelo gestor. Ligue a aprovação para que todo pedido passe.</p>
      <form id="formRegras" class="toolbar filtros regra-peso" novalidate>
        <label class="inline-check"><input type="checkbox" id="regraExigir" ${regras.exigir ? 'checked' : ''}> Todo pedido precisa de aprovação do gestor</label>
        <label class="filtro-campo">Prazo para retirar (dias)<input id="regraPrazo" type="number" min="1" max="60" value="${regras.prazo}"></label>
        <button class="btn btn-primary" type="submit">Salvar regras</button>
      </form>
    </section>`;
  }

  function desenhar() {
    el.innerHTML = `
      ${cabecalho(pode.operar || meuNivel === 1 ? 'Pedidos' : 'Meus pedidos',
        pode.operar
          ? 'Fluxo do SAI+: pedido no setor, separação, identificação na retirada e registro da saída. A lista de separação sai na ordem do endereço.'
          : `Peça o material pelo sistema e retire no almoxarifado com o crachá. O prazo para retirar é de ${regras.prazo} dias.`,
        pode.pedir ? '<button class="btn btn-primary" type="button" data-acao="novo">Novo pedido</button>' : '')}
      <div class="resumo-chips" id="chipsPed">${chips()}</div>
      <section class="card card-pad">
        <div class="toolbar filtros">
          <input class="search" id="fBuscaPed" type="search" placeholder="Buscar por número, solicitante, setor ou material" value="${esc(filtro.busca)}" aria-label="Buscar pedido" autocomplete="off">
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Pedido</th><th>Solicitante</th><th>Itens</th><th>Peso</th><th>Prazo</th><th>Situação</th><th></th></tr></thead>
          <tbody id="corpoPed">${linhas()}</tbody>
        </table></div>
      </section>
      ${blocoRegras()}`;
  }

  const atualizarLista = () => {
    $('#corpoPed', el).innerHTML = linhas();
    $('#chipsPed', el).innerHTML = chips();
  };

  // -----------------------------------------------------------------
  // Novo pedido
  // -----------------------------------------------------------------
  const opcoesMateriais = (setorId = null) => ativos().filter(m => !setorId || !bloqueioSetor(m, setorId)).map(m => `<option value="${esc(m.rotulo)}"></option>`).join('');
  const linhaItem = () => `<div class="linha-pedido">
      <input class="item-material" list="listaMateriaisPed" placeholder="Busque por nome, PRN ou código" aria-label="Material" autocomplete="off">
      <input class="item-qtd" type="number" min="0" step="any" placeholder="Qtd." aria-label="Quantidade">
      <select class="item-cat" aria-label="Motivo da retirada">${Object.entries(CATEGORIAS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" type="button" data-tirar-linha aria-label="Tirar item">×</button>
      <div class="item-info small muted"></div>
    </div>`;

  function abrirNovo() {
    const perfil = estado.perfil;
    const travado = !pode.operar;
    if (travado && !perfil?.setor_id) {
      return mostrarConcluido('Falta o seu setor', '<p>Seu usuário ainda não tem setor. Peça ao gestor para incluir o setor no seu cadastro: é por ele que o sistema sabe quais materiais você pode pedir.</p>');
    }
    const fundo = abrirModal({
      titulo: 'Novo pedido de material',
      subtitulo: `O almoxarifado separa e você retira com o crachá em até ${regras.prazo} dias.`,
      largo: true,
      corpo: `<form id="formPed" novalidate>
        <div class="fields campos-3">
          <div class="field"><label for="pSetor">Setor solicitante *</label><select id="pSetor" ${travado ? 'disabled' : ''}><option value="">Escolha o setor</option>${setores.filter(s => !s.removido_em).map(s => `<option value="${s.id}" ${s.id === perfil?.setor_id ? 'selected' : ''}>${esc(s.nome)}${s.codigo_centro_custo ? ` · CC ${esc(s.codigo_centro_custo)}` : ''}</option>`).join('')}</select>
            <small class="dica">${travado ? 'Você pede pelo seu setor. A lista mostra só os materiais que ele pode pedir.' : 'A lista de materiais muda conforme o setor escolhido.'}</small></div>
          <div class="field"><label for="pUnidade">Unidade</label><select id="pUnidade">${unidades.filter(u => !u.removido_em).map(u => `<option value="${u.id}" ${u.id === perfil?.unidade_id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></div>
          <div class="field"><label for="pAnexo">Anexo (opcional)</label><input id="pAnexo" type="file" accept="application/pdf,image/*"><small class="dica">Ordem de serviço, requisição assinada ou foto.</small></div>
        </div>
        <div class="form-section"><h3>Materiais</h3>
          <datalist id="listaMateriaisPed">${opcoesMateriais(perfil?.setor_id)}</datalist>
          <div id="pItens">${linhaItem()}</div>
          <button class="btn btn-light btn-sm" type="button" data-add-linha>Adicionar material</button>
          <div id="pResumo" class="resumo-pedido"></div>
        </div>
        <div class="form-section"><h3>Observação</h3><textarea id="pObs" rows="2" maxlength="300" placeholder="Ex.: para a parada da máquina 3, retirada pelo turno da tarde"></textarea></div>
        <p class="form-erro" id="pErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formPed">Enviar pedido</button>`,
    });

    function atualizarResumo() {
      let peso = 0;
      let emergencial = false;
      const epis = [];
      $$('.linha-pedido', fundo).forEach(linha => {
        const m = acharMaterial($('.item-material', linha).value);
        const qtd = Number($('.item-qtd', linha).value) || 0;
        const info = $('.item-info', linha);
        $('.item-material', linha).classList.toggle('invalido', Boolean($('.item-material', linha).value.trim()) && !m);
        if (!m) { info.textContent = ''; return; }
        const bloqueio = bloqueioSetor(m, $('#pSetor', fundo).value);
        if (bloqueio) { info.innerHTML = `<b class="negativo">Não pode ser pedido: ${esc(bloqueio)}.</b>`; return; }
        const normal = Math.max(m.disponivel - Number(m.saldo_emergencial), 0);
        const avisos = [`Disponível: ${fmtQtd(m.disponivel)} ${m.unidade_medida}`, `endereço ${m.local}`];
        if (m.centro_custo_id) avisos.push(`CC ${esc(setorDe(m.centro_custo_id)?.nome || '')}`);
        if (m.peso_kg) avisos.push(`${fmtQtd(m.peso_kg)} kg cada`);
        if (qtd > m.disponivel) avisos.push('<b class="negativo">mais do que há disponível</b>');
        else if (qtd > normal) { avisos.push('<b class="negativo">usa o saldo emergencial</b>'); emergencial = true; }
        info.innerHTML = avisos.join(' · ');
        peso += Number(m.peso_kg || 0) * qtd;
        if (m.epi) epis.push(`${esc(m.nome)}: ${esc(m.epi)}`);
      });
      const partes = [];
      if (peso) partes.push(`<div><b>Peso total:</b> ${fmtQtd(peso)} kg${peso >= 25 ? ' · use carrinho ou peça ajuda para carregar' : ''}</div>`);
      if (epis.length) partes.push(`<div><b>EPI necessário:</b> ${epis.join('; ')}</div>`);
      if (emergencial) partes.push('<div class="negativo"><b>Este pedido usa o saldo emergencial e vai para aprovação do gestor.</b></div>');
      else if (regras.exigir) partes.push('<div>Todos os pedidos passam pela aprovação do gestor.</div>');
      $('#pResumo', fundo).innerHTML = partes.join('');
    }

    fundo.addEventListener('input', atualizarResumo);
    fundo.addEventListener('change', e => {
      if (e.target.id === 'pSetor') $('#listaMateriaisPed', fundo).innerHTML = opcoesMateriais(e.target.value);
      atualizarResumo();
    });
    fundo.addEventListener('click', e => {
      if (e.target.closest('[data-add-linha]')) { $('#pItens', fundo).insertAdjacentHTML('beforeend', linhaItem()); $$('.item-material', fundo).at(-1).focus(); }
      const tirar = e.target.closest('[data-tirar-linha]');
      if (tirar && $$('.linha-pedido', fundo).length > 1) { tirar.closest('.linha-pedido').remove(); atualizarResumo(); }
    });
    const parar = ouvir(['materiais', 'pedidos', 'pedido_itens', 'setores'], async () => {
      await carregar();
      $('#listaMateriaisPed', fundo).innerHTML = opcoesMateriais($('#pSetor', fundo).value);
      atualizarResumo();
    });
    aoFecharModal(fundo, parar);

    $('#formPed', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#pErro', fundo);
      const falhar = m => { erro.textContent = m; erro.hidden = false; erro.scrollIntoView({ block: 'nearest' }); };
      const itens = [];
      for (const linha of $$('.linha-pedido', fundo)) {
        const texto = $('.item-material', linha).value.trim();
        if (!texto && !$('.item-qtd', linha).value) continue;
        const m = acharMaterial(texto);
        const qtd = Number($('.item-qtd', linha).value);
        if (!m) return falhar(`Material não encontrado: "${texto}". Escolha um da lista.`);
        if (!(qtd > 0)) return falhar(`Informe a quantidade de ${m.nome}.`);
        const bloqueio = bloqueioSetor(m, $('#pSetor', fundo).value);
        if (bloqueio) return falhar(`${m.nome} não pode ser pedido: ${bloqueio}.`);
        if (qtd > m.disponivel) return falhar(`${m.nome}: há só ${fmtQtd(m.disponivel)} ${m.unidade_medida} disponível(is).`);
        if (itens.some(i => i.material_id === m.id)) return falhar(`${m.nome} aparece duas vezes. Junte as quantidades.`);
        itens.push({ material_id: m.id, quantidade: qtd, categoria: $('.item-cat', linha).value });
      }
      if (!itens.length) return falhar('Inclua pelo menos um material.');
      if (!$('#pSetor', fundo).value) return falhar('Escolha o setor solicitante.');
      erro.hidden = true;
      await executando(e.submitter, async () => {
        try {
          let anexo = {};
          const arquivo = $('#pAnexo', fundo).files[0];
          if (arquivo) {
            const caminho = await enviarArquivo(`${meuId}/${Date.now()}.${extensao(arquivo)}`, await prepararImagem(arquivo), 'pedidos');
            anexo = { anexo_path: caminho, anexo_nome: arquivo.name };
          }
          const { data, error } = await supabase.rpc('criar_pedido', {
            p_dados: { setor_id: $('#pSetor', fundo).value, unidade_id: $('#pUnidade', fundo).value, observacao: $('#pObs', fundo).value, itens, ...anexo },
          });
          if (error) throw error;
          fecharModal(true);
          await carregar();
          atualizarLista();
          mostrarConcluido('Pedido enviado', `<p>Seu pedido <b>${esc(data.numero)}</b> foi registrado.</p>
            <p>${data.status === 'AGUARDANDO_APROVACAO' ? 'Ele vai para a <b>aprovação do gestor</b> antes da separação.' : 'O almoxarifado já pode separar o material.'}</p>
            <p>Retire até <b>${fmtData(data.prazo_retirada)}</b>, com o seu crachá. Depois disso o pedido vence.</p>`);
        } catch (falha) {
          falhar(erroAmigavel(falha));
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // Detalhe: aprovar, separar, entregar, devolver
  // -----------------------------------------------------------------
  function etapas(p) {
    const passos = ['Pedido no setor', 'Separação', 'Pronto para retirada', 'Retirado'];
    const atual = { AGUARDANDO_APROVACAO: 0, PENDENTE: 1, SEPARADO: 2, RETIRADO: 4 }[p.status] ?? -1;
    return `<ol class="etapas">${passos.map((t, i) => `<li class="${i < atual ? 'feita' : i === atual ? 'atual' : ''} ${['EXPIRADO', 'CANCELADO', 'RECUSADO'].includes(p.status) && i === 0 ? 'problema' : ''}">${t}</li>`).join('')}</ol>`;
  }

  function conteudoDetalhe(p) {
    const itens = [...itensDe(p)].sort((a, b) => (porId.materiais.get(a.material_id)?.ordemLocal || '').localeCompare(porId.materiais.get(b.material_id)?.ordemLocal || ''));
    const separando = p.status === 'PENDENTE' && pode.operar;
    const retirado = p.status === 'RETIRADO';
    const setor = setores.find(s => s.id === p.setor_id)?.nome || '';
    const epis = itens.map(i => porId.materiais.get(i.material_id)).filter(m => m?.epi);
    return `
      ${etapas(p)}
      <dl class="ficha ficha-3">
        <div><dt>Solicitante</dt><dd>${esc(p.solicitante_nome || '')}${setor ? ` · ${esc(setor)}` : ''}</dd></div>
        <div><dt>Pedido em</dt><dd>${fmtDataHora(p.criado_em)}</dd></div>
        <div><dt>Prazo para retirar</dt><dd>${fmtData(p.prazo_retirada)} · ${prazoTexto(p)}</dd></div>
        ${p.aprovado_em ? `<div><dt>${p.status === 'RECUSADO' ? 'Recusado' : 'Aprovado'} por</dt><dd>${esc(p.aprovado_por_nome || '')} · ${fmtDataHora(p.aprovado_em)}</dd></div>` : ''}
        ${p.separado_em ? `<div><dt>Separado por</dt><dd>${esc(p.separado_por_nome || '')} · ${fmtDataHora(p.separado_em)}</dd></div>` : ''}
        ${p.retirado_em ? `<div><dt>Retirado por</dt><dd>${esc(p.recebedor_nome || '')} (${p.retirada_metodo === 'CRACHA' ? 'crachá' : 'foto'}) · ${fmtDataHora(p.retirado_em)}<br><span class="small muted">Entregue por ${esc(p.entregue_por_nome || '')}</span></dd></div>` : ''}
      </dl>
      ${p.observacao ? `<p class="small"><b>Observação:</b> ${esc(p.observacao)}</p>` : ''}
      <div class="acoes-linha">
        ${p.anexo_path ? '<button class="btn btn-light btn-sm" type="button" data-ped="anexo">Abrir anexo do pedido</button>' : ''}
        ${p.retirada_foto_path ? '<button class="btn btn-light btn-sm" type="button" data-ped="foto">Ver foto da retirada</button>' : ''}
      </div>
      ${p.usa_emergencial ? '<div class="notice">Este pedido usa o saldo emergencial de pelo menos um material.</div>' : ''}
      ${p.motivo_encerramento ? `<div class="notice">${esc(STATUS_PEDIDO[p.status].rotulo)}: ${esc(p.motivo_encerramento)}</div>` : ''}
      ${epis.length ? `<div class="notice"><b>EPI necessário:</b> ${epis.map(m => `${esc(m.nome)}: ${esc(m.epi)}`).join('; ')}</div>` : ''}

      <h3 class="detalhe-titulo">${separando ? 'Lista de separação (na ordem do endereço)' : 'Itens'}</h3>
      <div class="table-wrap"><table class="table tabela-compacta tabela-conferencia">
        <thead><tr><th>Endereço</th><th>Material</th><th>Motivo</th><th>Pedido</th><th>${separando ? 'Separar' : 'Separado'}</th>${retirado ? '<th>Entregue</th><th>Devolvido</th><th></th>' : ''}</tr></thead>
        <tbody>${itens.map(i => {
          const m = porId.materiais.get(i.material_id);
          const maximo = Math.min(Number(i.quantidade), Number(m?.saldo || 0) - (Number(m?.reservado || 0) - Number(i.quantidade)));
          return `<tr data-item="${i.id}">
            <td><span class="codigo-local">${esc(m?.local || '')}</span></td>
            <td><span class="link-material"><span class="barra-classe" style="background:${esc(m?.classe?.cor || '#ccc')}"></span><span><b>${esc(m?.nome || 'Material removido')}</b><span class="small muted">${esc(m?.codigo || '')}${m?.peso_kg ? ` · ${fmtQtd(m.peso_kg)} kg cada` : ''}</span></span></span></td>
            <td class="small">${CATEGORIAS[i.categoria]}</td>
            <td class="nowrap">${fmtQtd(i.quantidade)} ${esc(m?.unidade_medida || '')}</td>
            <td class="nowrap">${separando ? `<input class="sep-qtd" type="number" min="0" max="${i.quantidade}" step="any" value="${i.quantidade_separada ?? Math.max(Math.min(i.quantidade, maximo), 0)}" aria-label="Quantidade separada">` : i.quantidade_separada === null ? '—' : fmtQtd(i.quantidade_separada)}</td>
            ${retirado ? `<td>${fmtQtd(i.quantidade_entregue ?? 0)}</td><td>${fmtQtd(i.quantidade_devolvida)}</td>
              <td>${pode.operar && Number(i.quantidade_devolvida) < Number(i.quantidade_entregue || 0) ? `<button class="btn btn-ghost btn-sm" type="button" data-devolver="${i.id}">Devolver</button>` : ''}</td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small muted">Peso total: ${fmtQtd(pesoDe(p))} kg</p>

      ${p.status === 'SEPARADO' && pode.operar ? `
      <div class="painel-retirada">
        <h3>Confirmar a retirada</h3>
        <p class="small muted">Assinar para receber: a retirada só conclui com o crachá cadastrado ou com foto de quem está levando.</p>
        <div class="abas" role="tablist">
          <button type="button" class="aba ativa" data-aba="cracha" role="tab" aria-selected="true">Crachá</button>
          <button type="button" class="aba" data-aba="foto" role="tab" aria-selected="false">Foto (sem crachá)</button>
        </div>
        <div data-painel="cracha">
          <label class="small" for="retCracha">Aproxime o crachá do leitor ou digite o número</label>
          <div class="linha-senha"><input id="retCracha" autocomplete="off" placeholder="Número do crachá" data-nao-altera>
          ${'NDEFReader' in window ? '<button class="btn btn-light" type="button" data-ped="nfc">Ler pelo celular (NFC)</button>' : ''}</div>
          <small class="dica">Leitores USB de crachá funcionam como teclado: o número aparece no campo e o Enter confirma.</small>
        </div>
        <div data-painel="foto" hidden>
          <div class="fields">
            <div class="field"><label for="retNome">Nome de quem retira *</label><input id="retNome" maxlength="100" data-nao-altera></div>
            <div class="field"><label for="retFoto">Foto *</label><input id="retFoto" type="file" accept="image/*" capture="user" data-nao-altera></div>
          </div>
        </div>
      </div>` : ''}
      ${pode.aprovar && p.status === 'AGUARDANDO_APROVACAO' ? `<div class="painel-acao" id="painelRecusa" hidden><h3>Recusar pedido</h3>
        <textarea id="recusaTexto" rows="2" maxlength="300" placeholder="Motivo da recusa" data-nao-altera></textarea>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn btn-danger" type="button" data-ped="confirmar-recusa">Recusar</button></div></div>` : ''}
      <div class="painel-acao" id="painelCancelar" hidden><h3>Cancelar pedido</h3>
        <textarea id="cancTextoPed" rows="2" maxlength="300" placeholder="Motivo do cancelamento" data-nao-altera></textarea>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn btn-danger" type="button" data-ped="confirmar-cancelar">Cancelar pedido</button></div></div>
      <div class="painel-acao" id="painelDevolucao" hidden><h3>Registrar devolução</h3>
        <div class="fields"><div class="field"><label for="devQtd">Quantidade devolvida</label><input id="devQtd" type="number" min="0" step="any" data-nao-altera></div>
        <div class="field"><label for="devMotivo">Motivo</label><input id="devMotivo" maxlength="160" placeholder="Ex.: sobrou na manutenção" data-nao-altera></div></div>
        <div class="acoes-linha" style="margin-top:10px"><button class="btn btn-primary" type="button" data-ped="confirmar-devolucao">Registrar devolução</button></div></div>
      <p class="form-erro" id="pedErro" role="alert" hidden></p>`;
  }

  function rodapeDetalhe(p) {
    const b = ['<button class="btn btn-ghost" type="button" data-fechar>Fechar</button>'];
    const aberto = ABERTOS.includes(p.status);
    if (aberto && (p.solicitante_id === meuId || pode.operar)) b.push('<button class="btn btn-ghost" type="button" data-ped="cancelar">Cancelar pedido</button>');
    if (p.status === 'AGUARDANDO_APROVACAO' && pode.aprovar) {
      b.push('<button class="btn btn-light" type="button" data-ped="recusar">Recusar</button>');
      b.push('<button class="btn btn-primary" type="button" data-ped="aprovar">Aprovar pedido</button>');
    }
    if (p.status === 'RETIRADO') b.push(`<select id="detFormato" aria-label="Formato do comprovante" data-nao-altera>${Object.entries(FORMATOS_COMPROVANTE).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select><button class="btn btn-primary" type="button" data-ped="comprovante">Imprimir comprovante</button>`);
    if (p.status === 'PENDENTE' && pode.operar) b.push('<button class="btn btn-primary" type="button" data-ped="separar">Confirmar separação</button>');
    if (p.status === 'SEPARADO' && pode.operar) {
      b.push('<button class="btn btn-light" type="button" data-ped="refazer">Refazer separação</button>');
      b.push('<button class="btn btn-primary" type="button" data-ped="entregar">Confirmar retirada</button>');
    }
    return b.join('');
  }

  function abrirDetalhe(id) {
    let p = porId.pedidos.get(id);
    if (!p) return toast('Pedido não encontrado.', 'erro');
    history.replaceState(null, '', `#/pedidos/${p.numero}`);
    let devolvendo = null;
    let refazendo = false;
    const fundo = abrirModal({
      titulo: `${esc(p.numero)}`,
      subtitulo: `<span class="pill ${STATUS_PEDIDO[p.status].classe}">${STATUS_PEDIDO[p.status].rotulo}</span>`,
      largo: true,
      corpo: conteudoDetalhe(p),
      rodape: rodapeDetalhe(p),
      aoFechar: () => { if (/^#\/pedidos\//.test(location.hash)) history.replaceState(null, '', '#/pedidos'); },
    });
    const corpo = $('.modal-body', fundo);
    const falhar = m => { const e = $('#pedErro', corpo); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: 'nearest' }); };
    const redesenhar = () => {
      p = porId.pedidos.get(id);
      if (!p || !document.body.contains(fundo)) return;
      const vista = refazendo ? { ...p, status: 'PENDENTE' } : p;
      const rolagem = corpo.scrollTop;
      corpo.innerHTML = conteudoDetalhe(vista);
      $('.modal-foot', fundo).innerHTML = rodapeDetalhe(vista);
      $('.modal-head p', fundo).innerHTML = `<span class="pill ${STATUS_PEDIDO[p.status].classe}">${STATUS_PEDIDO[p.status].rotulo}</span>`;
      corpo.scrollTop = rolagem;
      delete fundo.dataset.alterado;
      setTimeout(() => $('#retCracha', corpo)?.focus(), 50);
    };
    const recarregarTudo = async () => { await carregar(); atualizarLista(); redesenhar(); };
    setTimeout(() => $('#retCracha', corpo)?.focus(), 80);

    async function entregar(metodo) {
      let args = { p_pedido: p.id, p_metodo: metodo };
      if (metodo === 'CRACHA') {
        const numero = $('#retCracha', corpo).value.trim();
        if (!numero) return falhar('Aproxime o crachá ou digite o número.');
        args.p_cracha = numero;
      } else {
        const nome = $('#retNome', corpo).value.trim();
        const foto = $('#retFoto', corpo).files[0];
        if (nome.length < 3) return falhar('Informe o nome de quem está retirando.');
        if (!foto) return falhar('Tire a foto de quem está retirando.');
        args.p_foto_path = await enviarArquivo(`${p.id}/retirada-${Date.now()}.jpg`, await prepararImagem(foto), 'pedidos');
        args.p_recebedor_nome = nome;
      }
      const { data, error } = await supabase.rpc('confirmar_retirada', args);
      if (error) throw error;
      await carregar();
      atualizarLista();
      fecharModal(true);
      const fim = abrirModal({
        titulo: 'Retirada concluída',
        pequeno: true,
        corpo: `<div class="concluido"><div class="concluido-marca" aria-hidden="true">✓</div><div>
          <p><b>${esc(data.recebedor)}</b> retirou o pedido <b>${esc(data.numero)}</b>.</p>
          <ul class="mudancas">${data.itens.map(i => `<li>${fmtQtd(i.quantidade)} ${esc(i.unidade)} de ${esc(i.nome)}</li>`).join('')}</ul>
          ${data.outra_pessoa ? '<p class="small muted">Retirado por outra pessoa, não pelo solicitante. Fica registrado no pedido.</p>' : ''}
          <p class="small muted">A saída já está no estoque e no histórico de movimentações.</p>
          <div class="field" style="margin-top:12px"><label for="fimFormato">Comprovante</label><select id="fimFormato" data-nao-altera>${Object.entries(FORMATOS_COMPROVANTE).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
        </div></div>`,
        rodape: '<button class="btn btn-ghost" type="button" data-fechar>Fechar</button><button class="btn btn-primary" type="button" data-comprovante>Imprimir comprovante</button>',
      });
      $('[data-comprovante]', fim).addEventListener('click', () => imprimirComprovante(p.id, $('#fimFormato', fim).value).catch(f => toast(f.message, 'erro')));
    }

    corpo.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'retCracha') { e.preventDefault(); $('[data-ped="entregar"]', fundo)?.click(); }
    });

    fundo.addEventListener('click', async e => {
      const aba = e.target.closest('[data-aba]');
      if (aba) {
        $$('[data-aba]', corpo).forEach(x => { x.classList.toggle('ativa', x === aba); x.setAttribute('aria-selected', String(x === aba)); });
        $$('[data-painel]', corpo).forEach(x => { x.hidden = x.dataset.painel !== aba.dataset.aba; });
        return;
      }
      const devolver = e.target.closest('[data-devolver]');
      if (devolver) {
        devolvendo = itensDe(p).find(i => String(i.id) === devolver.dataset.devolver);
        const painel = $('#painelDevolucao', corpo);
        painel.hidden = false;
        $('#devQtd', corpo).value = Number(devolvendo.quantidade_entregue) - Number(devolvendo.quantidade_devolvida);
        painel.scrollIntoView({ block: 'center' });
        return;
      }
      const botao = e.target.closest('[data-ped]');
      if (!botao) return;
      const acao = botao.dataset.ped;
      $('#pedErro', corpo).hidden = true;
      if (acao === 'anexo') return abrirArquivoPrivado(p.anexo_path, 'pedidos').catch(f => falhar(f.message));
      if (acao === 'foto') return abrirArquivoPrivado(p.retirada_foto_path, 'pedidos').catch(f => falhar(f.message));
      if (acao === 'recusar' || acao === 'cancelar') {
        const painel = $(acao === 'recusar' ? '#painelRecusa' : '#painelCancelar', corpo);
        painel.hidden = false;
        painel.scrollIntoView({ block: 'center' });
        return $('textarea', painel).focus();
      }
      if (acao === 'refazer') { refazendo = true; return redesenhar(); }
      if (acao === 'comprovante') return imprimirComprovante(p.id, $('#detFormato', fundo).value).catch(f => falhar(f.message));
      if (acao === 'nfc') {
        try {
          const leitor = new window.NDEFReader();
          const controle = new AbortController();
          await leitor.scan({ signal: controle.signal });
          toast('Aproxime o crachá do celular.');
          leitor.onreading = ev => { controle.abort(); $('#retCracha', corpo).value = ev.serialNumber || ''; $('[data-ped="entregar"]', fundo)?.click(); };
        } catch (falha) { falhar('Não foi possível ler o NFC. Confira se o NFC do celular está ligado e permita o acesso.'); }
        return;
      }
      await executando(botao, async () => {
        try {
          if (acao === 'aprovar') {
            const { error } = await supabase.rpc('aprovar_pedido', { p_pedido: p.id, p_aprovar: true });
            if (error) throw error;
            toast('Pedido aprovado. Já pode ser separado.');
          }
          if (acao === 'confirmar-recusa') {
            const { error } = await supabase.rpc('aprovar_pedido', { p_pedido: p.id, p_aprovar: false, p_motivo: $('#recusaTexto', corpo).value });
            if (error) throw error;
            toast('Pedido recusado.');
          }
          if (acao === 'confirmar-cancelar') {
            const { error } = await supabase.rpc('cancelar_pedido', { p_pedido: p.id, p_motivo: $('#cancTextoPed', corpo).value });
            if (error) throw error;
            toast('Pedido cancelado.');
          }
          if (acao === 'separar') {
            const itens = $$('tr[data-item]', corpo).map(l => ({ id: Number(l.dataset.item), quantidade_separada: Number($('.sep-qtd', l).value) }));
            const { error } = await supabase.rpc('separar_pedido', { p_pedido: p.id, p_itens: itens });
            if (error) throw error;
            refazendo = false;
            toast('Separação confirmada. O pedido está pronto para retirada.');
          }
          if (acao === 'entregar') {
            const metodo = $('[data-aba].ativa', corpo)?.dataset.aba === 'foto' ? 'FOTO' : 'CRACHA';
            return await entregar(metodo);
          }
          if (acao === 'confirmar-devolucao') {
            const { error } = await supabase.rpc('registrar_devolucao', {
              p_material: devolvendo.material_id, p_quantidade: Number($('#devQtd', corpo).value), p_motivo: $('#devMotivo', corpo).value, p_pedido_item: devolvendo.id,
            });
            if (error) throw error;
            toast('Devolução registrada. O saldo voltou para o estoque.');
          }
          await recarregarTudo();
        } catch (falha) {
          falhar(erroAmigavel(falha));
        }
      });
    });

    const parar = ouvir(['pedidos', 'pedido_itens', 'materiais'], async (_t, mudancas) => {
      await carregar();
      atualizarLista();
      if (mudancas.some(x => x.novo?.id === id || x.novo?.pedido_id === id) && !fundo.dataset.alterado) redesenhar();
    });
    aoFecharModal(fundo, parar);
  }

  // -----------------------------------------------------------------
  await carregar();
  desenhar();

  el.addEventListener('input', e => { if (e.target.id === 'fBuscaPed') { filtro.busca = e.target.value; atualizarLista(); } });
  el.addEventListener('click', e => {
    const chip = e.target.closest('[data-filtro]');
    if (chip) { filtro.status = chip.dataset.filtro; return atualizarLista(); }
    const abrir = e.target.closest('[data-abrir]');
    if (abrir) return abrirDetalhe(Number(abrir.dataset.abrir));
    if (e.target.closest('[data-acao="novo"]')) abrirNovo();
  });
  el.addEventListener('submit', async e => {
    if (e.target.id !== 'formRegras') return;
    e.preventDefault();
    const prazo = Math.round(Number($('#regraPrazo', el).value));
    if (!(prazo >= 1 && prazo <= 60)) return toast('O prazo precisa ficar entre 1 e 60 dias.', 'erro');
    await executando(e.submitter, async () => {
      for (const [chave, valor] of [['exigir_aprovacao_pedidos', $('#regraExigir', el).checked], ['prazo_retirada_dias', prazo]]) {
        const { data, error } = await supabase.from('configuracoes').update({ valor }).eq('chave', chave).select('chave');
        if (error || !data?.length) return toast(error ? erroAmigavel(error) : 'Seu perfil não altera as regras.', 'erro');
      }
      toast('Regras salvas. Valem para os próximos pedidos.');
    });
  });

  ctx.aoSair(ouvir(['pedidos', 'pedido_itens', 'materiais', 'setores', 'configuracoes', 'classes'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    atualizarLista();
  }));

  if (ctx.parametro) {
    const alvo = pedidos.find(x => x.numero === decodeURIComponent(ctx.parametro).toUpperCase());
    if (alvo) abrirDetalhe(alvo.id);
  }
}
