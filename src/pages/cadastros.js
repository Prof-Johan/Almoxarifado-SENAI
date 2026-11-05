import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, abrirModal, fecharModal, executando, erroAmigavel, toast } from '../lib/ui.js';
import { atualizarRegistro, criarRegistro } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { pillCor } from '../lib/materiais.js';

const TIPOS = {
  unidades: {
    titulo: 'Unidades',
    singular: 'unidade',
    descricao: 'Filiais onde o almoxarifado funciona.',
    criado: 'Unidade adicionada.',
    exemplo: 'Ex.: Otacílio Costa',
    temSigla: true,
  },
  setores: {
    titulo: 'Setores',
    singular: 'setor',
    descricao: 'Cada setor é um centro de custo. Defina as classes que ele pode pedir: o solicitante só vê e pede materiais dessas classes.',
    criado: 'Setor adicionado.',
    exemplo: 'Ex.: Manutenção elétrica',
    temSigla: false,
  },
};

export async function montar(el, ctx) {
  const dados = { unidades: [], setores: [] };
  let classes = [];
  let mostrarRemovidos = false;

  async function carregar() {
    const [u, s, c] = await Promise.all([
      supabase.from('unidades').select('*').order('nome'),
      supabase.from('setores').select('*').order('nome'),
      supabase.from('classes').select('id,nome,cor').is('removido_em', null).order('numero'),
    ]);
    classes = c.data || [];
    if (u.error) throw u.error;
    if (s.error) throw s.error;
    dados.unidades = u.data;
    dados.setores = s.data;
  }

  function bloco(tipo) {
    const t = TIPOS[tipo];
    const lista = dados[tipo].filter(x => mostrarRemovidos || !x.removido_em);
    return `<section class="card card-pad">
      <div class="bloco-topo">
        <div><h2 class="section-title">${t.titulo}</h2><p class="section-sub">${t.descricao}</p></div>
        <button class="btn btn-primary btn-sm" type="button" data-acao="novo" data-tipo="${tipo}">Adicionar</button>
      </div>
      <ul class="lista-simples">
        ${lista.map(x => `<li class="${x.removido_em ? 'removida' : ''}">
          <div><b>${esc(x.nome)}</b>${x.sigla ? ` <span class="small muted">${esc(x.sigla)}</span>` : ''}${x.codigo_centro_custo ? ` <span class="pill pill-cc pill-mini">CC ${esc(x.codigo_centro_custo)}</span>` : ''}${x.removido_em ? ' <span class="pill gray">Removido</span>' : ''}
            ${tipo === 'setores' ? `<div class="deposito-classes" style="margin-top:4px">${x.classes_permitidas?.length ? x.classes_permitidas.map(id => classes.find(c => c.id === id)).filter(Boolean).map(c => pillCor(c.nome, c.cor, 'pill-mini')).join(' ') : '<span class="small muted">Pode pedir de todas as classes</span>'}</div>` : ''}</div>
          <div class="acoes-linha">
            ${x.removido_em
              ? `<button class="btn btn-light btn-sm" type="button" data-acao="restaurar" data-tipo="${tipo}" data-id="${x.id}">Restaurar</button>`
              : `<button class="btn btn-light btn-sm" type="button" data-acao="editar" data-tipo="${tipo}" data-id="${x.id}">Editar</button>
                 <button class="btn btn-ghost btn-sm" type="button" data-acao="remover" data-tipo="${tipo}" data-id="${x.id}">Remover</button>`}
          </div>
        </li>`).join('') || `<li class="vazio">${tipo === 'unidades' ? 'Nenhuma unidade cadastrada.' : 'Nenhum setor cadastrado.'}</li>`}
      </ul>
    </section>`;
  }

  function desenhar() {
    const haRemovidos = [...dados.unidades, ...dados.setores].some(x => x.removido_em);
    el.innerHTML = `
      ${cabecalho('Unidades e setores', 'Cadastros usados nos usuários e, nas próximas entregas, nos materiais e pedidos.',
        haRemovidos ? `<button class="btn btn-ghost" type="button" data-acao="alternar">${mostrarRemovidos ? 'Esconder removidos' : 'Mostrar removidos'}</button>` : '')}
      <div class="two-col">${bloco('unidades')}${bloco('setores')}</div>`;
  }

  function abrirFormulario(tipo, registro = null) {
    const t = TIPOS[tipo];
    const fundo = abrirModal({
      titulo: registro ? `Editar ${t.singular}` : (tipo === 'unidades' ? 'Nova unidade' : 'Novo setor'),
      pequeno: tipo === 'unidades',
      corpo: `<form id="formCadastro" novalidate>
        <div class="fields">
          <div class="field ${t.temSigla ? '' : 'wide'}"><label for="cadNome">Nome *</label><input id="cadNome" maxlength="80" required value="${esc(registro?.nome || '')}" placeholder="${t.exemplo}"></div>
          ${t.temSigla ? `<div class="field"><label for="cadSigla">Sigla</label><input id="cadSigla" maxlength="6" value="${esc(registro?.sigla || '')}" placeholder="Ex.: OTC"></div>` : ''}
          ${tipo === 'setores' ? `<div class="field wide"><label for="cadCentro">Código do centro de custo</label><input id="cadCentro" maxlength="20" value="${esc(registro?.codigo_centro_custo || '')}" placeholder="Ex.: CC-1010"></div>` : ''}
        </div>
        ${tipo === 'setores' ? `<div class="form-section"><h3>Classes que o setor pode pedir</h3>
          <p class="small muted">Deixe tudo desmarcado para liberar todas. Ex.: a Elétrica pede Elétrica e Administrativo; a Mecânica pede Mecânica e Administrativo.</p>
          <div class="checks-classes">${classes.map(c => `<label class="check-classe"><input type="checkbox" name="cadClasse" value="${c.id}" ${registro?.classes_permitidas?.includes(c.id) ? 'checked' : ''}> ${pillCor(c.nome, c.cor, 'pill-mini')}</label>`).join('')}</div></div>` : ''}
        <p class="form-erro" id="cadErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formCadastro">${registro ? 'Salvar' : 'Adicionar'}</button>`,
    });
    $('#formCadastro', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#cadErro', fundo);
      const nome = $('#cadNome', fundo).value.trim();
      if (nome.length < 2) { erro.textContent = 'Informe o nome.'; erro.hidden = false; return; }
      const valores = { nome };
      if (t.temSigla) valores.sigla = $('#cadSigla', fundo).value.trim().toUpperCase() || null;
      if (tipo === 'setores') {
        valores.codigo_centro_custo = $('#cadCentro', fundo).value.trim() || null;
        valores.classes_permitidas = [...fundo.querySelectorAll('input[name=cadClasse]:checked')].map(x => Number(x.value));
      }
      await executando(e.submitter, async () => {
        try {
          if (registro) await atualizarRegistro(tipo, registro.id, valores);
          else await criarRegistro(tipo, valores);
          fecharModal(true);
          toast(registro ? 'Alterações salvas.' : t.criado);
          await carregar();
          desenhar();
        } catch (falha) {
          erro.textContent = erroAmigavel(falha);
          erro.hidden = false;
        }
      });
    });
  }

  async function alterarRemocao(tipo, registro, remover) {
    const t = TIPOS[tipo];
    if (remover && !window.confirm(`Remover ${registro.nome}? Os usuários já ligados a esse cadastro continuam ligados a ele. Dá para restaurar depois.`)) return;
    try {
      await atualizarRegistro(tipo, registro.id, { removido_em: remover ? new Date().toISOString() : null });
      toast(remover ? 'Removido.' : 'Restaurado.');
      await carregar();
      desenhar();
    } catch (falha) {
      toast(erroAmigavel(falha), 'erro');
    }
  }

  await carregar();
  desenhar();

  ctx.aoSair(ouvir(['unidades', 'setores', 'classes'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    desenhar();
  }));

  el.addEventListener('click', e => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const { acao, tipo, id } = botao.dataset;
    const registro = tipo ? dados[tipo].find(x => String(x.id) === id) : null;
    if (acao === 'alternar') { mostrarRemovidos = !mostrarRemovidos; desenhar(); }
    else if (acao === 'novo') abrirFormulario(tipo);
    else if (acao === 'editar' && registro) abrirFormulario(tipo, registro);
    else if (acao === 'remover' && registro) alterarRemocao(tipo, registro, true);
    else if (acao === 'restaurar' && registro) alterarRemocao(tipo, registro, false);
  });
}
