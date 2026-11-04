import { supabase } from '../lib/supabase.js';
import { $, esc, cabecalho, abrirModal, fecharModal, mostrarConcluido, executando, erroAmigavel, gerarSenha, toast, fmtDataHora } from '../lib/ui.js';
import { PERFIS, rotuloPerfil, podeGerenciar, perfisAtribuiveis, nivel } from '../lib/permissoes.js';
import { gerenciarUsuario } from '../lib/funcoes.js';
import { temEmailReal } from '../lib/sessao.js';
import { ouvir } from '../lib/tempoReal.js';

const SITUACOES = {
  atuais: 'Ativos e bloqueados',
  ativos: 'Só ativos',
  bloqueados: 'Só bloqueados',
  removidos: 'Removidos',
};

const normalizar = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export async function montar(el, ctx) {
  const ator = ctx.perfil;
  let usuarios = [];
  let unidades = [];
  let setores = [];
  const filtro = { busca: '', perfil: '', situacao: 'atuais' };

  async function carregar() {
    const [u, un, se] = await Promise.all([
      supabase.from('perfis').select('*, unidade:unidades(nome), setor:setores(nome)').order('nome'),
      supabase.from('unidades').select('id,nome').is('removido_em', null).order('nome'),
      supabase.from('setores').select('id,nome').is('removido_em', null).order('nome'),
    ]);
    for (const r of [u, un, se]) if (r.error) throw r.error;
    usuarios = u.data;
    unidades = un.data;
    setores = se.data;
  }

  function filtrados() {
    const termo = normalizar(filtro.busca);
    return usuarios.filter(u => {
      if (filtro.situacao === 'removidos' ? !u.removido_em : u.removido_em) return false;
      if (filtro.situacao === 'ativos' && !u.ativo) return false;
      if (filtro.situacao === 'bloqueados' && u.ativo) return false;
      if (filtro.perfil && u.perfil !== filtro.perfil) return false;
      if (!termo) return true;
      return normalizar([u.nome, u.email, u.matricula, u.empresa, u.setor?.nome].join(' ')).includes(termo);
    });
  }

  function situacaoPill(u) {
    if (u.removido_em) return '<span class="pill gray">Removido</span>';
    if (!u.ativo) return '<span class="pill red">Bloqueado</span>';
    return '<span class="pill ok">Ativo</span>';
  }

  function acoes(u) {
    const proprio = u.id === ator.id;
    if (!proprio && !podeGerenciar(ator, u)) return '<span class="small muted">Sem permissão</span>';
    const botoes = [];
    if (u.removido_em) {
      botoes.push(`<button class="btn btn-light btn-sm" type="button" data-acao="restaurar" data-id="${u.id}">Restaurar</button>`);
    } else {
      botoes.push(`<button class="btn btn-light btn-sm" type="button" data-acao="editar" data-id="${u.id}">Editar</button>`);
      if (!proprio) {
        botoes.push(`<button class="btn btn-ghost btn-sm" type="button" data-acao="senha" data-id="${u.id}">Nova senha</button>`);
        botoes.push(u.ativo
          ? `<button class="btn btn-ghost btn-sm" type="button" data-acao="bloquear" data-id="${u.id}">Bloquear</button>`
          : `<button class="btn btn-ghost btn-sm" type="button" data-acao="desbloquear" data-id="${u.id}">Desbloquear</button>`);
        botoes.push(`<button class="btn btn-danger btn-sm" type="button" data-acao="remover" data-id="${u.id}">Remover</button>`);
      }
    }
    return `<div class="acoes-linha">${botoes.join('')}</div>`;
  }

  function linhas() {
    const lista = filtrados();
    if (!lista.length) {
      return `<tr><td colspan="6" class="empty">${filtro.busca || filtro.perfil ? 'Nenhum usuário encontrado com esses filtros.' : 'Nenhum usuário nesta situação.'}</td></tr>`;
    }
    return lista.map(u => `
      <tr>
        <td>
          <div class="strong">${esc(u.nome)} ${u.id === ator.id ? '<span class="pill blue">Você</span>' : ''}</div>
          ${u.empresa ? `<div class="small muted">Terceiro: ${esc(u.empresa)}</div>` : ''}
          ${u.deve_trocar_senha && !u.removido_em ? '<div class="small aviso-texto">Ainda não criou a própria senha</div>' : ''}
        </td>
        <td>
          ${u.email ? `<div>${esc(u.email)}</div>` : '<div class="muted">Sem e-mail</div>'}
          ${u.matricula ? `<div class="small muted">Matrícula ${esc(u.matricula)}</div>` : ''}
        </td>
        <td><span class="role-pill perfil-${u.perfil.toLowerCase()}">${esc(rotuloPerfil(u.perfil))}</span></td>
        <td>${esc(u.unidade?.nome || '')}${u.setor ? `<div class="small muted">${esc(u.setor.nome)}</div>` : ''}</td>
        <td>${situacaoPill(u)}${u.removido_em ? `<div class="small muted">${fmtDataHora(u.removido_em)}</div>` : ''}</td>
        <td>${acoes(u)}</td>
      </tr>`).join('');
  }

  function desenhar() {
    el.innerHTML = `
      ${cabecalho('Usuários e acessos',
        ator.perfil === 'MASTER'
          ? 'Como master, você cria qualquer perfil, inclusive gestores.'
          : 'Você cria e altera contas com perfil abaixo do seu. Gestores são nomeados pelo master.',
        '<button class="btn btn-primary" type="button" data-acao="novo">Novo usuário</button>')}
      <section class="card card-pad">
        <div class="toolbar filtros">
          <input class="search" id="filtroBusca" type="search" placeholder="Buscar por nome, e-mail, matrícula ou setor" value="${esc(filtro.busca)}" aria-label="Buscar usuário">
          <select id="filtroPerfil" aria-label="Filtrar por perfil">
            <option value="">Todos os perfis</option>
            ${Object.keys(PERFIS).map(p => `<option value="${p}" ${filtro.perfil === p ? 'selected' : ''}>${rotuloPerfil(p)}</option>`).join('')}
          </select>
          <select id="filtroSituacao" aria-label="Filtrar por situação">
            ${Object.entries(SITUACOES).map(([v, t]) => `<option value="${v}" ${filtro.situacao === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Nome</th><th>Acesso</th><th>Perfil</th><th>Unidade e setor</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody id="corpoUsuarios">${linhas()}</tbody>
          </table>
        </div>
      </section>`;
  }

  const atualizarTabela = () => { $('#corpoUsuarios', el).innerHTML = linhas(); };

  async function recarregar() {
    await carregar();
    atualizarTabela();
  }

  // ---------------------------------------------------------------
  // Formulário de criar e editar
  // ---------------------------------------------------------------
  function opcoes(lista, selecionado, vazio) {
    return `<option value="">${vazio}</option>` + lista
      .map(x => `<option value="${x.id}" ${String(selecionado) === String(x.id) ? 'selected' : ''}>${esc(x.nome)}</option>`)
      .join('');
  }

  function formulario(u) {
    const proprio = u?.id === ator.id;
    const perfis = proprio ? [u.perfil] : perfisAtribuiveis(ator);
    const perfilAtual = u?.perfil || (perfis.includes('SOLICITANTE') ? 'SOLICITANTE' : perfis[perfis.length - 1]);
    return `
      <form id="formUsuario" novalidate>
        <div class="fields">
          <div class="field wide"><label for="uNome">Nome completo *</label><input id="uNome" maxlength="100" required value="${esc(u?.nome || '')}" autocomplete="off"></div>
          <div class="field"><label for="uEmail">E-mail</label><input id="uEmail" type="email" maxlength="120" value="${esc(u?.email || '')}" autocomplete="off"><small class="dica">Usado para entrar e para recuperar a senha.</small></div>
          <div class="field"><label for="uMatricula">Matrícula</label><input id="uMatricula" maxlength="30" value="${esc(u?.matricula || '')}" autocomplete="off"><small class="dica">Permite entrar sem e-mail.</small></div>
          <div class="field"><label for="uPerfil">Perfil *</label>
            <select id="uPerfil" ${proprio ? 'disabled' : ''}>${perfis.map(p => `<option value="${p}" ${p === perfilAtual ? 'selected' : ''}>${rotuloPerfil(p)}</option>`).join('')}</select>
            <small class="dica" id="uPerfilDescricao">${esc(PERFIS[perfilAtual]?.descricao || '')}</small>
          </div>
          <div class="field"><label for="uCracha">Número do crachá (NFC)</label><input id="uCracha" maxlength="60" value="${esc(u?.cracha || '')}" autocomplete="off"><small class="dica">Vai confirmar as retiradas de material.</small></div>
          <div class="field"><label for="uUnidade">Unidade</label><select id="uUnidade">${opcoes(unidades, u?.unidade_id, 'Sem unidade')}</select></div>
          <div class="field"><label for="uSetor">Setor</label><select id="uSetor">${opcoes(setores, u?.setor_id, 'Sem setor')}</select></div>
          <div class="field wide"><label for="uEmpresa">Empresa (só para terceiros)</label><input id="uEmpresa" maxlength="100" value="${esc(u?.empresa || '')}" autocomplete="off" placeholder="Deixe em branco para funcionários da Klabin"></div>
        </div>
        ${u ? '' : `
        <div class="form-section">
          <h3>Primeiro acesso</h3>
          <div class="opcoes-acesso" role="radiogroup" aria-label="Como a pessoa vai entrar pela primeira vez">
            <label class="opcao-acesso"><input type="radio" name="uModo" value="senha" checked><span><b>Senha provisória</b><small>Você entrega a senha para a pessoa. Serve também para quem não tem e-mail.</small></span></label>
            <label class="opcao-acesso"><input type="radio" name="uModo" value="convite"><span><b>Convite por e-mail</b><small>A pessoa recebe um link e cria a própria senha. Precisa de e-mail e do envio de e-mails configurado no Supabase.</small></span></label>
          </div>
          <div class="field senha-provisoria" id="uSenhaCaixa">
            <label for="uSenha">Senha provisória *</label>
            <div class="linha-senha"><input id="uSenha" minlength="8" maxlength="72" autocomplete="off" value="${gerarSenha()}"><button class="btn btn-light" type="button" data-gerar>Gerar outra</button></div>
            <small class="dica">No primeiro acesso, o sistema pede para a pessoa criar a própria senha.</small>
          </div>
        </div>`}
        <p class="form-erro" id="uErro" role="alert" hidden></p>
      </form>`;
  }

  function lerFormulario(u) {
    const valor = id => $('#' + id).value.trim();
    const dados = {
      nome: valor('uNome'),
      email: valor('uEmail').toLowerCase(),
      matricula: valor('uMatricula'),
      cracha: valor('uCracha'),
      unidade_id: valor('uUnidade'),
      setor_id: valor('uSetor'),
      empresa: valor('uEmpresa'),
    };
    if (!u || u.id !== ator.id) dados.perfil = $('#uPerfil').value;
    return dados;
  }

  function validar(dados, modo, senha) {
    if (dados.nome.length < 2) return 'Informe o nome completo.';
    if (!dados.email && !dados.matricula) return 'Informe o e-mail ou a matrícula. Sem um dos dois a pessoa não consegue entrar.';
    if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) return 'O e-mail não parece válido.';
    if (dados.matricula && !/^[A-Za-z0-9._-]+$/.test(dados.matricula)) return 'A matrícula aceita só letras, números, ponto, hífen e sublinhado.';
    if (modo === 'convite' && !dados.email) return 'Para enviar convite, informe o e-mail.';
    if (modo === 'senha' && senha.length < 8) return 'A senha provisória precisa ter pelo menos 8 caracteres.';
    return '';
  }

  function abrirFormulario(u = null) {
    const fundo = abrirModal({
      titulo: u ? 'Editar usuário' : 'Novo usuário',
      subtitulo: u ? esc(u.nome) : 'Preencha os dados. A pessoa não precisa se cadastrar.',
      corpo: formulario(u),
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formUsuario">${u ? 'Salvar alterações' : 'Criar usuário'}</button>`,
    });
    const erro = $('#uErro', fundo);
    const mostrarErro = m => { erro.textContent = m; erro.hidden = !m; };

    fundo.addEventListener('change', e => {
      if (e.target.id === 'uPerfil') $('#uPerfilDescricao', fundo).textContent = PERFIS[e.target.value]?.descricao || '';
      if (e.target.name === 'uModo') $('#uSenhaCaixa', fundo).hidden = e.target.value !== 'senha';
    });
    fundo.addEventListener('click', e => {
      if (e.target.closest('[data-gerar]')) $('#uSenha', fundo).value = gerarSenha();
    });

    $('#formUsuario', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const dados = lerFormulario(u);
      const modo = u ? null : fundo.querySelector('input[name=uModo]:checked').value;
      const senha = u ? '' : $('#uSenha', fundo).value;
      const problema = validar(dados, modo, senha);
      if (problema) return mostrarErro(problema);
      mostrarErro('');
      await executando(e.submitter, async () => {
        try {
          if (u) {
            await gerenciarUsuario({ acao: 'editar', id: u.id, dados });
            fecharModal(true);
            toast('Alterações salvas.');
          } else {
            await gerenciarUsuario({ acao: 'criar', dados, modo, senha, redirectTo: window.location.origin });
            fecharModal(true);
            const acesso = dados.email || `a matrícula ${dados.matricula}`;
            mostrarConcluido('Usuário criado', modo === 'senha'
              ? `<p><b>${esc(dados.nome)}</b> já pode entrar com ${esc(acesso)} e a senha provisória abaixo.</p>
                 <div class="senha-entrega"><span>Senha provisória</span><b>${esc(senha)}</b></div>
                 <p class="small muted">Anote e entregue para a pessoa. Esta senha não aparece de novo.</p>`
              : `<p>O convite foi enviado para <b>${esc(dados.email)}</b>. A conta fica liberada quando a pessoa criar a senha pelo link.</p>`);
          }
          await recarregar();
        } catch (erroOperacao) {
          mostrarErro(erroOperacao.message);
        }
      });
    });
  }

  function abrirNovaSenha(u) {
    const fundo = abrirModal({
      titulo: 'Definir senha provisória',
      subtitulo: esc(u.nome),
      pequeno: true,
      corpo: `<form id="formSenha" novalidate>
        <div class="field"><label for="sSenha">Nova senha provisória</label>
          <div class="linha-senha"><input id="sSenha" minlength="8" maxlength="72" autocomplete="off" value="${gerarSenha()}"><button class="btn btn-light" type="button" data-gerar>Gerar outra</button></div>
          <small class="dica">A senha atual deixa de valer. No próximo acesso, a pessoa cria a própria senha.</small>
        </div>
        <p class="form-erro" id="sErro" role="alert" hidden></p>
      </form>`,
      rodape: `<button class="btn btn-ghost" type="button" data-fechar>Cancelar</button>
               <button class="btn btn-primary" type="submit" form="formSenha">Definir senha</button>`,
    });
    fundo.addEventListener('click', e => { if (e.target.closest('[data-gerar]')) $('#sSenha', fundo).value = gerarSenha(); });
    $('#formSenha', fundo).addEventListener('submit', async e => {
      e.preventDefault();
      const senha = $('#sSenha', fundo).value;
      const erro = $('#sErro', fundo);
      if (senha.length < 8) { erro.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; erro.hidden = false; return; }
      await executando(e.submitter, async () => {
        try {
          await gerenciarUsuario({ acao: 'senha', id: u.id, senha });
          fecharModal(true);
          const acesso = temEmailReal(u.email) ? u.email : `a matrícula ${u.matricula}`;
          mostrarConcluido('Senha provisória definida', `
            <p><b>${esc(u.nome)}</b> entra com ${esc(acesso)} e a senha abaixo.</p>
            <div class="senha-entrega"><span>Senha provisória</span><b>${esc(senha)}</b></div>
            <p class="small muted">Anote e entregue para a pessoa. Esta senha não aparece de novo.</p>`);
          await recarregar();
        } catch (erroOperacao) {
          erro.textContent = erroOperacao.message;
          erro.hidden = false;
        }
      });
    });
  }

  async function mudarSituacao(u, acao) {
    const textos = {
      bloquear: [`Bloquear ${u.nome}? A pessoa sai do sistema em até 30 segundos e não consegue entrar até ser desbloqueada.`, 'Usuário bloqueado.'],
      desbloquear: [`Desbloquear ${u.nome}?`, 'Usuário desbloqueado.'],
      remover: [`Remover ${u.nome}? A pessoa perde o acesso e sai da lista. O histórico continua guardado, e a conta pode ser restaurada.`, 'Usuário removido.'],
      restaurar: [`Restaurar ${u.nome}? A conta volta para a lista com a mesma situação de antes da remoção.`, 'Usuário restaurado.'],
    };
    if (!window.confirm(textos[acao][0])) return;
    try {
      if (acao === 'bloquear' || acao === 'desbloquear') {
        await gerenciarUsuario({ acao: 'editar', id: u.id, dados: { ativo: acao === 'desbloquear' } });
      } else {
        await gerenciarUsuario({ acao, id: u.id });
      }
      toast(textos[acao][1]);
      await recarregar();
    } catch (erro) {
      toast(erroAmigavel(erro), 'erro');
    }
  }

  await carregar();
  desenhar();

  ctx.aoSair(ouvir(['perfis', 'unidades', 'setores'], async () => {
    if (ctx.ativa()) await recarregar();
  }));

  el.addEventListener('input', e => {
    if (e.target.id === 'filtroBusca') { filtro.busca = e.target.value; atualizarTabela(); }
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'filtroPerfil') { filtro.perfil = e.target.value; atualizarTabela(); }
    if (e.target.id === 'filtroSituacao') { filtro.situacao = e.target.value; atualizarTabela(); }
  });
  el.addEventListener('click', e => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const u = usuarios.find(x => x.id === botao.dataset.id);
    const acao = botao.dataset.acao;
    if (acao === 'novo') {
      if (nivel(ator.perfil) < 4) return toast('Seu perfil não cria usuários.', 'erro');
      return abrirFormulario();
    }
    if (!u) return;
    if (acao === 'editar') abrirFormulario(u);
    else if (acao === 'senha') abrirNovaSenha(u);
    else mudarSituacao(u, acao);
  });
}
