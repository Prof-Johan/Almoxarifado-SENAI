import { supabase } from '../lib/supabase.js';
import {
  $, $$, esc, cabecalho, abrirModal, aoFecharModal, fecharModal, mostrarConcluido,
  executando, erroAmigavel, toast, fmtDataHora,
} from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { atualizarRegistro, buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { estado } from '../lib/sessao.js';
import {
  UNIDADES_MEDIDA, CRITICIDADES, TIPOS_MOVIMENTO, TIPOS_ARMAZENAGEM, fmtQtd, nomeDeposito,
  codigoLocalizacao, embalagemTexto, situacaoEstoque, dadosEtiqueta, etiquetaPendente,
  pillCor, textoBusca, termoBusca,
} from '../lib/materiais.js';
import { prepararImagem, enviarArquivo, apagarArquivo, urlArquivo } from '../lib/arquivos.js';
import { FORMATOS, abrirJanelaEtiquetas, montarEtiquetas } from '../lib/etiquetas.js';

const SITUACOES = {
  baixo: 'Estoque baixo',
  zerado: 'Sem estoque',
  emergencial: 'Só o emergencial',
  ok: 'Disponível',
};

const CAMPOS_HISTORICO = {
  nome: 'Nome', prn: 'PRN', descricao: 'Descrição', marca: 'Marca', classe_id: 'Classe',
  unidade_medida: 'Unidade', embalagem_qtd: 'Embalagem', embalagem_unidade: 'Embalagem',
  estoque_minimo: 'Estoque mínimo', criticidade: 'Criticidade', saldo_emergencial: 'Saldo emergencial',
  peso_kg: 'Peso', epi: 'EPI', deposito_id: 'Depósito', prateleira: 'Prateleira', lado: 'Lado',
  andar: 'Andar', posicao: 'Posição', foto_path: 'Foto', fds_path: 'Ficha de segurança',
  relacionados: 'Relacionados', removido_em: 'Remoção',
};

export async function montar(el, ctx) {
  const meuNivel = nivel(ctx.perfil.perfil);
  const pode = { editar: meuNivel >= 3, ajustar: meuNivel >= 4, etiqueta: meuNivel >= 3 };

  let materiais = [];
  let classes = [];
  let depositos = [];
  let unidades = [];
  let config = { pesoPesado: 15, andarMaxPesado: 2 };
  const porId = { classes: new Map(), depositos: new Map(), unidades: new Map(), materiais: new Map() };
  const filtro = { busca: '', classe: '', deposito: '', situacao: '', etiqueta: false, removidos: false, ordem: 'nome' };
  let reservas = new Map();
  let rotacao = new Map();
  const NIVEIS_ROT = { ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' };
  const selecionados = new Set();

  async function carregar() {
    const [m, c, d, u, e, cfg] = await Promise.all([
      buscarTodos(() => supabase.from('materiais').select('*').order('nome')),
      supabase.from('classes').select('*').order('numero'),
      supabase.from('depositos').select('*').order('numero'),
      supabase.from('unidades').select('id,nome,sigla,removido_em').order('nome'),
      buscarTodos(() => supabase.from('etiquetas').select('*').order('material_id')),
      supabase.from('configuracoes').select('chave,valor').in('chave', ['peso_pesado_kg', 'andar_maximo_pesado']),
    ]);
    for (const r of [c, d, u, cfg]) if (r.error) throw r.error;
    const [res, rot] = await Promise.all([supabase.rpc('reservas'), supabase.rpc('rotatividade', { p_dias: 90 })]);
    reservas = new Map((res.data || []).map(x => [x.material_id, Number(x.reservado)]));
    rotacao = new Map((rot.data || []).map(x => [x.material_id, x]));
    classes = c.data;
    depositos = d.data;
    unidades = u.data;
    for (const linha of cfg.data) {
      if (linha.chave === 'peso_pesado_kg') config.pesoPesado = Number(linha.valor);
      if (linha.chave === 'andar_maximo_pesado') config.andarMaxPesado = Number(linha.valor);
    }
    porId.classes = new Map(classes.map(x => [x.id, x]));
    porId.depositos = new Map(depositos.map(x => [x.id, x]));
    porId.unidades = new Map(unidades.map(x => [x.id, x]));
    const etiquetas = new Map(e.map(x => [x.material_id, x]));
    materiais = m.map(item => {
      const deposito = porId.depositos.get(item.deposito_id);
      const completo = {
        ...item,
        classe: porId.classes.get(item.classe_id),
        deposito,
        unidade: porId.unidades.get(deposito?.unidade_id),
        local: codigoLocalizacao(deposito?.numero, item.prateleira, item.lado, item.andar, item.posicao),
        etiqueta: etiquetas.get(item.id),
        reservado: reservas.get(item.id) || 0,
        rotatividade: rotacao.get(item.id) || { nivel: 'BAIXA', retiradas: 0, quantidade: 0 },
      };
      completo.disponivel = Math.max(Number(item.saldo) - completo.reservado, 0);
      completo.situacao = situacaoEstoque(completo);
      completo.pendente = !completo.removido_em && etiquetaPendente(completo);
      completo.busca = textoBusca(item.nome, item.prn, item.codigo, item.marca, item.descricao, completo.local, completo.classe?.nome);
      // Versão sem espaços: "8x50" encontra "8 x 50".
      completo.compacto = completo.busca.replace(/ /g, '');
      return completo;
    });
    porId.materiais = new Map(materiais.map(x => [x.id, x]));
    for (const id of [...selecionados]) if (!porId.materiais.get(id) || porId.materiais.get(id).removido_em) selecionados.delete(id);
  }

  const ativos = () => materiais.filter(m => !m.removido_em);

  function filtrados() {
    const termo = termoBusca(filtro.busca);
    const palavras = termo ? termo.split(' ') : [];
    return materiais.filter(m => {
      if (filtro.removidos ? !m.removido_em : m.removido_em) return false;
      if (filtro.classe && String(m.classe_id) !== filtro.classe) return false;
      if (filtro.deposito && String(m.deposito_id) !== filtro.deposito) return false;
      if (filtro.situacao === 'baixo' && !['baixo', 'emergencial', 'zerado'].includes(m.situacao.id)) return false;
      if (filtro.situacao && filtro.situacao !== 'baixo' && m.situacao.id !== filtro.situacao) return false;
      if (filtro.etiqueta && !m.pendente) return false;
      return palavras.every(p => m.busca.includes(p) || m.compacto.includes(p));
    }).sort((a, b) => {
      if (filtro.ordem === 'retirados') return b.rotatividade.retiradas - a.rotatividade.retiradas || a.nome.localeCompare(b.nome);
      if (filtro.ordem === 'saldo') return (a.saldo - a.estoque_minimo) - (b.saldo - b.estoque_minimo);
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }

  // -----------------------------------------------------------------
  // Lista
  // -----------------------------------------------------------------
  function resumo() {
    const lista = ativos();
    const baixos = lista.filter(m => ['baixo', 'emergencial', 'zerado'].includes(m.situacao.id)).length;
    const zerados = lista.filter(m => m.situacao.id === 'zerado').length;
    const pendentes = lista.filter(m => m.pendente).length;
    const chip = (rotulo, valor, ativo, dados, alerta = false) =>
      `<button type="button" class="chip ${ativo ? 'ativo' : ''} ${alerta && valor ? 'alerta' : ''}" ${dados}>${rotulo} <b>${valor}</b></button>`;
    return [
      chip('Todos', lista.length, !filtro.situacao && !filtro.etiqueta && !filtro.removidos, 'data-resumo="todos"'),
      chip('Estoque baixo', baixos, filtro.situacao === 'baixo', 'data-resumo="baixo"', true),
      chip('Sem estoque', zerados, filtro.situacao === 'zerado', 'data-resumo="zerado"', true),
      pode.etiqueta ? chip('Etiquetas a reimprimir', pendentes, filtro.etiqueta, 'data-resumo="etiqueta"', true) : '',
    ].join('');
  }

  function etiquetaStatus(m) {
    if (!m.etiqueta) return '<span class="pill gray">Não impressa</span>';
    if (m.pendente) return '<span class="pill low">Reimprimir</span>';
    return `<span class="pill ok" title="Impressa em ${esc(fmtDataHora(m.etiqueta.impressa_em))}">Em dia</span>`;
  }

  function linhas() {
    const lista = filtrados();
    const colunas = pode.etiqueta ? 7 : 6;
    if (!materiais.length) {
      return `<tr><td colspan="${colunas}" class="empty">${depositos.some(d => !d.removido_em)
        ? 'Nenhum material cadastrado ainda.'
        : 'Antes do primeiro material, cadastre os depósitos na página Depósitos.'}</td></tr>`;
    }
    if (!lista.length) return `<tr><td colspan="${colunas}" class="empty">Nenhum material encontrado com esses filtros.</td></tr>`;
    return lista.map(m => `
      <tr class="${m.removido_em ? 'linha-removida' : ''}">
        ${pode.etiqueta ? `<td class="col-check">${m.removido_em ? '' : `<input type="checkbox" data-selecionar="${m.id}" ${selecionados.has(m.id) ? 'checked' : ''} aria-label="Selecionar ${esc(m.nome)}">`}</td>` : ''}
        <td class="col-material">
          <button type="button" class="link-material" data-abrir="${m.id}">
            <span class="barra-classe" style="background:${esc(m.classe?.cor || '#ccc')}" aria-hidden="true"></span>
            <span><b>${esc(m.nome)}</b>
            ${m.descricao ? `<span class="desc-linha">${esc(m.descricao)}</span>` : ''}
            <span class="small muted">PRN ${esc(m.prn)} · ${esc(m.codigo)} · ${esc(m.classe?.nome || '')}</span></span>
          </button>
        </td>
        <td><span class="codigo-local">${esc(m.local)}</span><div class="small muted">${esc(m.unidade?.sigla || m.unidade?.nome || '')}</div></td>
        <td class="col-saldo"><b>${fmtQtd(m.saldo)}</b> <span class="muted">${esc(m.unidade_medida)}</span><div class="small muted">mín. ${fmtQtd(m.estoque_minimo)}${m.reservado ? ` · ${fmtQtd(m.reservado)} reservado` : ''}</div></td>
        <td><span class="pill ${m.situacao.classe}">${m.situacao.rotulo}</span>${m.criticidade === 'ALTA' ? '<div><span class="pill red pill-mini">Crítico</span></div>' : ''}</td>
        ${pode.etiqueta ? `<td>${m.removido_em ? '<span class="pill gray">Removido</span>' : etiquetaStatus(m)}</td>` : ''}
        <td><div class="acoes-linha">
          <button class="btn btn-light btn-sm" type="button" data-abrir="${m.id}">Ver</button>
          ${pode.editar && !m.removido_em ? `<button class="btn btn-ghost btn-sm" type="button" data-editar="${m.id}">Editar</button>` : ''}
        </div></td>
      </tr>`).join('');
  }

  function opcoesFiltro() {
    const classesAtivas = classes.filter(c => !c.removido_em);
    const depositosAtivos = depositos.filter(d => !d.removido_em);
    return `
      <select id="fClasse" aria-label="Filtrar por classe"><option value="">Todas as classes</option>
        ${classesAtivas.map(c => `<option value="${c.id}" ${filtro.classe === String(c.id) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
      <select id="fDeposito" aria-label="Filtrar por depósito"><option value="">Todos os depósitos</option>
        ${depositosAtivos.map(d => `<option value="${d.id}" ${filtro.deposito === String(d.id) ? 'selected' : ''}>${esc(porId.unidades.get(d.unidade_id)?.sigla || '')} ${esc(nomeDeposito(d))}</option>`).join('')}</select>
      <select id="fSituacao" aria-label="Filtrar por situação do estoque"><option value="">Qualquer estoque</option>
        ${Object.entries(SITUACOES).map(([v, t]) => `<option value="${v}" ${filtro.situacao === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="fOrdem" aria-label="Ordenar">${[['nome', 'Ordem: nome'], ['retirados', 'Ordem: mais retirados'], ['saldo', 'Ordem: mais perto do mínimo']]
        .map(([v, t]) => `<option value="${v}" ${filtro.ordem === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  }

  function desenhar() {
    el.innerHTML = `
      ${cabecalho('Materiais', 'Busque por nome, PRN, código, marca, descrição ou localização. Acentos e símbolos não atrapalham a busca.',
        pode.editar ? `<button class="btn btn-light" type="button" data-acao="etiquetas">Imprimir etiquetas<span id="qtdSelecionados"></span></button>
                       <button class="btn btn-primary" type="button" data-acao="novo">Novo material</button>` : '')}
      <div class="resumo-chips" id="resumoMateriais">${resumo()}</div>
      <section class="card card-pad">
        <div class="toolbar filtros">
          <input class="search" id="fBusca" type="search" placeholder="Buscar material" value="${esc(filtro.busca)}" aria-label="Buscar material" autocomplete="off">
          <span id="opcoesFiltro" class="opcoes-filtro">${opcoesFiltro()}</span>
          <label class="inline-check"><input type="checkbox" id="fRemovidos" ${filtro.removidos ? 'checked' : ''}> Removidos</label>
        </div>
        <div class="table-wrap">
          <table class="table tabela-materiais">
            <thead><tr>
              ${pode.etiqueta ? '<th class="col-check"><input type="checkbox" id="selecionarTodos" aria-label="Selecionar todos da lista"></th>' : ''}
              <th>Material</th><th>Localização</th><th>Saldo</th><th>Situação</th>${pode.etiqueta ? '<th>Etiqueta</th>' : ''}<th></th>
            </tr></thead>
            <tbody id="corpoMateriais">${linhas()}</tbody>
          </table>
        </div>
        <p class="small muted contagem" id="contagemMateriais"></p>
      </section>`;
    atualizarContagem();
  }

  function atualizarContagem() {
    const n = filtrados().length;
    const total = materiais.filter(m => !m.removido_em).length;
    $('#contagemMateriais', el).textContent = filtro.removidos ? `${n} removido(s)` : `${n} de ${total} materiais`;
    const qtd = $('#qtdSelecionados', el);
    if (qtd) qtd.textContent = selecionados.size ? ` (${selecionados.size})` : '';
  }

  function atualizarLista() {
    $('#corpoMateriais', el).innerHTML = linhas();
    $('#resumoMateriais', el).innerHTML = resumo();
    atualizarContagem();
  }

  function atualizarFiltros() {
    $('#opcoesFiltro', el).innerHTML = opcoesFiltro();
  }

  // -----------------------------------------------------------------
  // Detalhe do material
  // -----------------------------------------------------------------
  function valorHistorico(campo, valor) {
    if (valor === null || valor === undefined || valor === '') return 'vazio';
    if (campo === 'classe_id') return porId.classes.get(Number(valor))?.nome || `nº ${valor}`;
    if (campo === 'deposito_id') return nomeDeposito(porId.depositos.get(Number(valor))) || `nº ${valor}`;
    if (campo === 'criticidade') return CRITICIDADES[valor]?.rotulo || valor;
    if (campo === 'unidade_medida') return UNIDADES_MEDIDA[valor] ? `${UNIDADES_MEDIDA[valor]} (${valor})` : valor;
    if (campo === 'foto_path' || campo === 'fds_path') return 'arquivo enviado';
    if (campo === 'relacionados') return (valor || []).map(id => porId.materiais.get(Number(id))?.codigo || id).join(', ') || 'nenhum';
    if (campo === 'removido_em') return fmtDataHora(valor);
    return String(valor);
  }

  function blocoHistorico(registros) {
    if (!registros.length) return '<p class="muted small">Nenhuma alteração registrada.</p>';
    const acoes = { CRIOU: 'Cadastrou', EDITOU: 'Editou', REMOVEU: 'Removeu', RESTAUROU: 'Restaurou' };
    return `<ul class="linha-tempo">${registros.map(r => {
      const campos = (r.campos || []).filter(c => c !== 'removido_em' && CAMPOS_HISTORICO[c]);
      return `<li><div><b>${esc(r.usuario_nome || 'Sistema')}</b> ${acoes[r.acao] || r.acao} <span class="muted small">${fmtDataHora(r.em)}</span></div>
        ${campos.length && r.acao === 'EDITOU' ? `<ul class="mudancas">${campos.map(c => `<li><b>${CAMPOS_HISTORICO[c]}:</b> ${esc(valorHistorico(c, r.antes?.[c]))} → ${esc(valorHistorico(c, r.depois?.[c]))}</li>`).join('')}</ul>` : ''}</li>`;
    }).join('')}</ul>`;
  }

  function blocoMovimentos(movs, m) {
    if (!movs.length) return '<p class="muted small">Nenhuma movimentação ainda.</p>';
    return `<div class="table-wrap"><table class="table tabela-compacta">
      <thead><tr><th>Data</th><th>Tipo</th><th>Quantidade</th><th>Saldo</th><th>Quem</th><th>Motivo</th></tr></thead>
      <tbody>${movs.map(x => `<tr>
        <td class="nowrap">${fmtDataHora(x.em)}</td>
        <td>${esc(TIPOS_MOVIMENTO[x.tipo] || x.tipo)}</td>
        <td class="nowrap ${x.variacao < 0 ? 'negativo' : 'positivo'}">${x.variacao > 0 ? '+' : ''}${fmtQtd(x.variacao)} ${esc(m.unidade_medida)}</td>
        <td class="nowrap">${fmtQtd(x.saldo_depois)}</td>
        <td>${esc(x.usuario_nome || '')}</td>
        <td>${esc(x.motivo || x.documento || '')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function chipsMateriais(lista) {
    return lista.map(x => `<button type="button" class="chip-material" data-ir-material="${x.id}">
      <span class="barra-classe" style="background:${esc(x.classe?.cor || '#ccc')}"></span>${esc(x.nome)} <span class="muted">${esc(x.local)}</span></button>`).join('');
  }

  async function conteudoDetalhe(m) {
    const [movs, hist] = await Promise.all([
      supabase.from('movimentacoes').select('*').eq('material_id', m.id).order('em', { ascending: false }).limit(30),
      supabase.from('auditoria').select('*').eq('tabela', 'materiais').eq('registro_id', String(m.id)).order('em', { ascending: false }).limit(30),
    ]);
    if (movs.error) throw movs.error;
    if (hist.error) throw hist.error;
    const relacionados = (m.relacionados || []).map(id => porId.materiais.get(id)).filter(x => x && !x.removido_em);
    const mesmaClasse = ativos().filter(x => x.classe_id === m.classe_id && x.id !== m.id && !relacionados.includes(x)).slice(0, 6);
    const foto = urlArquivo(m.foto_path);
    const embalagem = embalagemTexto(m);
    return `
      <div class="detalhe-material">
        <div class="detalhe-foto" style="--cor-classe:${esc(m.classe?.cor || '#ccc')}">
          ${foto ? `<img src="${esc(foto)}" alt="Foto de ${esc(m.nome)}">` : `<div class="sem-foto">Sem foto</div>`}
        </div>
        <div class="detalhe-principal">
          <div class="detalhe-pills">${pillCor(m.classe?.nome || 'Sem classe', m.classe?.cor)}
            <span class="pill ${m.situacao.classe}">${m.situacao.rotulo}</span>
            <span class="pill ${CRITICIDADES[m.criticidade].classe}">Criticidade ${CRITICIDADES[m.criticidade].rotulo.toLowerCase()}</span>
            ${m.removido_em ? '<span class="pill gray">Removido</span>' : ''}</div>
          ${m.descricao ? `<p class="detalhe-desc">${esc(m.descricao)}</p>` : ''}
          <dl class="ficha">
            <div><dt>PRN</dt><dd>${esc(m.prn)}</dd></div>
            <div><dt>Código</dt><dd>${esc(m.codigo)}</dd></div>
            <div><dt>Marca</dt><dd>${esc(m.marca || 'Não informada')}</dd></div>
            <div><dt>Unidade de controle</dt><dd>${esc(UNIDADES_MEDIDA[m.unidade_medida] || m.unidade_medida)} (${esc(m.unidade_medida)})${embalagem ? `<br><span class="small">${esc(embalagem)}</span>` : ''}</dd></div>
            <div><dt>Peso bruto</dt><dd>${m.peso_kg ? fmtQtd(m.peso_kg) + ' kg' : 'Não informado'}</dd></div>
            <div><dt>EPI necessário</dt><dd>${esc(m.epi || 'Nenhum informado')}</dd></div>
          </dl>
          ${m.fds_path ? `<a class="btn btn-light btn-sm" href="${esc(urlArquivo(m.fds_path))}" target="_blank" rel="noopener">Abrir ficha de segurança (PDF)</a>` : ''}
        </div>
      </div>
      <div class="detalhe-blocos">
        <div class="bloco-info"><span>Localização</span><b class="codigo-local grande">${esc(m.local)}</b>
          <small>${esc(m.unidade?.nome || '')} · ${esc(nomeDeposito(m.deposito))} · ${esc(TIPOS_ARMAZENAGEM[m.deposito?.tipo_armazenagem] || '')}</small></div>
        <div class="bloco-info"><span>Saldo</span><b>${fmtQtd(m.saldo)} <small>${esc(m.unidade_medida)}</small></b>
          <small>Disponível ${fmtQtd(m.disponivel)}${m.reservado ? ` (${fmtQtd(m.reservado)} reservado em pedidos)` : ''} · mínimo ${fmtQtd(m.estoque_minimo)}${Number(m.saldo_emergencial) > 0 ? ` · emergencial ${fmtQtd(m.saldo_emergencial)}` : ''}</small>
          <small>Rotatividade (90 dias): <b>${NIVEIS_ROT[m.rotatividade.nivel]}</b>, ${m.rotatividade.retiradas} retirada(s)</small></div>
        <div class="bloco-info"><span>Etiqueta</span><b>${!m.etiqueta ? 'Não impressa' : m.pendente ? 'Reimprimir' : 'Em dia'}</b>
          <small>${m.etiqueta ? `Impressa em ${esc(fmtDataHora(m.etiqueta.impressa_em))} por ${esc(m.etiqueta.impressa_por_nome || '')}` : 'Nenhuma etiqueta impressa ainda'}</small></div>
      </div>
      ${relacionados.length ? `<h3 class="detalhe-titulo">Itens relacionados</h3><div class="chips-materiais">${chipsMateriais(relacionados)}</div>` : ''}
      ${mesmaClasse.length ? `<h3 class="detalhe-titulo">Outros da classe ${esc(m.classe?.nome || '')}</h3><div class="chips-materiais">${chipsMateriais(mesmaClasse)}</div>` : ''}
      <h3 class="detalhe-titulo">Movimentações</h3>${blocoMovimentos(movs.data, m)}
      <h3 class="detalhe-titulo">Quem cadastrou e alterou</h3>${blocoHistorico(hist.data)}`;
  }

  function rodapeDetalhe(m) {
    const botoes = ['<button class="btn btn-ghost" type="button" data-fechar>Fechar</button>'];
    if (m.removido_em) {
      if (pode.editar) botoes.push(`<button class="btn btn-light" type="button" data-det="restaurar">Restaurar</button>`);
    } else {
      if (pode.editar) botoes.push(`<button class="btn btn-ghost" type="button" data-det="remover">Remover</button>`);
      if (pode.editar) botoes.push(`<button class="btn btn-light" type="button" data-det="devolver">Registrar devolução</button>`);
      if (pode.ajustar) botoes.push(`<button class="btn btn-light" type="button" data-det="ajustar">Ajustar saldo</button>`);
      if (pode.etiqueta) botoes.push(`<button class="btn btn-light" type="button" data-det="etiqueta">Imprimir etiqueta</button>`);
      if (pode.editar) botoes.push(`<button class="btn btn-primary" type="button" data-det="editar">Editar</button>`);
    }
    return botoes.join('');
  }

  async function abrirDetalhe(id) {
    let m = porId.materiais.get(id);
    if (!m) return toast('Material não encontrado.', 'erro');
    history.replaceState(null, '', `#/materiais/${encodeURIComponent(m.codigo)}`);
    const fundo = abrirModal({
      titulo: esc(m.nome),
      subtitulo: `${esc(m.codigo)} · PRN ${esc(m.prn)}`,
      largo: true,
      corpo: '<div class="carregando">Carregando...</div>',
      rodape: rodapeDetalhe(m),
      aoFechar: () => { if (/^#\/materiais\//.test(location.hash)) history.replaceState(null, '', '#/materiais'); },
    });
    const corpo = $('.modal-body', fundo);
    const redesenhar = async () => {
      m = porId.materiais.get(id);
      if (!m || !document.body.contains(fundo)) return;
      const rolagem = corpo.scrollTop;
      corpo.innerHTML = await conteudoDetalhe(m);
      $('#modalTitulo', fundo).textContent = m.nome;
      $('.modal-foot', fundo).innerHTML = rodapeDetalhe(m);
      corpo.scrollTop = rolagem;
    };
    try {
      await redesenhar();
    } catch (erro) {
      corpo.innerHTML = `<p class="form-erro">${esc(erroAmigavel(erro))}</p>`;
    }
    const parar = ouvir(['materiais', 'movimentacoes', 'etiquetas', 'auditoria', 'classes', 'depositos'], async () => {
      await carregar();
      atualizarLista();
      await redesenhar();
    });
    aoFecharModal(fundo, parar);

    fundo.addEventListener('click', e => {
      const ir = e.target.closest('[data-ir-material]');
      if (ir) return abrirDetalhe(Number(ir.dataset.irMaterial));
      const acao = e.target.closest('[data-det]')?.dataset.det;
      if (!acao) return;
      if (acao === 'editar') abrirFormulario(m);
      if (acao === 'ajustar') abrirAjuste(m);
      if (acao === 'devolver') abrirDevolucao(m);
      if (acao === 'etiqueta') abrirImpressao([m]);
      if (acao === 'remover') removerMaterial(m);
      if (acao === 'restaurar') restaurarMaterial(m);
    });
  }

  // -----------------------------------------------------------------
  // Cadastro e edição
  // -----------------------------------------------------------------
  function ocupante(depositoId, prat, lado, andar, pos, ignorar) {
    return ativos().find(x => x.id !== ignorar && x.deposito_id === depositoId && x.prateleira === prat
      && x.lado === lado && x.andar === andar && x.posicao === pos);
  }

  // Primeira posição livre seguindo o POP: pesados embaixo, críticos em altura
  // de fácil acesso, leves e pouco críticos em cima.
  function sugerirPosicao(deposito, { peso, criticidade }, ignorar) {
    const andares = Array.from({ length: deposito.andares }, (_, i) => i + 1);
    let ordem;
    if (peso >= config.pesoPesado) ordem = andares.filter(a => a <= config.andarMaxPesado);
    else if (criticidade === 'ALTA') ordem = [...andares].sort((a, b) => Math.abs(a - 2) - Math.abs(b - 2) || a - b);
    else if (criticidade === 'BAIXA') ordem = [...andares].reverse();
    else ordem = andares;
    for (const andar of ordem) {
      for (let prat = 1; prat <= deposito.prateleiras; prat++) {
        for (const lado of deposito.lados) {
          for (let pos = 1; pos <= deposito.posicoes; pos++) {
            if (!ocupante(deposito.id, prat, lado, andar, pos, ignorar)) return { prat, lado, andar, pos };
          }
        }
      }
    }
    return null;
  }

  const numeros = (max, atual, rotulo = n => n) =>
    Array.from({ length: max || 0 }, (_, i) => i + 1).map(n => `<option value="${n}" ${Number(atual) === n ? 'selected' : ''}>${rotulo(n)}</option>`).join('');

  function opcoesUnidadeMedida(atual, vazio = false) {
    return (vazio ? '<option value="">Sem embalagem</option>' : '') + Object.entries(UNIDADES_MEDIDA)
      .map(([v, t]) => `<option value="${v}" ${atual === v ? 'selected' : ''}>${t} (${v})</option>`).join('');
  }

  function abrirFormulario(m = null) {
    const unidadesComDeposito = unidades.filter(u => !u.removido_em && depositos.some(d => !d.removido_em && d.unidade_id === u.id));
    if (!m && !unidadesComDeposito.length) {
      return mostrarConcluido('Falta cadastrar um depósito', '<p>Antes do primeiro material, cadastre pelo menos um depósito na página <b>Depósitos</b>. É lá que ficam as prateleiras, os lados, os andares e as posições.</p>');
    }
    const meuId = estado.perfil?.id;
    const inicial = m || {};
    let relacionados = [...(m?.relacionados || [])];
    let unidadeAtual = m?.deposito?.unidade_id || unidadesComDeposito[0]?.id;

    const fundo = abrirModal({
      titulo: m ? 'Editar material' : 'Novo material',
      subtitulo: m ? `${esc(m.codigo)}. O código não muda.` : 'O código do material é criado ao salvar.',
      largo: true,
      corpo: `<form id="formMaterial" novalidate>
        <div class="aviso-concorrencia" id="mAvisoOutro" hidden></div>
        <div class="form-section primeira"><h3>Identificação</h3>
          <div class="fields">
            <div class="field wide"><label for="mNome">Nome do material *</label><input id="mNome" maxlength="120" required value="${esc(inicial.nome || '')}" placeholder="Ex.: Parafuso sextavado 8 x 50 mm"></div>
            <div class="field"><label for="mPrn">PRN *</label><input id="mPrn" maxlength="40" required value="${esc(inicial.prn || '')}" autocomplete="off"></div>
            <div class="field"><label for="mClasse">Classe *</label><select id="mClasse"></select><small class="dica" id="mClassePrevia"></small></div>
            <div class="field"><label for="mMarca">Marca</label><input id="mMarca" maxlength="60" value="${esc(inicial.marca || '')}"></div>
            <div class="field"><label for="mUnidade">Unidade de controle *</label><select id="mUnidade">${opcoesUnidadeMedida(inicial.unidade_medida || 'un')}</select></div>
            <div class="field wide"><label for="mDescricao">Descrição e para que serve</label><textarea id="mDescricao" maxlength="300" rows="2" placeholder="Ex.: aço carbono zincado, para manutenção mecânica">${esc(inicial.descricao || '')}</textarea><small class="dica">Aparece na lista de materiais e na etiqueta.</small></div>
          </div>
        </div>
        <div class="form-section"><h3>Estoque</h3>
          <div class="fields campos-3">
            ${m ? '' : `<div class="field"><label for="mSaldo">Saldo inicial *</label><input id="mSaldo" type="number" min="0" step="any" value="0"></div>`}
            <div class="field"><label for="mMinimo">Estoque mínimo *</label><input id="mMinimo" type="number" min="0" step="any" value="${esc(inicial.estoque_minimo ?? 0)}"></div>
            <div class="field"><label for="mEmergencial">Saldo emergencial</label><input id="mEmergencial" type="number" min="0" step="any" value="${esc(inicial.saldo_emergencial ?? 0)}"><small class="dica">Reserva para urgências.</small></div>
            <div class="field"><label for="mCriticidade">Criticidade *</label><select id="mCriticidade">${Object.entries(CRITICIDADES).map(([v, c]) => `<option value="${v}" ${(inicial.criticidade || 'MEDIA') === v ? 'selected' : ''}>${c.rotulo}</option>`).join('')}</select></div>
            <div class="field wide"><label for="mEmbQtd">Embalagem (opcional)</label>
              <div class="linha-embalagem"><span>1 <b id="mUnidadeTexto">${esc(inicial.unidade_medida || 'un')}</b> contém</span>
                <input id="mEmbQtd" type="number" min="0" step="any" value="${esc(inicial.embalagem_qtd ?? '')}" placeholder="100" aria-label="Quantidade na embalagem">
                <select id="mEmbUnidade" aria-label="Unidade dentro da embalagem">${opcoesUnidadeMedida(inicial.embalagem_unidade || '', true)}</select></div>
              <small class="dica">Ex.: 1 caixa contém 100 unidades. Evita confundir "5 caixas" com "5 unidades".</small></div>
          </div>
          ${m ? '<p class="small muted">O saldo muda só por movimentação: recebimento, retirada ou ajuste autorizado.</p>' : ''}
        </div>
        <div class="form-section"><h3>Localização</h3>
          <div class="fields campos-local">
            <div class="field"><label for="mUnidadeFilial">Unidade</label><select id="mUnidadeFilial"></select></div>
            <div class="field"><label for="mDeposito">Depósito *</label><select id="mDeposito"></select></div>
            <div class="field"><label for="mPrat">Prateleira</label><select id="mPrat"></select></div>
            <div class="field"><label for="mLado">Lado</label><select id="mLado"></select></div>
            <div class="field"><label for="mAndar">Andar</label><select id="mAndar"></select></div>
            <div class="field"><label for="mPos">Posição</label><select id="mPos"></select></div>
          </div>
          <div class="previa-local">
            <div><span>Código de localização</span><b id="mCodigoLocal" class="codigo-local grande"></b><small id="mStatusLocal"></small></div>
            <button class="btn btn-light" type="button" data-sugerir>Sugerir posição livre</button>
          </div>
          <div id="mAvisosLocal" class="avisos-classe"></div>
        </div>
        <div class="form-section"><h3>Segurança e peso</h3>
          <div class="fields">
            <div class="field"><label for="mPeso">Peso bruto (kg)</label><input id="mPeso" type="number" min="0" step="any" value="${esc(inicial.peso_kg ?? '')}"><small class="dica">Aparece no pedido. Itens a partir de ${fmtQtd(config.pesoPesado)} kg ficam até o andar ${config.andarMaxPesado}.</small></div>
            <div class="field"><label for="mEpi">EPI necessário</label><input id="mEpi" maxlength="120" value="${esc(inicial.epi || '')}" placeholder="Ex.: luva nitrílica e óculos"></div>
            <div class="field wide"><label for="mFds">Ficha de segurança (PDF)</label><input id="mFds" type="file" accept="application/pdf">
              ${m?.fds_path ? `<label class="inline-check"><input type="checkbox" id="mFdsRemover"> Remover a ficha atual (<a href="${esc(urlArquivo(m.fds_path))}" target="_blank" rel="noopener">abrir</a>)</label>` : ''}
              <small class="dica">Para químicos. A cor da etiqueta não substitui a identificação de segurança do produto.</small></div>
          </div>
        </div>
        <div class="form-section"><h3>Foto e itens relacionados</h3>
          <div class="fields">
            <div class="field"><label for="mFoto">Foto do material</label><input id="mFoto" type="file" accept="image/*" capture="environment">
              ${m?.foto_path ? `<div class="foto-atual"><img src="${esc(urlArquivo(m.foto_path))}" alt=""><label class="inline-check"><input type="checkbox" id="mFotoRemover"> Remover a foto atual</label></div>` : ''}
              <small class="dica">No celular, abre a câmera. A foto é reduzida antes de enviar.</small></div>
            <div class="field"><label for="mRelBusca">Itens relacionados</label>
              <div class="linha-senha"><input id="mRelBusca" list="mRelLista" placeholder="Digite o nome ou o código" autocomplete="off" data-nao-altera><button class="btn btn-light" type="button" data-rel-add>Adicionar</button></div>
              <datalist id="mRelLista"></datalist>
              <div class="chips-materiais" id="mRelChips"></div>
            </div>
          </div>
        </div>
        <p class="form-erro" id="mErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formMaterial">${m ? 'Salvar alterações' : 'Cadastrar material'}</button>`,
    });

    const campo = id => $('#' + id, fundo);
    const valorNum = id => (campo(id).value === '' ? null : Number(campo(id).value));
    const local = () => ({
      deposito: porId.depositos.get(Number(campo('mDeposito').value)),
      prat: Number(campo('mPrat').value), lado: campo('mLado').value,
      andar: Number(campo('mAndar').value), pos: Number(campo('mPos').value),
    });

    function preencherClasses() {
      const atual = campo('mClasse').value || String(inicial.classe_id || '');
      const lista = classes.filter(c => !c.removido_em || c.id === inicial.classe_id);
      campo('mClasse').innerHTML = '<option value="">Escolha a classe</option>' + lista
        .map(c => `<option value="${c.id}" ${String(c.id) === atual ? 'selected' : ''}>${esc(c.nome)}${c.removido_em ? ' (removida)' : ''}</option>`).join('');
      const c = porId.classes.get(Number(campo('mClasse').value));
      campo('mClassePrevia').innerHTML = c ? `Cor da etiqueta: ${pillCor(c.nome, c.cor, 'pill-mini')}` : '';
    }

    function preencherUnidades() {
      const lista = unidades.filter(u => !u.removido_em && depositos.some(d => !d.removido_em && d.unidade_id === u.id));
      campo('mUnidadeFilial').innerHTML = lista.map(u => `<option value="${u.id}" ${u.id === unidadeAtual ? 'selected' : ''}>${esc(u.nome)}</option>`).join('');
      unidadeAtual = Number(campo('mUnidadeFilial').value) || unidadeAtual;
    }

    function preencherDepositos() {
      const atual = campo('mDeposito').value || String(inicial.deposito_id || '');
      const lista = depositos.filter(d => d.unidade_id === unidadeAtual && (!d.removido_em || d.id === inicial.deposito_id));
      campo('mDeposito').innerHTML = lista.map(d => {
        const aceitas = d.classes_permitidas?.length ? ` (só ${d.classes_permitidas.map(id => porId.classes.get(id)?.nome).filter(Boolean).join(', ')})` : '';
        return `<option value="${d.id}" ${String(d.id) === atual ? 'selected' : ''}>${esc(nomeDeposito(d))}${esc(aceitas)}</option>`;
      }).join('');
      preencherPosicoes();
    }

    function preencherPosicoes(valores = null) {
      const d = porId.depositos.get(Number(campo('mDeposito').value));
      const atual = valores || {
        prat: campo('mPrat').value || inicial.prateleira, lado: campo('mLado').value || inicial.lado,
        andar: campo('mAndar').value || inicial.andar, pos: campo('mPos').value || inicial.posicao,
      };
      if (!d) { ['mPrat', 'mLado', 'mAndar', 'mPos'].forEach(id => { campo(id).innerHTML = ''; }); return atualizarLocal(); }
      campo('mPrat').innerHTML = numeros(d.prateleiras, atual.prat);
      campo('mLado').innerHTML = d.lados.map(l => `<option value="${l}" ${atual.lado === l ? 'selected' : ''}>Lado ${l}</option>`).join('');
      campo('mAndar').innerHTML = numeros(d.andares, atual.andar, n => (n === 1 ? '1 (mais baixo)' : n === d.andares ? `${n} (mais alto)` : n));
      campo('mPos').innerHTML = numeros(d.posicoes, atual.pos);
      atualizarLocal();
    }

    function atualizarLocal() {
      const l = local();
      const codigo = codigoLocalizacao(l.deposito?.numero, l.prat, l.lado, l.andar, l.pos);
      campo('mCodigoLocal').textContent = codigo || '—';
      const status = campo('mStatusLocal');
      const avisos = [];
      let bloqueio = '';
      if (l.deposito) {
        const outro = ocupante(l.deposito.id, l.prat, l.lado, l.andar, l.pos, m?.id);
        if (outro) bloqueio = `Posição ocupada por ${esc(outro.codigo)}, ${esc(outro.nome)}. Escolha outra ou use "Sugerir posição livre".`;
        const classeId = Number(campo('mClasse').value);
        if (classeId && l.deposito.classes_permitidas?.length && !l.deposito.classes_permitidas.includes(classeId)) {
          bloqueio = `O depósito ${esc(nomeDeposito(l.deposito))} não aceita a classe ${esc(porId.classes.get(classeId)?.nome || '')}.`;
        }
        const peso = valorNum('mPeso') || 0;
        if (peso >= config.pesoPesado && l.andar > config.andarMaxPesado) {
          avisos.push(`Material pesado (${fmtQtd(peso)} kg) no andar ${l.andar}. O POP pede os pesados na parte de baixo, até o andar ${config.andarMaxPesado}.`);
        }
        if (campo('mCriticidade').value === 'ALTA' && l.andar >= 4) {
          avisos.push('Materiais críticos devem ficar em local de fácil acesso.');
        }
        if (l.deposito.tipo_armazenagem === 'PALETE') avisos.push('Depósito de palete: a guarda é feita com empilhadeira e cinta.');
      }
      status.textContent = !l.deposito ? 'Escolha o depósito' : bloqueio ? 'Indisponível' : 'Posição livre';
      status.className = bloqueio ? 'status-ruim' : 'status-bom';
      campo('mAvisosLocal').innerHTML = (bloqueio ? `<div class="notice notice-erro">${bloqueio}</div>` : '') + avisos.map(a => `<div class="notice">${a}</div>`).join('');
      return bloqueio;
    }

    function desenharRelacionados() {
      campo('mRelChips').innerHTML = relacionados.map(id => porId.materiais.get(id)).filter(Boolean)
        .map(x => `<span class="chip-material">${esc(x.codigo)} · ${esc(x.nome)}<button type="button" data-rel-remover="${x.id}" aria-label="Tirar ${esc(x.nome)}">×</button></span>`).join('')
        || '<span class="small muted">Nenhum item relacionado.</span>';
      campo('mRelLista').innerHTML = ativos().filter(x => x.id !== m?.id && !relacionados.includes(x.id))
        .slice(0, 500).map(x => `<option value="${esc(x.codigo)} · ${esc(x.nome)}"></option>`).join('');
    }

    preencherClasses();
    preencherUnidades();
    preencherDepositos();
    desenharRelacionados();
    if (!m) {
      const d = porId.depositos.get(Number(campo('mDeposito').value));
      const sugestao = d && sugerirPosicao(d, { peso: 0, criticidade: 'MEDIA' });
      if (sugestao) preencherPosicoes(sugestao);
    }

    fundo.addEventListener('change', e => {
      const id = e.target.id;
      if (id === 'mClasse') { preencherClasses(); atualizarLocal(); }
      if (id === 'mUnidadeFilial') { unidadeAtual = Number(e.target.value); campo('mDeposito').value = ''; preencherDepositos(); }
      if (id === 'mDeposito') preencherPosicoes({ prat: 1, lado: '', andar: 1, pos: 1 });
      if (['mPrat', 'mLado', 'mAndar', 'mPos', 'mCriticidade'].includes(id)) atualizarLocal();
      if (id === 'mUnidade') campo('mUnidadeTexto').textContent = e.target.value;
    });
    fundo.addEventListener('input', e => { if (e.target.id === 'mPeso') atualizarLocal(); });
    fundo.addEventListener('click', e => {
      if (e.target.closest('[data-sugerir]')) {
        const d = local().deposito;
        if (!d) return;
        const sugestao = sugerirPosicao(d, { peso: valorNum('mPeso') || 0, criticidade: campo('mCriticidade').value }, m?.id);
        if (!sugestao) return toast('Não há posição livre adequada neste depósito.', 'erro');
        preencherPosicoes(sugestao);
        fundo.dataset.alterado = '1';
      }
      if (e.target.closest('[data-rel-add]')) {
        const texto = campo('mRelBusca').value.trim();
        const codigo = texto.split(' · ')[0].trim().toUpperCase();
        const termo = termoBusca(texto);
        const achado = ativos().find(x => x.codigo === codigo) || ativos().find(x => termo && x.busca.includes(termo));
        if (!achado || achado.id === m?.id) return toast('Material não encontrado. Escolha um da lista.', 'erro');
        if (!relacionados.includes(achado.id)) relacionados.push(achado.id);
        campo('mRelBusca').value = '';
        fundo.dataset.alterado = '1';
        desenharRelacionados();
      }
      const remover = e.target.closest('[data-rel-remover]');
      if (remover) {
        relacionados = relacionados.filter(id => id !== Number(remover.dataset.relRemover));
        fundo.dataset.alterado = '1';
        desenharRelacionados();
      }
    });

    // Tempo real: classes, depósitos e materiais novos aparecem no formulário.
    const parar = ouvir(['classes', 'depositos', 'unidades', 'materiais', 'configuracoes'], async (_tabelas, mudancas) => {
      await carregar();
      atualizarLista();
      preencherClasses();
      preencherUnidades();
      preencherDepositos();
      desenharRelacionados();
      const alteradoPorOutro = m && mudancas.some(x => x.tabela === 'materiais' && x.novo?.id === m.id && x.novo?.atualizado_por && x.novo.atualizado_por !== meuId);
      if (alteradoPorOutro) {
        const aviso = campo('mAvisoOutro');
        aviso.textContent = 'Outra pessoa alterou este material enquanto você editava. Se salvar, os seus dados substituem os dela.';
        aviso.hidden = false;
      }
    });
    aoFecharModal(fundo, parar);

    campo('formMaterial').addEventListener('submit', async e => {
      e.preventDefault();
      const erro = campo('mErro');
      const falhar = msg => { erro.textContent = msg; erro.hidden = false; erro.scrollIntoView({ block: 'nearest' }); };
      const l = local();
      const dados = {
        nome: campo('mNome').value.trim(),
        prn: campo('mPrn').value.trim(),
        classe_id: Number(campo('mClasse').value) || null,
        marca: campo('mMarca').value.trim() || null,
        descricao: campo('mDescricao').value.trim() || null,
        unidade_medida: campo('mUnidade').value,
        estoque_minimo: valorNum('mMinimo') ?? 0,
        saldo_emergencial: valorNum('mEmergencial') ?? 0,
        criticidade: campo('mCriticidade').value,
        embalagem_qtd: valorNum('mEmbQtd'),
        embalagem_unidade: campo('mEmbUnidade').value || null,
        peso_kg: valorNum('mPeso'),
        epi: campo('mEpi').value.trim() || null,
        deposito_id: l.deposito?.id || null,
        prateleira: l.prat, lado: l.lado, andar: l.andar, posicao: l.pos,
        relacionados,
      };
      if (!dados.embalagem_qtd || !dados.embalagem_unidade) { dados.embalagem_qtd = null; dados.embalagem_unidade = null; }
      if (dados.nome.length < 2) return falhar('Informe o nome do material.');
      if (!dados.prn) return falhar('Informe o PRN.');
      if (!dados.classe_id) return falhar('Escolha a classe do material.');
      if (!dados.deposito_id) return falhar('Escolha o depósito.');
      if ([dados.estoque_minimo, dados.saldo_emergencial, dados.peso_kg ?? 0].some(n => Number.isNaN(n) || n < 0)) return falhar('Os números não podem ser negativos.');
      const bloqueio = atualizarLocal();
      if (bloqueio) return falhar(bloqueio.replace(/<[^>]+>/g, ''));
      if (!m) {
        dados.saldo = valorNum('mSaldo') ?? 0;
        if (Number.isNaN(dados.saldo) || dados.saldo < 0) return falhar('O saldo inicial não pode ser negativo.');
      }
      erro.hidden = true;
      const foto = campo('mFoto').files[0];
      const fds = campo('mFds').files[0];
      const tirarFoto = campo('mFotoRemover')?.checked;
      const tirarFds = campo('mFdsRemover')?.checked;

      await executando(e.submitter, async () => {
        let id = m?.id;
        let codigo = m?.codigo;
        try {
          if (m) {
            await atualizarRegistro('materiais', m.id, dados);
          } else {
            const { data, error } = await supabase.from('materiais').insert(dados).select('id,codigo').single();
            if (error) throw error;
            id = data.id;
            codigo = data.codigo;
          }
        } catch (falha) {
          return falhar(erroAmigavel(falha));
        }
        // Arquivos depois do cadastro, porque usam o número do material no nome.
        const avisosArquivo = [];
        const arquivos = {};
        try {
          if (foto) {
            arquivos.foto_path = await enviarArquivo(`fotos/${id}-${Date.now()}.jpg`, await prepararImagem(foto));
          } else if (tirarFoto) arquivos.foto_path = null;
        } catch (falha) { avisosArquivo.push(`a foto não foi enviada (${erroAmigavel(falha)})`); }
        try {
          if (fds) arquivos.fds_path = await enviarArquivo(`fds/${id}-${Date.now()}.pdf`, fds);
          else if (tirarFds) arquivos.fds_path = null;
        } catch (falha) { avisosArquivo.push(`a ficha de segurança não foi enviada (${erroAmigavel(falha)})`); }
        if (Object.keys(arquivos).length) {
          try {
            await atualizarRegistro('materiais', id, arquivos);
            if ('foto_path' in arquivos) apagarArquivo(m?.foto_path);
            if ('fds_path' in arquivos) apagarArquivo(m?.fds_path);
          } catch (falha) { avisosArquivo.push(erroAmigavel(falha)); }
        }
        fecharModal(true);
        await carregar();
        atualizarLista();
        if (avisosArquivo.length) toast(`Material salvo, mas ${avisosArquivo.join(' e ')}.`, 'erro');
        if (m) {
          toast('Alterações salvas.');
        } else {
          const novo = porId.materiais.get(id);
          mostrarConcluido('Material cadastrado', `<p><b>${esc(dados.nome)}</b> recebeu o código <b>${esc(codigo)}</b>.</p>
            <p>Localização: <b class="codigo-local">${esc(novo?.local || '')}</b></p>
            ${pode.etiqueta ? '<p class="small muted">Para imprimir a etiqueta, abra o material e use "Imprimir etiqueta", ou marque vários na lista e use "Imprimir etiquetas".</p>' : ''}`);
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // Ajuste de saldo (gestor e master)
  // -----------------------------------------------------------------
  function abrirAjuste(m) {
    const fundo = abrirModal({
      titulo: 'Ajustar saldo',
      subtitulo: `${esc(m.codigo)} · ${esc(m.nome)}`,
      pequeno: true,
      corpo: `<form id="formAjuste" novalidate>
        <p>Saldo atual: <b>${fmtQtd(m.saldo)} ${esc(m.unidade_medida)}</b></p>
        <div class="fields">
          <div class="field"><label for="aNovo">Novo saldo *</label><input id="aNovo" type="number" min="0" step="any" value="${esc(m.saldo)}"></div>
          <div class="field"><label>Diferença</label><div class="previa-classe"><b id="aDiferenca">0</b></div></div>
          <div class="field wide"><label for="aMotivo">Motivo *</label><textarea id="aMotivo" rows="3" maxlength="300" placeholder="Ex.: contagem do inventário de novembro, divergência registrada no relatório 12"></textarea></div>
        </div>
        <p class="small muted">O ajuste fica registrado com o seu nome, a data e o motivo. Use para corrigir divergências de contagem.</p>
        <p class="form-erro" id="aErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formAjuste">Registrar ajuste</button>`,
    });
    const novo = $('#aNovo', fundo);
    novo.addEventListener('input', () => {
      const dif = Number(novo.value) - Number(m.saldo);
      $('#aDiferenca', fundo).textContent = Number.isNaN(dif) ? '—' : `${dif > 0 ? '+' : ''}${fmtQtd(dif)} ${m.unidade_medida}`;
    });
    $('#formAjuste', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#aErro', fundo);
      await executando(e.submitter, async () => {
        const { error } = await supabase.rpc('ajustar_saldo', { p_material: m.id, p_novo_saldo: Number(novo.value), p_motivo: $('#aMotivo', fundo).value.trim() });
        if (error) { erro.textContent = erroAmigavel(error); erro.hidden = false; return; }
        fecharModal(true);
        toast('Ajuste registrado.');
        await carregar();
        atualizarLista();
        abrirDetalhe(m.id);
      });
    });
  }

  // Devolução avulsa (sem pedido). Para devolver um item de pedido, use a página Pedidos.
  function abrirDevolucao(m) {
    const fundo = abrirModal({
      titulo: 'Registrar devolução',
      subtitulo: `${esc(m.codigo)} · ${esc(m.nome)}`,
      pequeno: true,
      corpo: `<form id="formDev" novalidate>
        <div class="fields">
          <div class="field"><label for="dQtd">Quantidade devolvida (${esc(m.unidade_medida)}) *</label><input id="dQtd" type="number" min="0" step="any"></div>
          <div class="field wide"><label for="dMotivo">Motivo *</label><input id="dMotivo" maxlength="160" placeholder="Ex.: sobrou na manutenção da linha 2"></div>
        </div>
        <p class="small muted">Se o material saiu por um pedido, prefira devolver pelo próprio pedido, na página Pedidos.</p>
        <p class="form-erro" id="dErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button><button class="btn btn-primary" type="submit" form="formDev">Registrar devolução</button>`,
    });
    $('#formDev', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      await executando(e.submitter, async () => {
        const { error } = await supabase.rpc('registrar_devolucao', { p_material: m.id, p_quantidade: Number($('#dQtd', fundo).value), p_motivo: $('#dMotivo', fundo).value });
        if (error) { const x = $('#dErro', fundo); x.textContent = erroAmigavel(error); x.hidden = false; return; }
        fecharModal(true);
        toast('Devolução registrada. O saldo voltou para o estoque.');
        await carregar();
        atualizarLista();
        abrirDetalhe(m.id);
      });
    });
  }

  async function removerMaterial(m) {
    if (Number(m.saldo) > 0) {
      return toast(`Este material ainda tem saldo de ${fmtQtd(m.saldo)} ${m.unidade_medida}. Zere o saldo com um ajuste antes de remover.`, 'erro');
    }
    if (!window.confirm(`Remover ${m.nome}? A posição ${m.local} fica livre. O histórico continua guardado e o material pode ser restaurado.`)) return;
    try {
      await atualizarRegistro('materiais', m.id, { removido_em: new Date().toISOString() });
      fecharModal(true);
      toast('Material removido.');
      await carregar();
      atualizarLista();
    } catch (erro) {
      toast(erroAmigavel(erro), 'erro');
    }
  }

  async function restaurarMaterial(m) {
    try {
      await atualizarRegistro('materiais', m.id, { removido_em: null });
      toast('Material restaurado.');
      await carregar();
      atualizarLista();
      abrirDetalhe(m.id);
    } catch (erro) {
      toast(/posicao/.test(erro.message) ? `A posição ${m.local} já está ocupada. Edite o material e escolha outra posição antes de restaurar.` : erroAmigavel(erro), 'erro');
    }
  }

  // -----------------------------------------------------------------
  // Etiquetas
  // -----------------------------------------------------------------
  function abrirImpressao(lista) {
    if (!lista.length) {
      const pendentes = ativos().filter(x => x.pendente);
      if (!pendentes.length) return toast('Marque os materiais na lista ou abra um material para imprimir a etiqueta.', 'erro');
      lista = pendentes;
    }
    const fundo = abrirModal({
      titulo: lista.length === 1 ? 'Imprimir etiqueta' : `Imprimir ${lista.length} etiquetas`,
      subtitulo: lista.length === 1 ? esc(lista[0].nome) : (selecionados.size ? 'Materiais selecionados na lista.' : 'Todas as etiquetas que precisam ser reimpressas.'),
      pequeno: true,
      corpo: `<form id="formEtiqueta">
        <div class="opcoes-acesso">${Object.entries(FORMATOS).map(([v, f], i) => `
          <label class="opcao-acesso"><input type="radio" name="formato" value="${v}" ${i === 0 ? 'checked' : ''}><span><b>${f.rotulo}</b><small>${f.descricao}</small></span></label>`).join('')}
        </div>
        <p class="small muted">Abre uma página com a prévia. Depois de imprimir, as etiquetas ficam marcadas como em dia.</p>
        <p class="form-erro" id="eErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formEtiqueta">Abrir para imprimir</button>`,
    });
    $('#formEtiqueta', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const formato = fundo.querySelector('input[name=formato]:checked').value;
      let janela;
      try {
        janela = abrirJanelaEtiquetas();
      } catch (erro) {
        const caixa = $('#eErro', fundo);
        caixa.textContent = erro.message;
        caixa.hidden = false;
        return;
      }
      const itens = lista.map(x => porId.materiais.get(x.id) || x);
      fecharModal(true);
      await montarEtiquetas(janela, itens, formato, {
        impressoPor: estado.perfil?.nome,
        aoImprimir: async () => {
          const { error } = await supabase.rpc('registrar_etiquetas', {
            p_itens: itens.map(x => ({ material_id: x.id, dados: dadosEtiqueta(x) })),
          });
          if (error) return toast(erroAmigavel(error), 'erro');
          itens.forEach(x => selecionados.delete(x.id));
          await carregar();
          atualizarLista();
          toast(itens.length === 1 ? 'Etiqueta marcada como impressa.' : `${itens.length} etiquetas marcadas como impressas.`);
        },
      });
    });
  }

  // -----------------------------------------------------------------
  // Início e eventos
  // -----------------------------------------------------------------
  await carregar();
  desenhar();

  el.addEventListener('input', e => {
    if (e.target.id === 'fBusca') { filtro.busca = e.target.value; atualizarLista(); }
  });
  el.addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'fClasse') filtro.classe = e.target.value;
    if (id === 'fDeposito') filtro.deposito = e.target.value;
    if (id === 'fSituacao') { filtro.situacao = e.target.value; filtro.etiqueta = false; }
    if (id === 'fRemovidos') filtro.removidos = e.target.checked;
    if (id === 'fOrdem') filtro.ordem = e.target.value;
    if (id === 'selecionarTodos') {
      filtrados().filter(x => !x.removido_em).forEach(x => (e.target.checked ? selecionados.add(x.id) : selecionados.delete(x.id)));
    }
    const marcar = e.target.dataset.selecionar;
    if (marcar) {
      if (e.target.checked) selecionados.add(Number(marcar));
      else selecionados.delete(Number(marcar));
      return atualizarContagem();
    }
    if (['fClasse', 'fDeposito', 'fSituacao', 'fRemovidos', 'fOrdem', 'selecionarTodos'].includes(id)) atualizarLista();
  });
  el.addEventListener('click', e => {
    const resumoBotao = e.target.closest('[data-resumo]');
    if (resumoBotao) {
      const r = resumoBotao.dataset.resumo;
      filtro.situacao = r === 'baixo' || r === 'zerado' ? r : '';
      filtro.etiqueta = r === 'etiqueta';
      filtro.removidos = false;
      $('#fRemovidos', el).checked = false;
      atualizarFiltros();
      return atualizarLista();
    }
    const ver = e.target.closest('[data-abrir]');
    if (ver) return abrirDetalhe(Number(ver.dataset.abrir));
    const editar = e.target.closest('[data-editar]');
    if (editar) return abrirFormulario(porId.materiais.get(Number(editar.dataset.editar)));
    const acao = e.target.closest('[data-acao]')?.dataset.acao;
    if (acao === 'novo') abrirFormulario();
    if (acao === 'etiquetas') abrirImpressao([...selecionados].map(id => porId.materiais.get(id)).filter(Boolean));
  });

  // Tempo real na lista.
  ctx.aoSair(ouvir(['materiais', 'classes', 'depositos', 'unidades', 'etiquetas', 'configuracoes', 'pedidos', 'pedido_itens'], async tabelas => {
    if (!ctx.ativa()) return;
    await carregar();
    if (tabelas.has('classes') || tabelas.has('depositos') || tabelas.has('unidades')) atualizarFiltros();
    atualizarLista();
  }));

  // Aberto pelo QR da etiqueta: #/materiais/MAT-000123
  if (ctx.parametro) {
    const alvo = materiais.find(x => x.codigo === decodeURIComponent(ctx.parametro).toUpperCase());
    if (alvo) abrirDetalhe(alvo.id);
    else toast('Material do QR não encontrado.', 'erro');
  }
}
