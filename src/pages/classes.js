import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, abrirModal, fecharModal, executando, erroAmigavel, toast, contraste, fmtDataHora } from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { atualizarRegistro, criarRegistro, buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';

const corValida = c => /^#[0-9a-f]{6}$/i.test(c || '');
const normalizar = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export async function montar(el, ctx) {
  const podeEditar = nivel(ctx.perfil.perfil) >= 4;
  let classes = [];
  let quantidade = new Map();
  let mostrarRemovidas = false;

  async function carregar() {
    const [c, m] = await Promise.all([
      supabase.from('classes').select('*').order('numero'),
      buscarTodos(() => supabase.from('materiais').select('id,classe_id').is('removido_em', null).order('id')),
    ]);
    if (c.error) throw c.error;
    classes = c.data;
    quantidade = new Map();
    m.forEach(x => quantidade.set(x.classe_id, (quantidade.get(x.classe_id) || 0) + 1));
  }
  const qtd = c => quantidade.get(c.id) || 0;

  const ativas = () => classes.filter(c => !c.removido_em);
  const removidas = () => classes.filter(c => c.removido_em);

  function cartao(c) {
    const borda = c.cor.toUpperCase() === '#FFFFFF' ? '#9aabb9' : c.cor;
    const acoes = !podeEditar ? '' : c.removido_em
      ? `<button class="btn btn-light btn-sm" type="button" data-acao="restaurar" data-id="${c.id}">Restaurar</button>`
      : `<button class="btn btn-light btn-sm" type="button" data-acao="editar" data-id="${c.id}">Editar</button>
         <button class="btn btn-ghost btn-sm" type="button" data-acao="remover" data-id="${c.id}">Remover</button>`;
    return `<article class="family-card ${c.removido_em ? 'removida' : ''}">
      <div class="family-swatch" style="background:${esc(c.cor)};border-color:${esc(borda)}" aria-hidden="true"></div>
      <div class="family-content">
        <div class="family-name">${esc(c.nome)}</div>
        <div class="small muted">Nº ${c.numero} · ${esc(c.cor)} · ${qtd(c)} material(is)</div>
        ${c.descricao ? `<div class="small classe-descricao">${esc(c.descricao)}</div>` : ''}
        ${c.removido_em ? `<div class="small muted">Removida em ${fmtDataHora(c.removido_em)}</div>` : ''}
      </div>
      ${acoes ? `<div class="family-actions">${acoes}</div>` : ''}
    </article>`;
  }

  function desenhar() {
    const lista = ativas();
    el.innerHTML = `
      ${cabecalho('Classes de materiais',
        podeEditar
          ? 'Cada material recebe uma classe no cadastro, e a cor da classe vai para a etiqueta. Crie, altere ou remova as classes conforme o almoxarifado precisar.'
          : 'Cada material recebe uma destas classes no cadastro, e a cor da classe vai para a etiqueta.',
        podeEditar ? '<button class="btn btn-primary" type="button" data-acao="nova">Nova classe</button>' : '')}
      <section class="card card-pad">
        <div class="family-grid">${lista.map(cartao).join('') || '<div class="empty"><h3>Nenhuma classe cadastrada</h3><p>Crie a primeira classe para usar no cadastro de materiais.</p></div>'}</div>
        ${podeEditar && removidas().length ? `
          <div class="removidas-bloco">
            <button class="btn btn-ghost btn-sm" type="button" data-acao="alternar-removidas">${mostrarRemovidas ? 'Esconder' : 'Mostrar'} classes removidas (${removidas().length})</button>
            ${mostrarRemovidas ? `<div class="family-grid">${removidas().map(cartao).join('')}</div>` : ''}
          </div>` : ''}
      </section>`;
  }

  function previa(nome, cor) {
    const valida = corValida(cor);
    const fundo = valida ? cor : '#cfd9df';
    const borda = fundo.toUpperCase() === '#FFFFFF' ? '#9aabb9' : fundo;
    return `<span class="cat-pill" style="background:${fundo};color:${contraste(fundo)};border-color:${borda}">${esc(nome || 'Nova classe')}</span>`;
  }

  function avisos(classe, nome, cor) {
    const lista = [];
    const mesmaCor = ativas().find(c => c.id !== classe?.id && c.cor.toUpperCase() === String(cor).toUpperCase());
    if (mesmaCor) lista.push(`A cor já é usada pela classe <b>${esc(mesmaCor.nome)}</b>. Duas classes com a mesma cor atrapalham a identificação na prateleira.`);
    const mesmoNome = ativas().find(c => c.id !== classe?.id && normalizar(c.nome) === normalizar(nome));
    if (mesmoNome && nome) lista.push(`Já existe a classe <b>${esc(mesmoNome.nome)}</b>.`);
    if (classe && corValida(cor) && cor.toUpperCase() !== classe.cor.toUpperCase()) {
      lista.push(qtd(classe)
        ? `Ao mudar a cor, as etiquetas dos ${qtd(classe)} material(is) desta classe passam a aparecer como "a reimprimir".`
        : 'Ao mudar a cor, as etiquetas já impressas desta classe precisam ser reimpressas.');
    }
    return lista.map(a => `<div class="notice">${a}</div>`).join('');
  }

  function abrirFormulario(classe = null) {
    const corInicial = classe?.cor || '#F47730';
    const fundo = abrirModal({
      titulo: classe ? 'Editar classe' : 'Nova classe',
      subtitulo: classe ? `Nº ${classe.numero}. O número não muda, mesmo editando o nome ou a cor.` : 'O número da classe é criado automaticamente e nunca é reaproveitado.',
      pequeno: true,
      corpo: `<form id="formClasse" novalidate>
        <div class="fields">
          <div class="field wide"><label for="cNome">Nome da classe *</label><input id="cNome" maxlength="48" required value="${esc(classe?.nome || '')}" placeholder="Ex.: Elétrica, Ferramentas, Pneumática"></div>
          <div class="field"><label for="cCorSeletor">Cor *</label>
            <div class="linha-cor"><input id="cCorSeletor" type="color" value="${esc(corInicial)}" aria-label="Escolher cor"><input id="cCor" maxlength="7" value="${esc(corInicial)}" aria-label="Código da cor" spellcheck="false"></div>
          </div>
          <div class="field"><label>Como fica</label><div class="previa-classe" id="cPrevia">${previa(classe?.nome, corInicial)}</div></div>
          <div class="field wide"><label for="cDescricao">Descrição</label><input id="cDescricao" maxlength="160" value="${esc(classe?.descricao || '')}" placeholder="Ex.: componentes e materiais elétricos"></div>
        </div>
        <div id="cAvisos" class="avisos-classe">${avisos(classe, classe?.nome, corInicial)}</div>
        <p class="form-erro" id="cErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formClasse">${classe ? 'Salvar alterações' : 'Criar classe'}</button>`,
    });

    const atualizar = () => {
      const nome = $('#cNome', fundo).value.trim();
      const cor = $('#cCor', fundo).value.trim();
      $('#cPrevia', fundo).innerHTML = previa(nome, cor);
      $('#cAvisos', fundo).innerHTML = avisos(classe, nome, cor);
    };
    fundo.addEventListener('input', e => {
      if (e.target.id === 'cCorSeletor') $('#cCor', fundo).value = e.target.value.toUpperCase();
      if (e.target.id === 'cCor') {
        let v = e.target.value.trim();
        if (v && !v.startsWith('#')) v = '#' + v;
        if (corValida(v)) $('#cCorSeletor', fundo).value = v;
      }
      atualizar();
    });

    $('#formClasse', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#cErro', fundo);
      const nome = $('#cNome', fundo).value.trim();
      let cor = $('#cCor', fundo).value.trim();
      if (cor && !cor.startsWith('#')) cor = '#' + cor;
      const descricao = $('#cDescricao', fundo).value.trim() || null;
      const falha = nome.length < 2 ? 'Informe o nome da classe.' : !corValida(cor) ? 'A cor precisa estar no formato #RRGGBB, por exemplo #F0C51A.' : '';
      if (falha) { erro.textContent = falha; erro.hidden = false; return; }
      await executando(e.submitter, async () => {
        const dados = { nome, cor: cor.toUpperCase(), descricao };
        try {
          if (classe) await atualizarRegistro('classes', classe.id, dados);
          else await criarRegistro('classes', dados);
        } catch (falhaSalvar) {
          erro.textContent = erroAmigavel(falhaSalvar);
          erro.hidden = false;
          return;
        }
        fecharModal(true);
        toast(classe ? 'Classe atualizada.' : 'Classe criada.');
        await carregar();
        desenhar();
      });
    });
  }

  async function remover(classe) {
    const n = qtd(classe);
    if (!n) {
      if (!window.confirm(`Remover a classe ${classe.nome}? Ela deixa de aparecer no cadastro de materiais. O histórico fica guardado e a classe pode ser restaurada.`)) return;
      const { error } = await supabase.rpc('remover_classe', { p_classe: classe.id });
      if (error) return toast(erroAmigavel(error), 'erro');
      toast('Classe removida.');
      await carregar();
      return desenhar();
    }
    // Com materiais: escolher para qual classe eles vão.
    const destinos = ativas().filter(c => c.id !== classe.id);
    const fundo = abrirModal({
      titulo: `Remover a classe ${esc(classe.nome)}`,
      subtitulo: `${n} material(is) usam esta classe. Escolha para qual classe eles vão.`,
      pequeno: true,
      corpo: `<form id="formRemoverClasse" novalidate>
        <div class="field"><label for="rcDestino">Mover os materiais para *</label>
          <select id="rcDestino"><option value="">Escolha a classe</option>${destinos.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
        <p class="small muted" style="margin-top:12px">As etiquetas desses materiais passam a aparecer como "a reimprimir", porque a cor muda.</p>
        <p class="form-erro" id="rcErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-danger" type="submit" form="formRemoverClasse">Mover e remover</button>`,
    });
    $('#formRemoverClasse', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const destino = Number($('#rcDestino', fundo).value);
      const erro = $('#rcErro', fundo);
      if (!destino) { erro.textContent = 'Escolha a classe que vai receber os materiais.'; erro.hidden = false; return; }
      await executando(e.submitter, async () => {
        const { error } = await supabase.rpc('remover_classe', { p_classe: classe.id, p_destino: destino });
        if (error) { erro.textContent = erroAmigavel(error); erro.hidden = false; return; }
        fecharModal(true);
        toast('Materiais movidos e classe removida.');
        await carregar();
        desenhar();
      });
    });
  }

  async function restaurar(classe) {
    try {
      await atualizarRegistro('classes', classe.id, { removido_em: null });
    } catch (falha) {
      return toast(/classes_nome/.test(falha.message)
        ? `Não deu para restaurar: já existe outra classe chamada ${classe.nome}. Renomeie uma delas antes.`
        : erroAmigavel(falha), 'erro');
    }
    toast('Classe restaurada.');
    await carregar();
    desenhar();
  }

  await carregar();
  desenhar();

  ctx.aoSair(ouvir(['classes', 'materiais'], async () => {
    if (!ctx.ativa()) return;
    await carregar();
    desenhar();
  }));

  el.addEventListener('click', e => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const classe = classes.find(c => String(c.id) === botao.dataset.id);
    const acao = botao.dataset.acao;
    if (acao === 'nova') abrirFormulario();
    else if (acao === 'alternar-removidas') { mostrarRemovidas = !mostrarRemovidas; desenhar(); }
    else if (acao === 'editar' && classe) abrirFormulario(classe);
    else if (acao === 'remover' && classe) remover(classe);
    else if (acao === 'restaurar' && classe) restaurar(classe);
  });
}
