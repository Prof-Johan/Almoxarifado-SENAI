import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, abrirModal, aoFecharModal, fecharModal, executando, erroAmigavel, toast, contraste } from '../lib/ui.js';
import { nivel } from '../lib/permissoes.js';
import { atualizarRegistro, criarRegistro, buscarTodos } from '../lib/dados.js';
import { ouvir } from '../lib/tempoReal.js';
import { TIPOS_ARMAZENAGEM, nomeDeposito, codigoLocalizacao, pillCor, fmtQtd } from '../lib/materiais.js';

export async function montar(el, ctx) {
  const podeEditar = nivel(ctx.perfil.perfil) >= 4;
  let depositos = [];
  let unidades = [];
  let classes = [];
  let materiais = [];
  let config = { peso_pesado_kg: 15, andar_maximo_pesado: 2 };
  let mostrarRemovidos = false;

  async function carregar() {
    const [d, u, c, m, cfg] = await Promise.all([
      supabase.from('depositos').select('*').order('numero'),
      supabase.from('unidades').select('id,nome,sigla,removido_em').order('nome'),
      supabase.from('classes').select('id,nome,cor,removido_em').order('numero'),
      buscarTodos(() => supabase.from('materiais').select('id,codigo,nome,classe_id,deposito_id,prateleira,lado,andar,posicao').is('removido_em', null).order('id')),
      supabase.from('configuracoes').select('chave,valor').in('chave', ['peso_pesado_kg', 'andar_maximo_pesado']),
    ]);
    for (const r of [d, u, c, cfg]) if (r.error) throw r.error;
    depositos = d.data;
    unidades = u.data;
    classes = c.data;
    materiais = m;
    cfg.data.forEach(x => { config[x.chave] = Number(x.valor); });
  }

  const classe = id => classes.find(c => c.id === id);
  const capacidade = d => d.prateleiras * d.lados.length * d.andares * d.posicoes;
  const ocupados = d => materiais.filter(m => m.deposito_id === d.id);

  function cartao(d) {
    const qtd = ocupados(d).length;
    const total = capacidade(d);
    const pct = total ? Math.round((qtd / total) * 100) : 0;
    const aceitas = d.classes_permitidas?.length
      ? d.classes_permitidas.map(id => classe(id)).filter(Boolean).map(c => pillCor(c.nome, c.cor, 'pill-mini')).join(' ')
      : '<span class="small muted">Aceita todas as classes</span>';
    return `<article class="deposito-card ${d.removido_em ? 'removida' : ''}">
      <div class="deposito-topo">
        <div><h3>${esc(nomeDeposito(d))}</h3><p class="small muted">${esc(TIPOS_ARMAZENAGEM[d.tipo_armazenagem])}</p></div>
        ${d.removido_em ? '<span class="pill gray">Removido</span>' : `<span class="pill blue">${pct}% ocupado</span>`}
      </div>
      <p class="small">${d.prateleiras} prateleira(s) · lado${d.lados.length > 1 ? 's' : ''} ${d.lados.join(' e ')} · ${d.andares} andar(es) · ${d.posicoes} posição(ões) por andar</p>
      <div class="barra-ocupacao" role="img" aria-label="${qtd} de ${total} posições ocupadas"><span style="width:${Math.min(pct, 100)}%"></span></div>
      <p class="small muted">${qtd} de ${total} posições ocupadas</p>
      <div class="deposito-classes">${aceitas}</div>
      <div class="acoes-linha">
        ${d.removido_em
          ? (podeEditar ? `<button class="btn btn-light btn-sm" type="button" data-acao="restaurar" data-id="${d.id}">Restaurar</button>` : '')
          : `<button class="btn btn-light btn-sm" type="button" data-acao="mapa" data-id="${d.id}">Ver mapa</button>
             ${podeEditar ? `<button class="btn btn-ghost btn-sm" type="button" data-acao="editar" data-id="${d.id}">Editar</button>
             <button class="btn btn-ghost btn-sm" type="button" data-acao="remover" data-id="${d.id}">Remover</button>` : ''}`}
      </div>
    </article>`;
  }

  function desenhar() {
    const grupos = unidades.filter(u => !u.removido_em || depositos.some(d => d.unidade_id === u.id));
    const lista = d => depositos.filter(x => x.unidade_id === d.id && (mostrarRemovidos || !x.removido_em));
    const temRemovidos = depositos.some(d => d.removido_em);
    el.innerHTML = `
      ${cabecalho('Depósitos', 'A estrutura de cada depósito define os endereços que podem ser usados no cadastro de materiais. O andar 1 é o mais baixo.',
        [temRemovidos ? `<button class="btn btn-ghost" type="button" data-acao="alternar">${mostrarRemovidos ? 'Esconder removidos' : 'Mostrar removidos'}</button>` : '',
         podeEditar ? '<button class="btn btn-primary" type="button" data-acao="novo">Novo depósito</button>' : ''].join(''))}
      ${grupos.map(u => `<section class="card card-pad painel-bloco">
        <h2 class="section-title">${esc(u.nome)}${u.sigla ? ` <span class="muted small">${esc(u.sigla)}</span>` : ''}</h2>
        <div class="deposito-grid">${lista(u).map(cartao).join('') || `<p class="muted">Nenhum depósito nesta unidade.${podeEditar ? ' Use "Novo depósito".' : ''}</p>`}</div>
      </section>`).join('') || '<section class="card card-pad empty"><h3>Nenhuma unidade cadastrada</h3><p>Cadastre a unidade em Unidades e setores.</p></section>'}
      <section class="card card-pad painel-bloco">
        <h2 class="section-title">Regras de peso</h2>
        <p class="section-sub">Pelo POP, os materiais mais pesados ficam na parte de baixo das estantes. O cadastro avisa quando um item pesado for colocado acima do andar indicado, e a sugestão de posição segue esta regra.</p>
        <form id="formPeso" class="toolbar filtros regra-peso" novalidate>
          <label class="filtro-campo">Pesado a partir de (kg)<input id="rPeso" type="number" min="0" step="any" value="${config.peso_pesado_kg}" ${podeEditar ? '' : 'disabled'}></label>
          <label class="filtro-campo">Pesados até o andar<input id="rAndar" type="number" min="1" step="1" value="${config.andar_maximo_pesado}" ${podeEditar ? '' : 'disabled'}></label>
          ${podeEditar ? '<button class="btn btn-primary" type="submit">Salvar regra</button>' : ''}
        </form>
      </section>`;
  }

  // -----------------------------------------------------------------
  // Formulário
  // -----------------------------------------------------------------
  function abrirFormulario(d = null) {
    const unidadesAtivas = unidades.filter(u => !u.removido_em);
    if (!unidadesAtivas.length) return toast('Cadastre uma unidade antes, em Unidades e setores.', 'erro');
    const aceitas = new Set(d?.classes_permitidas || []);
    const fundo = abrirModal({
      titulo: d ? `Editar ${esc(nomeDeposito(d))}` : 'Novo depósito',
      subtitulo: 'Use o número real do depósito, como 1, 4 ou 17.',
      corpo: `<form id="formDeposito" novalidate>
        <div class="fields campos-3">
          <div class="field"><label for="dUnidade">Unidade *</label><select id="dUnidade" ${d ? 'disabled' : ''}>${unidadesAtivas.map(u => `<option value="${u.id}" ${d?.unidade_id === u.id ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></div>
          <div class="field"><label for="dNumero">Número *</label><input id="dNumero" type="number" min="1" max="99" value="${esc(d?.numero || '')}" ${d ? 'disabled' : ''}></div>
          <div class="field"><label for="dNome">Nome</label><input id="dNome" maxlength="40" value="${esc(d?.nome || '')}" placeholder="Ex.: Química"></div>
          <div class="field"><label for="dPrateleiras">Prateleiras *</label><input id="dPrateleiras" type="number" min="1" max="99" value="${esc(d?.prateleiras || 10)}"></div>
          <div class="field"><label for="dAndares">Andares por prateleira *</label><input id="dAndares" type="number" min="1" max="20" value="${esc(d?.andares || 5)}"></div>
          <div class="field"><label for="dPosicoes">Posições por andar *</label><input id="dPosicoes" type="number" min="1" max="99" value="${esc(d?.posicoes || 10)}"></div>
          <div class="field"><label>Lados das prateleiras *</label>
            <div class="linha-checks">${['A', 'B'].map(l => `<label class="inline-check"><input type="checkbox" name="dLado" value="${l}" ${!d || d.lados.includes(l) ? 'checked' : ''}> Lado ${l}</label>`).join('')}</div></div>
          <div class="field wide"><label for="dTipo">Tipo de armazenagem</label><select id="dTipo">${Object.entries(TIPOS_ARMAZENAGEM).map(([v, t]) => `<option value="${v}" ${(d?.tipo_armazenagem || 'PRATELEIRA') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="form-section">
          <h3>Classes aceitas</h3>
          <p class="small muted">Deixe tudo desmarcado para aceitar qualquer classe. Marque só as que podem ser guardadas aqui, por exemplo, apenas Químicos na área delimitada.</p>
          <div class="checks-classes">${classes.filter(c => !c.removido_em).map(c => `<label class="check-classe"><input type="checkbox" name="dClasse" value="${c.id}" ${aceitas.has(c.id) ? 'checked' : ''}> ${pillCor(c.nome, c.cor, 'pill-mini')}</label>`).join('')}</div>
        </div>
        <p class="form-erro" id="dErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formDeposito">${d ? 'Salvar alterações' : 'Criar depósito'}</button>`,
    });
    $('#formDeposito', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const erro = $('#dErro', fundo);
      const falhar = m => { erro.textContent = m; erro.hidden = false; };
      const num = id => Number($('#' + id, fundo).value);
      const dados = {
        nome: $('#dNome', fundo).value.trim() || null,
        prateleiras: num('dPrateleiras'),
        andares: num('dAndares'),
        posicoes: num('dPosicoes'),
        lados: [...fundo.querySelectorAll('input[name=dLado]:checked')].map(x => x.value),
        tipo_armazenagem: $('#dTipo', fundo).value,
        classes_permitidas: [...fundo.querySelectorAll('input[name=dClasse]:checked')].map(x => Number(x.value)),
      };
      if (!d) {
        dados.unidade_id = num('dUnidade');
        dados.numero = num('dNumero');
        if (!dados.numero || dados.numero < 1 || dados.numero > 99) return falhar('Informe o número do depósito, de 1 a 99.');
      }
      if (!dados.lados.length) return falhar('Marque pelo menos um lado.');
      if ([dados.prateleiras, dados.andares, dados.posicoes].some(n => !Number.isInteger(n) || n < 1)) return falhar('Prateleiras, andares e posições precisam ser números inteiros a partir de 1.');
      await executando(e.submitter, async () => {
        try {
          if (d) await atualizarRegistro('depositos', d.id, dados);
          else await criarRegistro('depositos', dados);
          fecharModal(true);
          toast(d ? 'Depósito atualizado.' : 'Depósito criado.');
          await carregar();
          desenhar();
        } catch (falha) {
          falhar(erroAmigavel(falha));
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // Mapa de ocupação
  // -----------------------------------------------------------------
  function abrirMapa(d) {
    let prateleira = 1;
    let lado = d.lados[0];
    const fundo = abrirModal({
      titulo: `Mapa do ${esc(nomeDeposito(d))}`,
      subtitulo: 'Cada quadro é uma posição. As ocupadas aparecem na cor da classe do material. Clique para abrir o material.',
      largo: true,
      corpo: '<div id="mapaConteudo"></div>',
      rodape: '<button class="btn btn-ghost" type="button" data-fechar>Fechar</button>',
    });
    const desenharMapa = () => {
      const atual = depositos.find(x => x.id === d.id) || d;
      if (prateleira > atual.prateleiras) prateleira = 1;
      if (!atual.lados.includes(lado)) lado = atual.lados[0];
      const linhas = [];
      for (let andar = atual.andares; andar >= 1; andar--) {
        const celulas = [];
        for (let pos = 1; pos <= atual.posicoes; pos++) {
          const m = materiais.find(x => x.deposito_id === atual.id && x.prateleira === prateleira && x.lado === lado && x.andar === andar && x.posicao === pos);
          const c = m && classe(m.classe_id);
          const codigo = codigoLocalizacao(atual.numero, prateleira, lado, andar, pos);
          celulas.push(m
            ? `<button type="button" class="celula ocupada" style="background:${esc(c?.cor || '#ccc')};color:${contraste(c?.cor || '#ccc')}" data-material="${esc(m.codigo)}" title="${esc(codigo)}: ${esc(m.nome)}"><b>Po${pos}</b><span>${esc(m.nome)}</span></button>`
            : `<div class="celula" title="${esc(codigo)}: livre"><b>Po${pos}</b><span>Livre</span></div>`);
        }
        linhas.push(`<div class="mapa-linha"><div class="mapa-andar">Andar ${andar}${andar === 1 ? '<small>mais baixo</small>' : ''}</div><div class="mapa-celulas" style="grid-template-columns:repeat(${atual.posicoes}, minmax(74px, 1fr))">${celulas.join('')}</div></div>`);
      }
      const ocupadasAqui = materiais.filter(x => x.deposito_id === atual.id && x.prateleira === prateleira && x.lado === lado).length;
      $('#mapaConteudo', fundo).innerHTML = `
        <div class="toolbar filtros">
          <label class="filtro-campo">Prateleira<select id="mapaPrat">${Array.from({ length: atual.prateleiras }, (_, i) => `<option value="${i + 1}" ${prateleira === i + 1 ? 'selected' : ''}>Prateleira ${i + 1}</option>`).join('')}</select></label>
          <label class="filtro-campo">Lado<select id="mapaLado">${atual.lados.map(l => `<option value="${l}" ${lado === l ? 'selected' : ''}>Lado ${l}</option>`).join('')}</select></label>
          <span class="pill blue">${ocupadasAqui} de ${atual.andares * atual.posicoes} ocupadas</span>
        </div>
        <div class="mapa">${linhas.join('')}</div>
        <p class="small muted">Regra de peso: a partir de ${fmtQtd(config.peso_pesado_kg)} kg, guardar até o andar ${config.andar_maximo_pesado}.</p>`;
    };
    desenharMapa();
    fundo.addEventListener('change', e => {
      if (e.target.id === 'mapaPrat') { prateleira = Number(e.target.value); desenharMapa(); }
      if (e.target.id === 'mapaLado') { lado = e.target.value; desenharMapa(); }
    });
    fundo.addEventListener('click', e => {
      const alvo = e.target.closest('[data-material]');
      if (!alvo) return;
      fecharModal(true);
      ctx.navegar(`materiais/${encodeURIComponent(alvo.dataset.material)}`);
    });
    const parar = ouvir(['materiais', 'depositos', 'classes'], async () => { await carregar(); desenharMapa(); });
    aoFecharModal(fundo, parar);
  }

  async function alterarRemocao(d, remover) {
    if (remover && !window.confirm(`Remover ${nomeDeposito(d)}? Só é possível quando não há materiais nele.`)) return;
    try {
      await atualizarRegistro('depositos', d.id, { removido_em: remover ? new Date().toISOString() : null });
      toast(remover ? 'Depósito removido.' : 'Depósito restaurado.');
      await carregar();
      desenhar();
    } catch (erro) {
      toast(erroAmigavel(erro), 'erro');
    }
  }

  await carregar();
  desenhar();

  el.addEventListener('click', e => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const d = depositos.find(x => String(x.id) === botao.dataset.id);
    const acao = botao.dataset.acao;
    if (acao === 'novo') abrirFormulario();
    if (acao === 'alternar') { mostrarRemovidos = !mostrarRemovidos; desenhar(); }
    if (acao === 'editar' && d) abrirFormulario(d);
    if (acao === 'mapa' && d) abrirMapa(d);
    if (acao === 'remover' && d) alterarRemocao(d, true);
    if (acao === 'restaurar' && d) alterarRemocao(d, false);
  });

  el.addEventListener('submit', async e => {
    if (e.target.id !== 'formPeso') return;
    e.preventDefault();
    const peso = Number($('#rPeso', el).value);
    const andar = Number($('#rAndar', el).value);
    if (!(peso >= 0) || !(andar >= 1)) return toast('Informe um peso válido e um andar a partir de 1.', 'erro');
    await executando(e.submitter, async () => {
      for (const [chave, valor] of [['peso_pesado_kg', peso], ['andar_maximo_pesado', Math.round(andar)]]) {
        const { data, error } = await supabase.from('configuracoes').update({ valor }).eq('chave', chave).select('chave');
        if (error || !data?.length) return toast(error ? erroAmigavel(error) : 'Seu perfil não pode alterar esta regra.', 'erro');
      }
      toast('Regra de peso salva.');
    });
  });

  ctx.aoSair(ouvir(['depositos', 'unidades', 'classes', 'materiais', 'configuracoes'], async () => {
    if (!ctx.ativa()) return;
    // Não redesenha enquanto alguém digita a regra de peso.
    if (el.contains(document.activeElement) && document.activeElement.matches('#rPeso, #rAndar')) { await carregar(); return; }
    await carregar();
    desenhar();
  }));
}
